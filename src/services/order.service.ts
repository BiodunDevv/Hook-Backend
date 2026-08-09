import type { MongoRepository as Repository } from '@lib/mongo-repository';
import { AppDataSource } from '@config/data-source';
import { AccountStatus, AccountType, DEFAULT_DELIVERY_FEE, DELIVERY_SLA_HOURS, OrderStatus, OrderType, PaymentMode, PaymentStatus, ProductStatus, ScopeType } from '@lib/constants';
import { EmailService } from '@emails/email.service';
import { Cart } from '@models/cart/cart.model';
import { CartItem } from '@models/cart/cart-item.model';
import { Logistics } from '@models/logistics/logistics.model';
import { OrderItem } from '@models/orders/order-item.model';
import { Order } from '@models/orders/order.model';
import { Product } from '@models/products/product.model';
import { Payment } from '@models/payments/payment.model';
import { OrderFulfilmentGroup } from '@models/orders/order-fulfilment-group.model';
import { User } from '@models/users/user.model';
import { CustomerOwner } from './cart.service';
import { HttpError } from '@utils/http';
import { Otp } from '@models/auth/otp.model';
import { randomInt } from 'crypto';
import { nextPublicId } from './public-id.service';
import { publishRealtime } from './realtime.service';

type CheckoutBody = Pick<Order, 'deliveryAddress' | 'deliveryNotes' | 'scheduledDeliveryAt' | 'guestEmail' | 'guestName' | 'paymentMode' | 'orderType' | 'giftRecipient'>;

export class OrderService {
  private readonly email = new EmailService();

  constructor(
    private readonly carts: Repository<Cart>,
    private readonly cartItems: Repository<CartItem>,
    private readonly orders: Repository<Order>,
    private readonly orderItems: Repository<OrderItem>,
    private readonly products: Repository<Product>,
    private readonly logistics: Repository<Logistics>,
  ) {}

