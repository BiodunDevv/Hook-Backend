import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Order } from '@modules/orders/entities/order.entity';
import { OrderStatus } from '@common/constants';

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    @InjectRepository(Order) private orderRepo: Repository<Order>,
  ) {}

  async getAllOrders(page = 1, limit = 20, status?: OrderStatus) {
    const where: any = {};
    if (status) where.status = status;

    const [data, total] = await this.orderRepo.findAndCount({
      where,
      relations: ['user', 'items', 'items.product', 'payment'],
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async updateOrderStatus(orderId: string, status: OrderStatus, reason?: string) {
    const order = await this.orderRepo.findOne({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Order not found');
    order.status = status;
    if (status === OrderStatus.DELIVERED) order.deliveredAt = new Date();
    if (status === OrderStatus.CANCELLED) { order.cancelledAt = new Date(); order.cancellationReason = reason; }
    await this.orderRepo.save(order);
    this.logger.log(`Order ${order.orderCode} → ${status}`);
    return order;
  }

  async getOrderDetail(orderId: string) {
    const order = await this.orderRepo.findOne({
      where: { id: orderId },
      relations: ['user', 'items', 'items.product', 'items.vendor', 'payment', 'logistics', 'logistics.driver'],
    });
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }
}
