import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NombaService } from './nomba.service';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [NombaService],
  exports: [NombaService],
})
export class NombaModule {}
