import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NegotiationController } from './negotiation.controller';
import { NegotiationService } from './negotiation.service';
import { Negotiation } from './entities/negotiation.entity';
import { Product } from '@modules/products/entities/product.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Negotiation, Product])],
  controllers: [NegotiationController],
  providers: [NegotiationService],
  exports: [NegotiationService],
})
export class NegotiationModule {}
