import type { MongoRepository as Repository } from '@lib/mongo-repository';
import { AppDataSource } from '@config/data-source';
import { DEFAULT_DELIVERY_FEE, DELIVERY_SLA_HOURS, OrderStatus, OrderType, PaymentMode, PaymentStatus, ProductStatus, VENDOR_COMMISSION_PERCENTAGE, VENDOR_CONFIRMATION_HOURS } from '@lib/constants';
import { EmailService } from '@emails/email.service';
import { Cart } from '@models/cart/cart.model';
import { CartItem } from '@models/cart/cart-item.model';
import { Logistics } from '@models/logistics/logistics.model';
import { OrderItem } from '@models/orders/order-item.model';
import { Order } from '@models/orders/order.model';
import { Product } from '@models/products/product.model';
import { Settlement } from '@models/settlements/settlement.model';
import { VendorFulfilment } from '@models/orders/vendor-fulfilment.model';
import { User } from '@models/users/user.model';
import { Vendor } from '@models/vendors/vendor.model';
import { CustomerOwner } from './cart.service';
import { HttpError } from '@utils/http';
import { Otp } from '@models/auth/otp.model';
import { randomInt } from 'crypto';
import { BoothAccessService } from './booth-access.service';
import { Booth } from '@models/booths/booth.model';
import { BoothInventory } from '@models/booths/booth-inventory.model';

type CheckoutBody = Pick<Order, 'deliveryAddress' | 'deliveryNotes' | 'scheduledDeliveryAt' | 'guestEmail' | 'guestName' | 'paymentMode' | 'orderType' | 'giftRecipient'> & { boothSessionToken?: string };

export class OrderService {
  private readonly email = new EmailService();
  private readonly boothAccess = new BoothAccessService();

  constructor(
    private readonly carts: Repository<Cart>,
    private readonly cartItems: Repository<CartItem>,
    private readonly orders: Repository<Order>,
    private readonly orderItems: Repository<OrderItem>,
    private readonly products: Repository<Product>,
    private readonly logistics: Repository<Logistics>,
    private readonly settlements: Repository<Settlement>,
    private readonly fulfilments: Repository<VendorFulfilment>,
  ) {}