  async checkout(owner: CustomerOwner, body: CheckoutBody) {
    const where = this.ownerWhere(owner);
    if (!owner.userId && (!body.guestEmail || !body.guestName)) {
      throw new HttpError(400, 'Guest checkout requires a name and email address');
    }
    const cart = await this.carts.findOne({
      where: { ...where, isCheckedOut: false },
      relations: { items: { product: true } },
    });
    if (cart) cart.items = cart.items || await this.cartItems.find({ where: { cartId: cart.id }, relations: { product: true } });
    const cartItems = cart?.items || [];
    if (!cart || !cartItems.length) throw new HttpError(400, 'Cart is empty');
    if (body.paymentMode === PaymentMode.PAY_ON_DELIVERY && process.env.OPAY_POD_ENABLED !== 'true') {
      throw new HttpError(409, 'Pay on Delivery is not currently available');
    }
    if (body.orderType === OrderType.GIFT && (!body.giftRecipient || body.paymentMode !== PaymentMode.PAY_NOW)) {
      throw new HttpError(400, 'Gift orders require recipient delivery details and Pay Now');
    }

    const legacySourceIds = [...new Set(cartItems.map((item) => item.product.vendorId).filter(Boolean))];
    for (const item of cartItems) {
      const available = Number(item.product.quantity || 0) - Number(item.product.reservedQuantity || 0);
      if (available < item.quantity) throw new HttpError(409, `${item.product.title} no longer has enough available stock`);
    }
    const provisionalUser = !owner.userId && body.guestEmail
      ? await this.ensureGuestAccount(body.guestEmail, body.guestName || '', owner.guestId)
      : undefined;
    const order = await this.orders.save(this.orders.create({
      orderCode: `HK-${Date.now().toString().slice(-8)}`,
      ...where,
      userId: owner.userId || provisionalUser?.id,
      guestEmail: body.guestEmail,
      guestName: body.guestName,
      subtotal: cart.subtotal,
      deliveryFee: Number(process.env.DEFAULT_DELIVERY_FEE || DEFAULT_DELIVERY_FEE),
      deliverySubsidy: Number(process.env.DELIVERY_VENDOR_SUBSIDY || 0),
      discount: 0,
      total: cart.subtotal + Number(process.env.DEFAULT_DELIVERY_FEE || DEFAULT_DELIVERY_FEE),
      vendorCount: legacySourceIds.length,
      status: body.paymentMode === PaymentMode.PAY_NOW ? OrderStatus.AWAITING_PAYMENT : OrderStatus.PENDING,
      paymentStatus: PaymentStatus.UNPAID,
      paymentMode: body.paymentMode || PaymentMode.PAY_NOW,
      orderType: body.orderType || OrderType.STANDARD,
      giftRecipient: body.giftRecipient,
      deliveryAddress: body.orderType === OrderType.GIFT && body.giftRecipient ? body.giftRecipient.address : body.deliveryAddress,
      partialFulfilment: false,
      deliveryNotes: body.deliveryNotes,
      scheduledDeliveryAt: body.scheduledDeliveryAt,
    }));

    const createdItems: any[] = [];
    const reservations: Array<{ productId: string; quantity: number }> = [];
    try {
      for (const item of cartItems) {
        const product = item.product;
        const reserved = await Product.findOneAndUpdate(
          {
            _id: product.id,
            status: ProductStatus.APPROVED,
            $expr: { $gte: [{ $subtract: ['$quantity', '$reservedQuantity'] }, item.quantity] },
          },
          { $inc: { reservedQuantity: item.quantity } },
          { returnDocument: 'after' },
        );
        if (!reserved) throw new HttpError(409, `${product.title} no longer has enough available stock`);
        reservations.push({ productId: product.id, quantity: item.quantity });
        createdItems.push(await this.orderItems.save(this.orderItems.create({
          orderId: order.id,
          productId: item.productId,
          productTitle: product.title,
          productImage: product.images?.[0],
          vendorId: product.vendorId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          totalPrice: item.totalPrice,
          selectedVariants: item.selectedVariants,
          commissionAmount: 0,
        })));
      }
    } catch (error) {
      await Promise.all(reservations.map(({ productId, quantity }) => Product.findByIdAndUpdate(productId, { $inc: { reservedQuantity: -quantity } })));
      await this.orderItems.delete({ orderId: order.id });
      await this.orders.delete(order.id);
      throw error;
    }
    await this.logistics.save(this.logistics.create({
      orderId: order.id,
      deliveryLocation: {
        address: `${order.deliveryAddress.street}, ${order.deliveryAddress.city}, ${order.deliveryAddress.state}`,
        coordinates: order.deliveryAddress.coordinates || { lat: 0, lng: 0 },
        instructions: body.deliveryNotes,
      },
      estimatedDeliveryAt: new Date(Date.now() + DELIVERY_SLA_HOURS * 60 * 60 * 1000),
    }));

    cart.isCheckedOut = true;
    await Promise.all([this.carts.save(cart), this.cartItems.delete({ cartId: cart.id })]);
    const itemCount = cartItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
    const customer = owner.userId ? await AppDataSource.getRepository(User).findOne({ where: { id: owner.userId } }) : undefined;
    const customerEmail = customer?.email || body.guestEmail;
    const customerName = `${customer?.firstName || ''} ${customer?.lastName || ''}`.trim() || body.guestName || body.guestEmail;
    if (customerEmail && body.paymentMode === PaymentMode.PAY_ON_DELIVERY) {
      await this.email.sendOrderConfirmation({
        to: customerEmail,
        name: customerName,
        orderCode: order.orderCode,
        amount: order.total,
        itemCount,
      });
    }
    const hookOpsEmail = process.env.HOOK_OPS_EMAIL || process.env.BREVO_FROM_EMAIL;
    if (hookOpsEmail && body.paymentMode === PaymentMode.PAY_ON_DELIVERY) {
      await this.email.sendHookNewOrder({
        to: hookOpsEmail,
        customerName: customerName || 'Customer',
        orderCode: order.orderCode,
        amount: order.total,
        itemCount,
      });
    }

    const result = await this.orders.findOne({
      where: { id: order.id },
      relations: { items: true, logistics: true },
    });
    const response = { ...result, provisionalAccount: provisionalUser?.accountStatus === 'pending_password' ? { email: provisionalUser.email, nextStep: 'set_password' } : undefined };
    publishRealtime({ type: 'order.updated', entityId: order.publicId || order.id, version: 1 }, owner.userId ? { accountId: owner.userId, admin: true } : { admin: true });
    return response;
  }

