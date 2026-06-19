import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '@modules/users/entities/user.entity';
import { Logistics } from '@modules/logistics/entities/logistics.entity';
import { UserRole } from '@common/constants';

@Injectable()
export class DriversService {
  constructor(
    @InjectRepository(User) private userRepo: Repository<User>,
    @InjectRepository(Logistics) private logisticsRepo: Repository<Logistics>,
  ) {}

  async getActiveDeliveries() {
    return this.logisticsRepo.find({
      where: { status: 'in_transit' as any },
      relations: ['order', 'order.user', 'driver'],
      order: { updatedAt: 'DESC' },
    });
  }

  async getAllDeliveries(page = 1, limit = 20) {
    const [data, total] = await this.logisticsRepo.findAndCount({
      relations: ['order', 'driver'],
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getAvailableDrivers() {
    const drivers = await this.userRepo.find({
      where: { role: UserRole.EV_DRIVER, isActive: true },
      select: ['id', 'firstName', 'lastName', 'email', 'phone'],
    });

    const busyDriverIds = (await this.logisticsRepo.find({
      where: { status: 'in_transit' as any },
      select: ['driverId'],
    })).map(l => l.driverId).filter(Boolean);

    return drivers.map(d => ({
      ...d,
      isAvailable: !busyDriverIds.includes(d.id),
    }));
  }
}
