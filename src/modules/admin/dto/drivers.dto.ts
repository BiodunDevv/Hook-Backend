import { IsUUID } from 'class-validator';

export class AssignDriverDto {
  @IsUUID()
  orderId!: string;

  @IsUUID()
  driverId!: string;
}