  async checkout(owner: CustomerOwner, body: CheckoutBody) {
    const where = this.ownerWhere(owner);
    if (!owner.userId && (!body.guestEmail || !body.guestName)) {
      throw new HttpError(400, 'Guest checkout requires a name and email address');
    }
    const cart = await this.carts.findOne({
      where: { ...where, isCheckedOut: false },
      relations: { items: { product: { vendor: true } } },
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

    let booth: any;
    let attendant: any;
    if (cart.boothId) {
      if (!body.boothSessionToken) throw new HttpError(401, 'A valid booth session is required at checkout');
      const session = this.boothAccess.verifySession(body.boothSessionToken);
      booth = await this.boothAccess.assertCurrent(session);
      if (booth.id !== cart.boothId || session.version !== cart.boothSessionVersion) throw new HttpError(409, 'Your booth session no longer matches this cart');
      const assignedCount = await BoothInventory.countDocuments({ boothId: booth.id, productId: { $in: cartItems.map((item) => item.productId) }, isActive: true });
      if (assignedCount !== new Set(cartItems.map((item) => item.productId)).size) throw new HttpError(409, 'One or more products are no longer available from this booth');
      attendant = booth.attendantUserId ? await User.findById(booth.attendantUserId).lean({ virtuals: true }) : undefined;
    }

    const vendorIds = [...new Set(cartItems.map((item) => item.product.vendorId))];
    for (const item of cartItems) {
      const available = Number(item.product.quantity || 0) - Number(item.product.reservedQuantity || 0);
      if (available < item.quantity) throw new HttpError(409, `${item.product.title} no longer has enough available stock`);
    }
    const confirmationDeadline = new Date(Date.now() + Number(process.env.VENDOR_CONFIRMATION_HOURS || VENDOR_CONFIRMATION_HOURS) * 60 * 60 * 1000);
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
      vendorCount: vendorIds.length,
      status: body.paymentMode === PaymentMode.PAY_NOW ? OrderStatus.AWAITING_PAYMENT : OrderStatus.PENDING,
      paymentStatus: PaymentStatus.UNPAID,
      paymentMode: body.paymentMode || PaymentMode.PAY_NOW,
      orderType: body.orderType || OrderType.STANDARD,
      giftRecipient: body.giftRecipient,
      deliveryAddress: body.orderType === OrderType.GIFT && body.giftRecipient ? body.giftRecipient.address : body.deliveryAddress,
      boothId: booth?.id,
      boothSnapshot: booth ? { name: booth.name, accessCodeMasked: `***${String(booth.accessCodeVersion).padStart(3, '0')}`, source: cart.boothSource || 'code' } : undefined,
      attendantSnapshot: attendant ? { userId: attendant.id, name: `${attendant.firstName || ''} ${attendant.lastName || ''}`.trim(), email: attendant.email, phone: attendant.phone || '' } : undefined,
      vendorConfirmationDeadline: confirmationDeadline,
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
          commissionAmount: item.totalPrice * (VENDOR_COMMISSION_PERCENTAGE / 100),
        })));
      }
    } catch (error) {
      await Promise.all(reservations.map(({ productId, quantity }) => Product.findByIdAndUpdate(productId, { $inc: { reservedQuantity: -quantity } })));
      await this.orderItems.delete({ orderId: order.id });
      await this.orders.delete(order.id);
      throw error;
    }
    await Promise.all(vendorIds.map(async (vendorId) => {
      const vendorItems = createdItems.filter((item: any) => item.vendorId === vendorId);
      const itemTotal = vendorItems.reduce((sum: number, item: any) => sum + item.totalPrice, 0);
      await this.fulfilments.save(this.fulfilments.create({
        orderId: order.id,
        vendorId,
        orderItemIds: vendorItems.map((item: any) => item.id),
        status: 'awaiting_confirmation' as any,
        itemTotal,
        commissionAmount: itemTotal * (VENDOR_COMMISSION_PERCENTAGE / 100),
        refundAmount: 0,
        confirmationDeadline,
        idempotencyKeys: [],
      }));
    }));
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
    const vendorRepo = AppDataSource.getRepository(Vendor);
    const userRepo = AppDataSource.getRepository(User);
    if (body.paymentMode === PaymentMode.PAY_ON_DELIVERY) await Promise.all(vendorIds.map(async (vendorId) => {
      const vendor = await vendorRepo.findOne({ where: { id: vendorId } });
      const owner = vendor?.ownerId ? await userRepo.findOne({ where: { id: vendor.ownerId } }) : undefined;
      if (!vendor || !owner?.email) return;
      const vendorItems = cartItems.filter((item) => item.product.vendorId === vendorId);
      const vendorTotal = vendorItems.reduce((sum, item) => sum + Number(item.totalPrice || 0), 0);
      const vendorItemCount = vendorItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
      await this.email.sendVendorNewOrder({
        to: owner.email,
        name: `${owner.firstName || ''} ${owner.lastName || ''}`.trim(),
        vendorName: vendor.businessName,
        customerName: customerName || 'Customer',
        orderCode: order.orderCode,
        amount: vendorTotal,
        itemCount: vendorItemCount,
      });
    }));
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
    return { ...result, provisionalAccount: provisionalUser?.accountStatus === 'pending_password' ? { email: provisionalUser.email, nextStep: 'set_password' } : undefined };
  }

  async listCustomerOrders(owner: CustomerOwner) {
    return this.orders.find({
      where: this.ownerWhere(owner),
      relations: { items: true, payment: true, logistics: true },
      order: { createdAt: 'DESC' },
    });
  }

  async getCustomerOrder(owner: CustomerOwner, id: string) {
    const order = await this.orders.findOne({
      where: { id, ...this.ownerWhere(owner) },
      relations: { items: true, payment: true, logistics: true },
    });
    if (!order) throw new HttpError(404, 'Order not found');
    return order;
  }

  async cancelCustomerOrder(owner: CustomerOwner, id: string, reason?: string) {
    const order = await this.getCustomerOrder(owner, id);
    if (![OrderStatus.PENDING, OrderStatus.CONFIRMED].includes(order.status)) {
      throw new HttpError(400, 'This order can no longer be cancelled');
    }
    order.status = OrderStatus.CANCELLED;
    order.cancelledAt = new Date();
    order.cancellationReason = reason;
    return this.orders.save(order);
  }

  private ownerWhere(owner: CustomerOwner) {
    if (owner.userId) return { userId: owner.userId };
    if (owner.guestId) return { guestId: owner.guestId };
    throw new HttpError(401, 'Authentication or guest session required');
  }

  private async ensureGuestAccount(email: string, name: string, guestId?: string) {
    const users = AppDataSource.getRepository(User);
    const normalized = email.toLowerCase().trim();
    const existing = await users.findOne({ where: { email: normalized } });
    if (existing) return existing;
    const [firstName, ...last] = name.trim().split(/\s+/);
    const user = await users.save(users.create({
      email: normalized, firstName: firstName || '', lastName: last.join(' '),
      role: 'shopper' as any, isActive: true, isEmailVerified: false, isPhoneVerified: false,
      accountStatus: 'pending_password', originatingGuestId: guestId,
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
