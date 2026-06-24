import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { User } from '@modules/users/entities/user.entity';
import { UserRole } from '@common/constants';

@Injectable()
export class CustomersService {
  private readonly logger = new Logger(CustomersService.name);

  constructor(
    @InjectRepository(User) private userRepo: Repository<User>,
  ) {}

  async getUsers(page = 1, limit = 20, role?: string, search?: string) {
    const qb = this.userRepo.createQueryBuilder('u')
      .orderBy('u.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    if (role) qb.andWhere('u.role = :role', { role });
    if (search) {
      qb.andWhere('(u.email LIKE :search OR u.firstName LIKE :search OR u.lastName LIKE :search)', {
        search: `%${search}%`,
      });
    }

    const [data, total] = await qb.getManyAndCount();
    return {
      data: data.map(u => ({
        id: u.id, email: u.email, firstName: u.firstName, lastName: u.lastName,
        role: u.role, isActive: u.isActive, isEmailVerified: u.isEmailVerified,
        createdAt: u.createdAt, lastLoginAt: u.lastLoginAt,
      })),
      total, page, limit, totalPages: Math.ceil(total / limit),
    };
  }

  async getUserById(id: string) {
    const user = await this.userRepo.findOne({
      where: { id },
      relations: {
  vendors: true,
  orders: true
},
    });
    if (!user) throw new NotFoundException('User not found');
    const { password, ...rest } = user as any;
    return rest;
  }

  async toggleUserStatus(userId: string) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    user.isActive = !user.isActive;
    await this.userRepo.save(user);
    this.logger.log(`User ${userId} ${user.isActive ? 'activated' : 'deactivated'}`);
    return { id: user.id, isActive: user.isActive };
  }

  async updateUserRole(userId: string, role: UserRole) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    user.role = role;
    await this.userRepo.save(user);
    this.logger.log(`User ${userId} role changed to ${role}`);
    return { id: user.id, email: user.email, role: user.role };
  }

  async createUser(dto: { email: string; password: string; firstName: string; lastName: string; role?: UserRole }) {
    const existing = await this.userRepo.findOne({ where: { email: dto.email } });
    if (existing) throw new BadRequestException('Email already in use');
    const hashed = await bcrypt.hash(dto.password, 12);
    const user = this.userRepo.create({ ...dto, role: dto.role || UserRole.SHOPPER, password: hashed, isEmailVerified: true });
    await this.userRepo.save(user);
    this.logger.log(`Admin created user: ${user.email} (${user.role})`);
    const { password, ...rest } = user as any;
    return rest;
  }
}
