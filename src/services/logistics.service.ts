import type { MongoRepository as Repository } from '@lib/mongo-repository';
import { LogisticsStatus, OrderStatus, PaymentMode, PaymentStatus, UserRole } from '@lib/constants';
import { FieldAgent } from '@models/field-agents/field-agent.model';
import { Logistics } from '@models/logistics/logistics.model';
import { User } from '@models/users/user.model';
import { Order } from '@models/orders/order.model';
import { HttpError } from '@utils/http';

export class LogisticsService {
  constructor(
    private readonly users: Repository<User>,
    private readonly logistics: Repository<Logistics>,
    private readonly fieldAgents: Repository<FieldAgent>,
  ) {}

  async assignDriver(orderId: string, driverId: string) {
    const driver = await this.users.findOne({ where: { id: driverId, role: UserRole.EV_DRIVER, isActive: true } });
    if (!driver) throw new HttpError(404, 'Active driver not found');
    let record = await this.logistics.findOne({ where: { orderId } });
    record = record || this.logistics.create({ orderId });
    record.driverId = driverId;
    record.status = LogisticsStatus.ASSIGNED;
    return this.logistics.save(record);
  }

  async jobs(driverId: string) {
    return this.logistics.find({
      where: { driverId },
      relations: { order: true },
      order: { updatedAt: 'DESC' },
    });
  }

  async updateDriverJob(driverId: string, id: string, status: LogisticsStatus, body: Partial<Logistics>) {
    const record = await this.logistics.findOne({ where: { id, driverId } });
    if (!record) throw new HttpError(404, 'Delivery job not found');
    const transitions: Partial<Record<LogisticsStatus, LogisticsStatus[]>> = {
      [LogisticsStatus.ASSIGNED]: [LogisticsStatus.DRIVER_ACKNOWLEDGED, LogisticsStatus.AT_PICKUP, LogisticsStatus.FAILED],
      [LogisticsStatus.DRIVER_ACKNOWLEDGED]: [LogisticsStatus.AT_PICKUP, LogisticsStatus.FAILED],
      [LogisticsStatus.AT_PICKUP]: [LogisticsStatus.ITEM_PACKED, LogisticsStatus.FAILED],
      [LogisticsStatus.ITEM_PACKED]: [LogisticsStatus.QR_TAGGED, LogisticsStatus.IN_TRANSIT, LogisticsStatus.FAILED],
      [LogisticsStatus.QR_TAGGED]: [LogisticsStatus.IN_TRANSIT, LogisticsStatus.FAILED],
      [LogisticsStatus.IN_TRANSIT]: [LogisticsStatus.DELIVERED, LogisticsStatus.FAILED],
    };
    if (record.status !== status && !transitions[record.status]?.includes(status)) {
      throw new HttpError(409, `Cannot move delivery from ${record.status} to ${status}`);
    }
    const order = await Order.findById(record.orderId);
    if (!order) throw new HttpError(404, 'Order not found');
    if (status === LogisticsStatus.DELIVERED && order.paymentMode === PaymentMode.PAY_ON_DELIVERY && order.paymentStatus !== PaymentStatus.SUCCESSFUL) {
      throw new HttpError(409, 'Verified OPay collection is required before Pay on Delivery completion');
    }
    record.status = status;
    if (status === LogisticsStatus.AT_PICKUP) record.pickedUpAt = new Date();
    if (status === LogisticsStatus.IN_TRANSIT) order.status = OrderStatus.SHIPPED;
    if (status === LogisticsStatus.DELIVERED) {
      record.deliveredAt = new Date();
      order.status = OrderStatus.DELIVERED;
      order.deliveredAt = new Date();
    }
    if (body.deliveryProof) record.deliveryProof = body.deliveryProof;
    if (body.trackingPath) record.trackingPath = body.trackingPath;
    await order.save();
    return this.logistics.save(record);
  }

  async verifyOtp(driverId: string, id: string, otp: string) {
    const record = await this.logistics.findOne({ where: { id, driverId } });
    if (!record) throw new HttpError(404, 'Delivery job not found');
    if (record.vendorOtp && record.vendorOtp !== otp) throw new HttpError(400, 'Invalid pickup OTP');
    record.otpVerifiedAt = new Date();
    record.status = LogisticsStatus.ITEM_PACKED;
    return this.logistics.save(record);
  }

  async fieldProfile(agentId: string) {
    const profile = await this.fieldAgents.findOne({ where: { agentId }, relations: { booths: true } });
    if (!profile) throw new HttpError(404, 'Field agent profile not found');
    return profile;
  }
}
