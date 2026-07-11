import type { MongoRepository as Repository } from '@lib/mongo-repository';
import { AppDataSource } from '@config/data-source';
import { DELIVERY_SLA_HOURS, ESCROW_HOLD_HOURS, OrderStatus, PaymentStatus, SettlementStatus, VENDOR_COMMISSION_PERCENTAGE } from '@lib/constants';
import { EmailService } from '@emails/email.service';
import { Cart } from '@models/cart/cart.model';
import { CartItem } from '@models/cart/cart-item.model';
import { Logistics } from '@models/logistics/logistics.model';
import { OrderItem } from '@models/orders/order-item.model';
import { Order } from '@models/orders/order.model';
import { Product } from '@models/products/product.model';
import { Settlement } from '@models/settlements/settlement.model';
import { User } from '@models/users/user.model';
import { Vendor } from '@models/vendors/vendor.model';
import { CustomerOwner } from './cart.service';
import { HttpError } from '@utils/http';

type CheckoutBody = Pick<Order, 'deliveryAddress' | 'deliveryNotes' | 'scheduledDeliveryAt' | 'guestEmail' | 'guestName'>;

export class OrderService {
  private readonly email = new EmailService();

  constructor(
    private readonly carts: Repository<Cart>,
    private readonly cartItems: Repository<CartItem>,
    private readonly orders: Repository<Order>,
    private readonly orderItems: Repository<OrderItem>,
    private readonly products: Repository<Product>,
    private readonly logistics: Repository<Logistics>,
    private readonly settlements: Repository<Settlement>,
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

    const vendorIds = [...new Set(cartItems.map((item) => item.product.vendorId))];
    const order = await this.orders.save(this.orders.create({
      orderCode: `HK-${Date.now().toString().slice(-8)}`,
      ...where,
      guestEmail: body.guestEmail,
      guestName: body.guestName,
      subtotal: cart.subtotal,
      deliveryFee: cart.deliveryFee,
      discount: 0,
      total: cart.total,
      vendorCount: vendorIds.length,
      status: OrderStatus.PENDING,
      paymentStatus: PaymentStatus.UNPAID,
      deliveryAddress: body.deliveryAddress,
      deliveryNotes: body.deliveryNotes,
      scheduledDeliveryAt: body.scheduledDeliveryAt,
    }));

    await Promise.all(cartItems.map(async (item) => {
      const product = item.product;
      await this.orderItems.save(this.orderItems.create({
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
      }));
      await this.products.update(product.id, {
        quantity: Math.max(0, product.quantity - item.quantity),
        reservedQuantity: Math.max(0, product.reservedQuantity - item.quantity),
        orderCount: product.orderCount + 1,
      });
    }));

    await this.createSettlements(order.id, cartItems);
    await this.logistics.save(this.logistics.create({
      orderId: order.id,
      deliveryLocation: {
        address: `${body.deliveryAddress.street}, ${body.deliveryAddress.city}, ${body.deliveryAddress.state}`,
        coordinates: body.deliveryAddress.coordinates || { lat: 0, lng: 0 },
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
    if (customerEmail) {
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
    await Promise.all(vendorIds.map(async (vendorId) => {
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
    if (hookOpsEmail) {
      await this.email.sendHookNewOrder({
        to: hookOpsEmail,
        customerName: customerName || 'Customer',
        orderCode: order.orderCode,
        amount: order.total,
        itemCount,
      });
    }

    return this.orders.findOne({
      where: { id: order.id },
      relations: { items: true, logistics: true },
    });
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

  private async createSettlements(orderId: string, items: CartItem[]) {
    const byVendor = new Map<string, { itemTotal: number; commissionAmount: number }>();
    for (const item of items) {
      const vendorId = item.product.vendorId;
      const current = byVendor.get(vendorId) || { itemTotal: 0, commissionAmount: 0 };
      current.itemTotal += item.totalPrice;
      current.commissionAmount += item.totalPrice * (VENDOR_COMMISSION_PERCENTAGE / 100);
      byVendor.set(vendorId, current);
    }

    await Promise.all([...byVendor.entries()].map(([vendorId, totals]) =>
      this.settlements.save(this.settlements.create({
        vendorId,
        orderId,
        itemTotal: totals.itemTotal,
        commissionAmount: totals.commissionAmount,
        netAmount: totals.itemTotal - totals.commissionAmount,
        deliveryFeePortion: 0,
        status: SettlementStatus.PENDING_ESCROW,
        escrowReleaseAt: new Date(Date.now() + ESCROW_HOLD_HOURS * 60 * 60 * 1000),
      })),
    ));
  }

  private ownerWhere(owner: CustomerOwner) {
    if (owner.userId) return { userId: owner.userId };
    if (owner.guestId) return { guestId: owner.guestId };
    throw new HttpError(401, 'Authentication or guest session required');
  }
}
