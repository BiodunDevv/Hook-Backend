import { IsString, IsOptional, IsNumber, Min } from 'class-validator';

export class AssignMarketDto {
  @IsString()
  market!: string;

  @IsOptional()
  @IsString()
  coverageArea?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  radiusKm?: number;
}
