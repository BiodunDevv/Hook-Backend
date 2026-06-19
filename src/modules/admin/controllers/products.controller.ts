import { Controller, Get, Patch, Param, Query, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Roles } from '@common/decorators';
import { UserRole, ProductStatus } from '@common/constants';
import { success } from '@common/dto/api-response.dto';
import { ProductsService } from '../services/products.service';
import { ApproveProductDto } from '../dto/products.dto';

@ApiTags('Admin')
@ApiBearerAuth()
@Controller('admin/products')
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get('review')
  @ApiOperation({ summary: 'Get QA review queue — products pending approval' })
  async getReviewQueue(@Query('page') page = 1, @Query('limit') limit = 20) {
    return success(await this.productsService.getProductsForReview(page, limit));
  }

  @Get()
  @ApiOperation({ summary: 'Get full product catalog with filters' })
  async getProducts(
    @Query('page') page = 1,
    @Query('limit') limit = 20,
    @Query('status') status?: ProductStatus,
    @Query('vendorId') vendorId?: string,
  ) {
    return success(await this.productsService.getProductCatalog(page, limit, status, vendorId));
  }

  @Patch(':id/review')
  @ApiOperation({ summary: 'Approve or reject a product listing' })
  async reviewProduct(@Param('id') id: string, @Body() dto: ApproveProductDto) {
    return success(await this.productsService.reviewProduct(id, dto.status, dto.reviewNote, dto.adjustedSellingPrice));
  }
}
