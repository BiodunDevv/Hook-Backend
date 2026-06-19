import { IsString, IsOptional, IsIn } from 'class-validator';

export class GenerateReportDto {
  @IsString()
  @IsIn(['sales', 'vendor_performance', 'customer_analytics', 'logistics', 'custom'])
  type!: string;

  @IsOptional()
  period?: {
    from?: string;
    to?: string;
  };
}
