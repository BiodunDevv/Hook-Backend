import { IsString, IsOptional, IsNumber, IsBoolean } from 'class-validator';

export class UpdateSystemConfigDto {
  @IsOptional()
  @IsNumber()
  defaultCommissionPercentage?: number;

  @IsOptional()
  @IsNumber()
  deliveryFeePerKm?: number;

  @IsOptional()
  @IsNumber()
  baseDeliveryFee?: number;

  @IsOptional()
  @IsBoolean()
  maintenanceMode?: boolean;

  @IsOptional()
  @IsString()
  maintenanceMessage?: string;
}
