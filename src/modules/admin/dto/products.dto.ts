import { IsString, IsOptional, IsNumber, Min, IsIn } from 'class-validator';
import { ProductStatus } from '@common/constants';

export class ApproveProductDto {
  @IsString()
  @IsIn([ProductStatus.APPROVED, ProductStatus.REJECTED])
  status!: ProductStatus.APPROVED | ProductStatus.REJECTED;

  @IsOptional()
  @IsString()
  reviewNote?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  adjustedSellingPrice?: number;
}
