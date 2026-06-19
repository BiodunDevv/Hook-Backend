import { Injectable, NotFoundException, ConflictException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Vendor } from './entities/vendor.entity';
import { User } from '@modules/users/entities/user.entity';
import { VendorTier } from '@common/constants';

@Injectable()
export class VendorsService {
  private readonly logger = new Logger(VendorsService.name);

  constructor(
    @InjectRepository(Vendor) private vendorRepo: Repository<Vendor>,
    @InjectRepository(User) private userRepo: Repository<User>,
  ) {}

  async register(ownerId: string, dto: Partial<Vendor>) {
    const existing = await this.vendorRepo.findOne({ where: { ownerId } });
    if (existing) throw new ConflictException('User already registered as vendor');

    const vendor = this.vendorRepo.create({ ...dto, ownerId, tier: VendorTier.TIER_3 });
    await this.vendorRepo.save(vendor);

    await this.userRepo.update(ownerId, { role: 'vendor' as any });
    this.logger.log(`Vendor registered: ${dto.businessName} by user ${ownerId}`);
    return vendor;
  }

  async findAll(page = 1, limit = 20) {
    const [data, total] = await this.vendorRepo.findAndCount({
      relations: ['owner'],
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string) {
    const vendor = await this.vendorRepo.findOne({ where: { id }, relations: ['owner', 'products'] });
    if (!vendor) throw new NotFoundException('Vendor not found');
    return vendor;
  }

  async findByOwner(ownerId: string) {
    return this.vendorRepo.findOne({ where: { ownerId }, relations: ['products'] });
  }

  async update(id: string, dto: Partial<Vendor>) {
    const vendor = await this.findOne(id);
    Object.assign(vendor, dto);
    return this.vendorRepo.save(vendor);
  }

  async approve(id: string) {
    const vendor = await this.findOne(id);
    vendor.isApproved = true;
    vendor.approvedAt = new Date();
    return this.vendorRepo.save(vendor);
  }

  async updateTier(id: string, tier: VendorTier) {
    const vendor = await this.findOne(id);
    vendor.tier = tier;
    return this.vendorRepo.save(vendor);
  }

  async updatePaymentInfo(id: string, bankDetails: Vendor['bankDetails']) {
    const vendor = await this.findOne(id);
    vendor.bankDetails = bankDetails;
    return this.vendorRepo.save(vendor);
  }
}
