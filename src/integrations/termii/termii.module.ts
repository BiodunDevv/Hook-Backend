import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TermiiService } from './termii.service';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [TermiiService],
  exports: [TermiiService],
})
export class TermiiModule {}
