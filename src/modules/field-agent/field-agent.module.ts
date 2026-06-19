import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FieldAgent } from './entities/field-agent.entity';
import { FieldAgentService } from './field-agent.service';
import { FieldAgentController } from './field-agent.controller';

@Module({
  imports: [TypeOrmModule.forFeature([FieldAgent])],
  controllers: [FieldAgentController],
  providers: [FieldAgentService],
  exports: [FieldAgentService],
})
export class FieldAgentModule {}
