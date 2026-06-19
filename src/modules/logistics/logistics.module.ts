import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Logistics } from './entities/logistics.entity';
import { Order } from '@modules/orders/entities/order.entity';
import { LogisticsService } from './logistics.service';
import { LogisticsController } from './logistics.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Logistics, Order])],
  controllers: [LogisticsController],
  providers: [LogisticsService],
  exports: [LogisticsService],
})
export class LogisticsModule {}