  async listCustomerOrders(owner: CustomerOwner) {
    const orders = await Order.find(this.ownerWhere(owner))
      .select('-legacyCommerceSnapshot -timeline -customerSnapshot -addressSnapshot')
      .sort({ createdAt: -1 })
      .limit(100)
      .lean({ virtuals: true });
    const orderIds = orders.map((order) => order.id);
    const [items, payments, groups] = await Promise.all([
      orderIds.length ? OrderItem.find({ orderId: { $in: orderIds } }).lean({ virtuals: true }) : [],
      orderIds.length ? Payment.find({ orderId: { $in: orderIds } }).select('-gatewayResponse -authorizationUrl -accessCode').lean({ virtuals: true }) : [],
      orderIds.length ? OrderFulfilmentGroup.find({ orderId: { $in: orderIds } }).sort({ createdAt: 1 }).lean({ virtuals: true }) : [],
    ]);
    const itemMap = new Map<string, any[]>();
    (items as any[]).forEach((item) => itemMap.set(String(item.orderId), [...(itemMap.get(String(item.orderId)) || []), item]));
    const paymentMap = new Map<string, any[]>();
    (payments as any[]).forEach((payment) => paymentMap.set(String(payment.orderId), [...(paymentMap.get(String(payment.orderId)) || []), payment]));
    const groupMap = new Map<string, any[]>();
    (groups as any[]).forEach((group) => groupMap.set(String(group.orderId), [...(groupMap.get(String(group.orderId)) || []), group]));
    return orders.map((order) => {
      const orderPayments = paymentMap.get(order.id) || [];
      return { ...order, items: itemMap.get(order.id) || [], payment: orderPayments[0], payments: orderPayments, fulfilmentGroups: groupMap.get(order.id) || [] };
    }) as any;
  }

  async getCustomerOrder(owner: CustomerOwner, id: string) {
    const identifier = id.match(/^[a-f\d]{24}$/i) ? { $or: [{ _id: id }, { publicId: id }, { orderCode: id }] } : { $or: [{ publicId: id }, { orderCode: id }] };
    const order = await Order.findOne({ ...identifier, ...this.ownerWhere(owner) }).lean({ virtuals: true });
    if (!order) throw new HttpError(404, 'Order not found');
    const [items, payments, fulfilmentGroups] = await Promise.all([
      OrderItem.find({ orderId: order.id }).lean({ virtuals: true }),
      Payment.find({ orderId: order.id }).select('-gatewayResponse -authorizationUrl -accessCode').lean({ virtuals: true }),
      OrderFulfilmentGroup.find({ orderId: order.id }).sort({ createdAt: 1 }).lean({ virtuals: true }),
    ]);
    return { ...order, items, payment: payments[0], payments, fulfilmentGroups } as any;
  }

  async cancelCustomerOrder(owner: CustomerOwner, id: string, reason?: string) {
    const order = await this.getCustomerOrder(owner, id);
    if (![OrderStatus.PENDING, OrderStatus.CONFIRMED].includes(order.status)) {
      throw new HttpError(400, 'This order can no longer be cancelled');
    }
    order.status = OrderStatus.CANCELLED;
    order.cancelledAt = new Date();
    order.cancellationReason = reason;
    const saved = await this.orders.save(order);
    publishRealtime({ type: 'order.updated', entityId: saved.publicId || saved.id, version: Number(saved.version || 1) }, { accountId: owner.userId, admin: true });
    return saved;
  }

  private ownerWhere(owner: CustomerOwner) {
    if (owner.userId) return { userId: owner.userId };
    throw new HttpError(401, 'Customer authentication required');
  }

  private async ensureGuestAccount(email: string, name: string, guestId?: string) {
    const users = AppDataSource.getRepository(User);
    const normalized = email.toLowerCase().trim();
    const existing = await users.findOne({ where: { email: normalized } });
    if (existing) return existing;
    const [firstName, ...last] = name.trim().split(/\s+/);
    const user = await users.save(users.create({
      publicId: await nextPublicId('customer'),
      accountType: AccountType.CUSTOMER,
      scopeType: ScopeType.SELF,
      email: normalized, firstName: firstName || '', lastName: last.join(' '),
      role: 'shopper' as any, isActive: true, isEmailVerified: false, isPhoneVerified: false,
      accountStatus: AccountStatus.PENDING_PASSWORD, originatingGuestId: guestId,
    }));
    const otps = AppDataSource.getRepository(Otp);
    await Otp.updateMany({ email: normalized, type: 'password_reset', isUsed: false }, { $set: { isUsed: true } });
    const code = String(randomInt(1000, 10000));
    await otps.save(otps.create({ email: normalized, code, type: 'password_reset', isUsed: false, expiresAt: new Date(Date.now() + 10 * 60 * 1000) }));
    if (process.env.NODE_ENV !== 'production') console.log(`[otp:dev] guest_password_setup for ${normalized}: ${code} (expires in 10m)`);
    await this.email.sendOtp({ email: normalized, code, name, purpose: 'password_reset', expiresInMinutes: 10 }).catch(() => undefined);
    return user;
  }
}
