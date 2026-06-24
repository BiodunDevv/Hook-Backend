import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Logistics } from './entities/logistics.entity';
import { Order } from '@modules/orders/entities/order.entity';
import { LogisticsStatus } from '@common/constants';

@Injectable()
export class LogisticsService {
  private readonly logger = new Logger(LogisticsService.name);

  constructor(
    @InjectRepository(Logistics) private logisticsRepo: Repository<Logistics>,
    @InjectRepository(Order) private orderRepo: Repository<Order>,
  ) {}

  async assignDriver(orderId: string, driverId: string) {
    const existing = await this.logisticsRepo.findOne({ where: { orderId } });
    if (existing) throw new BadRequestException('Driver already assigned');

    const logistics = this.logisticsRepo.create({ orderId, driverId, status: LogisticsStatus.ASSIGNED });
    await this.logisticsRepo.save(logistics);
    this.logger.log(`Driver ${driverId} assigned to order ${orderId}`);
    return logistics;
  }

  async recordPickup(logisticsId: string, qrCodeRef: string, vendorOtp: string) {
    const log = await this.logisticsRepo.findOne({ where: { id: logisticsId } });
    if (!log) throw new NotFoundException('Logistics record not found');

    log.status = LogisticsStatus.ITEM_PACKED;
    log.qrCodeRef = qrCodeRef;
    log.vendorOtp = vendorOtp;
    log.pickedUpAt = new Date();
    return this.logisticsRepo.save(log);
  }

  async verifyOtp(logisticsId: string, otp: string) {
    const log = await this.logisticsRepo.findOne({ where: { id: logisticsId } });
    if (!log) throw new NotFoundException('Logistics record not found');
    if (log.vendorOtp !== otp) throw new BadRequestException('Invalid OTP');

    log.otpVerifiedAt = new Date();
    log.status = LogisticsStatus.QR_TAGGED;
    return this.logisticsRepo.save(log);
  }

  async confirmDelivery(logisticsId: string, proof?: string) {
    const log = await this.logisticsRepo.findOne({ where: { id: logisticsId } });
    if (!log) throw new NotFoundException('Logistics record not found');

    log.status = LogisticsStatus.DELIVERED;
    log.deliveredAt = new Date();
    if (proof) log.deliveryProof = proof;

    // Update order status
    await this.orderRepo.update(log.orderId, { status: 'delivered' as any, deliveredAt: new Date() });
    return this.logisticsRepo.save(log);
  }

  async getByDriver(driverId: string) {
    return this.logisticsRepo.find({
      where: { driverId },
      relations: {
  order: true
},
      order: { createdAt: 'DESC' },
    });
  }

  async getByOrder(orderId: string) {
    const log = await this.logisticsRepo.findOne({ where: { orderId }, relations: {
  order: true,
  driver: true
} });
    if (!log) throw new NotFoundException('Logistics record not found');
    return log;
  }

  async updateLocation(logisticsId: string, lat: number, lng: number) {
    const log = await this.logisticsRepo.findOne({ where: { id: logisticsId } });
    if (!log) throw new NotFoundException('Logistics record not found');
    const trackingPath = log.trackingPath || [];
    trackingPath.push({ lat, lng, timestamp: new Date().toISOString() });
    log.trackingPath = trackingPath;
    return this.logisticsRepo.save(log);
  }
}
