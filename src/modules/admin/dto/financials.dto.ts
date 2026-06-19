import {
  IsOptional,
  IsString,
  IsDateString,
  IsUUID,
  IsInt,
  Min,
  Max,
  Matches,
} from 'class-validator';
import { Type } from 'class-transformer';

export class FinancialsQueryDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  maxDays?: number;
}

export class SettlementsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsString()
  status?: string;
}

export class TriggerSettlementDto {
  @IsUUID(4)
  vendorId!: string;

  @IsOptional()
  @IsString()
  @Matches(/^[a-zA-Z0-9_-]{8,64}$/, {
    message: 'idempotencyKey must be 8-64 alphanumeric characters',
  })
  idempotencyKey?: string;

  @IsOptional()
  @IsString()
  reason?: string;
}
