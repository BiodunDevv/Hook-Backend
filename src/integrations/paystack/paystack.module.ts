import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PaystackService } from './paystack.service';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [PaystackService],
  exports: [PaystackService],
})
export class PaystackModule {}
