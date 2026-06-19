import { IsString, IsOptional, IsNumber, Min, Max, IsIn } from 'class-validator';
import { VendorTier } from '@common/constants';

export class UpdateVendorTierDto {
  @IsString()
  @IsIn([VendorTier.TIER_1, VendorTier.TIER_2, VendorTier.TIER_3])
  tier!: VendorTier;

  @IsOptional()
  @IsNumber()
  @Min(0)
  commissionPercentage?: number;
}

export class VendorCommissionDto {
  @IsNumber()
  @Min(0)
  @Max(100)
  commissionPercentage!: number;
}
