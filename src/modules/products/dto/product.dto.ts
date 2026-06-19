import {
  IsString, IsNumber, IsOptional, IsUUID, IsArray, Min, MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PaginationQueryDto } from '@common/dto/pagination.dto';
import { ProductStatus } from '@common/constants';

export class CreateProductDto {
  @IsString()
  @MaxLength(255)
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsNumber()
  costPrice!: number;

  @IsNumber()
  sellingPrice!: number;

  @IsOptional()
  @IsNumber()
  discountedPrice?: number;

  @IsNumber()
  @Min(0)
  minAcceptablePrice!: number;

  @IsNumber()
  @Min(0)
  quantity!: number;

  @IsUUID()
  categoryId!: string;

  @IsOptional()
  @IsArray()
  colors?: string[];

  @IsOptional()
  @IsArray()
  sizes?: string[];

  @IsOptional()
  @IsArray()
  images?: string[];
}

export class UpdateProductDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsNumber()
  sellingPrice?: number;

  @IsOptional()
  @IsNumber()
  discountedPrice?: number;

  @IsOptional()
  @IsNumber()
  quantity?: number;

  @IsOptional()
  @IsArray()
  colors?: string[];

  @IsOptional()
  @IsArray()
  sizes?: string[];

  @IsOptional()
  @IsArray()
  images?: string[];
}

export class ProductFilterDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsUUID()
  vendorId?: string;

  @IsOptional()
  @IsString()
  status?: ProductStatus;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  minPrice?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  maxPrice?: number;
}
