import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BrevoService } from './brevo.service';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [BrevoService],
  exports: [BrevoService],
})
export class BrevoModule {}
