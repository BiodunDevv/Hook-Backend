import { Repository } from 'typeorm';
import { LogisticsStatus, UserRole } from '@lib/constants';
import { FieldAgent } from '@models/field-agents/field-agent.model';
import { Logistics } from '@models/logistics/logistics.model';
import { User } from '@models/users/user.model';
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
    record.status = status;
    if (status === LogisticsStatus.AT_PICKUP) record.pickedUpAt = new Date();
    if (status === LogisticsStatus.DELIVERED) record.deliveredAt = new Date();
    if (body.deliveryProof) record.deliveryProof = body.deliveryProof;
    if (body.trackingPath) record.trackingPath = body.trackingPath;
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
