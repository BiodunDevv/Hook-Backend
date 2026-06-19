import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Vendor } from '@modules/vendors/entities/vendor.entity';
import { VendorTier } from '@common/constants';

@Injectable()
export class VendorsService {
  private readonly logger = new Logger(VendorsService.name);

  constructor(
    @InjectRepository(Vendor) private vendorRepo: Repository<Vendor>,
  ) {}

  async getVendors(page = 1, limit = 20, approved?: boolean) {
    const where: any = {};
    if (approved !== undefined) where.isApproved = approved;

    const [data, total] = await this.vendorRepo.findAndCount({
      where,
      relations: ['owner'],
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async approveVendor(vendorId: string) {
    const vendor = await this.vendorRepo.findOne({ where: { id: vendorId }, relations: ['owner'] });
    if (!vendor) throw new NotFoundException('Vendor not found');
    vendor.isApproved = true;
    vendor.approvedAt = new Date();
    await this.vendorRepo.save(vendor);
    this.logger.log(`Vendor approved: ${vendor.businessName}`);
    return vendor;
  }

  async rejectVendor(vendorId: string, reason?: string) {
    const vendor = await this.vendorRepo.findOne({ where: { id: vendorId } });
    if (!vendor) throw new NotFoundException('Vendor not found');
    vendor.isApproved = false;
    await this.vendorRepo.save(vendor);
    this.logger.log(`Vendor rejected: ${vendor.businessName} - ${reason || 'No reason'}`);
    return { id: vendor.id, businessName: vendor.businessName, isApproved: false, reason };
  }

  async updateVendorTier(vendorId: string, tier: VendorTier, commissionPercentage?: number) {
    const vendor = await this.vendorRepo.findOne({ where: { id: vendorId } });
    if (!vendor) throw new NotFoundException('Vendor not found');
    vendor.tier = tier;
    if (commissionPercentage !== undefined) vendor.commissionPercentage = commissionPercentage;
    await this.vendorRepo.save(vendor);
    return vendor;
  }
}
