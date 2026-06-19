import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';
import { Product } from '@modules/products/entities/product.entity';
import { Vendor } from '@modules/vendors/entities/vendor.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Product, Vendor])],
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule {}
