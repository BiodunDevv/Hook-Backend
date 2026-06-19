import {
  Controller, Get, Post, Put, Patch, Delete, Body, Param, Query, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { ProductsService } from './products.service';
import { CreateProductDto, UpdateProductDto, ProductFilterDto } from './dto/product.dto';
import { CurrentUser, Roles, Public } from '@common/decorators';
import { UserRole, ProductStatus } from '@common/constants';
import { success, created } from '@common/dto/api-response.dto';
import { JwtPayload } from '@common/interfaces';

@ApiTags('Products')
@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'List products with filters & pagination' })
  async findAll(@Query() filter: ProductFilterDto) {
    return this.productsService.findAll(filter, filter);
  }

  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Get product by ID' })
  async findOne(@Param('id') id: string) {
    return success(await this.productsService.findOne(id));
  }

  @ApiBearerAuth()
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new product listing' })
  async create(@Body() dto: CreateProductDto, @CurrentUser() user: JwtPayload) {
    return created(await this.productsService.create(dto, user));
  }

  @ApiBearerAuth()
  @Put(':id')
  @ApiOperation({ summary: 'Update a product' })
  async update(@Param('id') id: string, @Body() dto: UpdateProductDto) {
    return success(await this.productsService.update(id, dto));
  }

  @ApiBearerAuth()
  @Patch(':id/status')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Approve/reject product (admin)' })
  async updateStatus(
    @Param('id') id: string,
    @Body('status') status: ProductStatus,
  ) {
    return success(await this.productsService.updateStatus(id, status));
  }

  @ApiBearerAuth()
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soft-delete a product' })
  async remove(@Param('id') id: string) {
    return success(await this.productsService.remove(id));
  }
}
