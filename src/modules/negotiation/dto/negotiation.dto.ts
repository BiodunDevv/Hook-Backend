import { IsString, IsNumber, IsUUID, Min, Max, IsOptional } from 'class-validator';

export class InitiateNegotiationDto {
  @IsUUID()
  productId!: string;

  @IsNumber()
  @Min(1)
  offeredPrice!: number;
}

export class CounterOfferDto {
  @IsNumber()
  @Min(1)
  counterPrice!: number;
}

export class AcceptPriceDto {
  @IsNumber()
  @Min(1)
  acceptedPrice!: number;
}
