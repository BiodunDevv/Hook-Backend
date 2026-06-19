import { Controller, Get, Post, Put, Delete, Body, Param, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { CategoriesService } from './categories.service';
import { Roles, Public } from '@common/decorators';
import { UserRole } from '@common/constants';
import { success, created } from '@common/dto/api-response.dto';

@ApiTags('Categories')
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Get all active categories' })
  async findAll() {
    return success(await this.categoriesService.findAll());
  }

  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Get category by ID' })
  async findOne(@Param('id') id: string) {
    return success(await this.categoriesService.findOne(id));
  }

  @ApiBearerAuth()
  @Post()
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a category (admin)' })
  async create(@Body() dto: { name: string; iconUrl?: string; parentId?: string }) {
    return created(await this.categoriesService.create(dto));
  }

  @ApiBearerAuth()
  @Put(':id')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Update a category (admin)' })
  async update(@Param('id') id: string, @Body() dto: Partial<{ name: string; iconUrl: string; isActive: boolean }>) {
    return success(await this.categoriesService.update(id, dto));
  }

  @ApiBearerAuth()
  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Delete a category (admin)' })
  async remove(@Param('id') id: string) {
    return success(await this.categoriesService.remove(id));
  }
}
