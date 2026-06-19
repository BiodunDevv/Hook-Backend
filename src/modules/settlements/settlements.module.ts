import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SettlementsController } from './settlements.controller';
import { SettlementsService } from './settlements.service';
import { Settlement } from './entities/settlement.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Settlement])],
  controllers: [SettlementsController],
  providers: [SettlementsService],
  exports: [SettlementsService],
})
export class SettlementsModule {}
