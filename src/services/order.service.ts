import type { MongoRepository as Repository } from '@lib/mongo-repository';
import { DELIVERY_SLA_HOURS, ESCROW_HOLD_HOURS, OrderStatus, PaymentStatus, SettlementStatus, VENDOR_COMMISSION_PERCENTAGE } from '@lib/constants';
import { Cart } from '@models/cart/cart.model';
import { CartItem } from '@models/cart/cart-item.model';
import { Logistics } from '@models/logistics/logistics.model';
import { OrderItem } from '@models/orders/order-item.model';
import { Order } from '@models/orders/order.model';
import { Product } from '@models/products/product.model';
import { Settlement } from '@models/settlements/settlement.model';
import { HttpError } from '@utils/http';

export class OrderService {
  constructor(
    private readonly carts: Repository<Cart>,
    private readonly cartItems: Repository<CartItem>,
    private readonly orders: Repository<Order>,
    private readonly orderItems: Repository<OrderItem>,
    private readonly products: Repository<Product>,
    private readonly logistics: Repository<Logistics>,
    private readonly settlements: Repository<Settlement>,
  ) {}

  async checkout(userId: string, body: Pick<Order, 'deliveryAddress' | 'deliveryNotes' | 'scheduledDeliveryAt'>) {
    const cart = await this.carts.findOne({
      where: { userId, isCheckedOut: false },
      relations: { items: { product: { vendor: true } } },
    });
    if (cart) cart.items = cart.items || await this.cartItems.find({ where: { cartId: cart.id }, relations: { product: true } });
    const cartItems = cart?.items || [];
    if (!cart || !cartItems.length) throw new HttpError(400, 'Cart is empty');

    const vendorIds = [...new Set(cartItems.map((item) => item.product.vendorId))];
    const order = await this.orders.save(this.orders.create({
      orderCode: `HK-${Date.now().toString().slice(-8)}`,
      userId,
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

    return this.orders.findOne({
      where: { id: order.id },
      relations: { items: true, logistics: true },
    });
  }

  async listCustomerOrders(userId: string) {
    return this.orders.find({
      where: { userId },
      relations: { items: true, payment: true, logistics: true },
      order: { createdAt: 'DESC' },
    });
  }

  async getCustomerOrder(userId: string, id: string) {
    const order = await this.orders.findOne({
      where: { id, userId },
      relations: { items: true, payment: true, logistics: true },
    });
    if (!order) throw new HttpError(404, 'Order not found');
    return order;
  }

  async cancelCustomerOrder(userId: string, id: string, reason?: string) {
    const order = await this.getCustomerOrder(userId, id);
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
}
