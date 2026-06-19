import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Order } from './entities/order.entity';
import { OrderItem } from './entities/order-item.entity';
import { Cart } from '@modules/cart/entities/cart.entity';
import { CartItem } from '@modules/cart/entities/cart-item.entity';
import { Product } from '@modules/products/entities/product.entity';
import { OrderStatus, PaymentStatus } from '@common/constants';

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    @InjectRepository(Order) private orderRepo: Repository<Order>,
    @InjectRepository(OrderItem) private orderItemRepo: Repository<OrderItem>,
    @InjectRepository(Cart) private cartRepo: Repository<Cart>,
    @InjectRepository(CartItem) private cartItemRepo: Repository<CartItem>,
    @InjectRepository(Product) private productRepo: Repository<Product>,
  ) {}

  async createFromCart(userId: string, deliveryAddress: Order['deliveryAddress'], notes?: string) {
    const cart = await this.cartRepo.findOne({
      where: { userId, isCheckedOut: false },
      relations: ['items', 'items.product', 'items.product.vendor'],
    });
    if (!cart || cart.items.length === 0) throw new BadRequestException('Cart is empty');

    // Check stock
    for (const item of cart.items) {
      if (item.product.quantity < item.quantity) {
        throw new BadRequestException(`Insufficient stock: ${item.product.title}`);
      }
    }

    const orderCode = `HK-${Date.now().toString(36).toUpperCase()}-${userId.substring(0, 4).toUpperCase()}`;
    const vendorIds = [...new Set(cart.items.map(i => i.product.vendorId))];

    const order = this.orderRepo.create({
      userId,
      orderCode,
      subtotal: cart.subtotal,
      deliveryFee: cart.deliveryFee,
      total: cart.total,
      deliveryAddress,
      deliveryNotes: notes,
      vendorCount: vendorIds.length,
      status: OrderStatus.PENDING,
    });

    const savedOrder = await this.orderRepo.save(order);

    // Create order items and decrement stock
    for (const item of cart.items) {
      const orderItem = this.orderItemRepo.create({
        orderId: savedOrder.id,
        productId: item.productId,
        productTitle: item.product.title,
        productImage: item.product.images?.[0],
        vendorId: item.product.vendorId,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        totalPrice: item.totalPrice,
        selectedVariants: item.selectedVariants,
        commissionAmount: item.totalPrice * 0.15,
      });
      await this.orderItemRepo.save(orderItem);

      await this.productRepo.decrement({ id: item.productId }, 'quantity', item.quantity);
      await this.productRepo.increment({ id: item.productId }, 'orderCount', item.quantity);
    }

    // Clear cart
    await this.cartItemRepo.delete({ cartId: cart.id });
    cart.isCheckedOut = true;
    await this.cartRepo.save(cart);

    this.logger.log(`Order ${orderCode} created for user ${userId}`);
    return this.orderRepo.findOne({ where: { id: savedOrder.id }, relations: ['items', 'items.vendor'] });
  }

  async findByUser(userId: string, page = 1, limit = 20) {
    const [data, total] = await this.orderRepo.findAndCount({
      where: { userId },
      relations: ['items', 'items.product'],
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string) {
    const order = await this.orderRepo.findOne({ where: { id }, relations: ['items', 'items.product', 'payment', 'logistics'] });
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }

  async updateStatus(id: string, status: OrderStatus, reason?: string) {
    const order = await this.findOne(id);
    order.status = status;
    if (status === OrderStatus.DELIVERED) order.deliveredAt = new Date();
    if (status === OrderStatus.CANCELLED) { order.cancelledAt = new Date(); order.cancellationReason = reason; }
    return this.orderRepo.save(order);
  }

  async findAll(page = 1, limit = 20) {
    const [data, total] = await this.orderRepo.findAndCount({
      relations: ['user', 'items'],
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }
}
