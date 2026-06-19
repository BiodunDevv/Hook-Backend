import { IsString, IsOptional, IsArray } from 'class-validator';

export class CreateBoothDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsArray()
  featuredProductIds?: string[];
}
