import { IsString, IsOptional, IsIn, IsUUID } from 'class-validator';
import { OrderStatus } from '@common/constants';

export class UpdateOrderStatusDto {
  @IsString()
  @IsIn([
    OrderStatus.CONFIRMED, OrderStatus.PROCESSING, OrderStatus.PACKED,
    OrderStatus.IN_TRANSIT, OrderStatus.DELIVERED, OrderStatus.CANCELLED,
  ])
  status!: OrderStatus;

  @IsOptional()
  @IsString()
  reason?: string;
}

export class AssignDriverDto {
  @IsUUID()
  orderId!: string;

  @IsUUID()
  driverId!: string;
}
