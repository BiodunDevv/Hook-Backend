import { Controller, Get, Post, Patch, Body, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { BoothsService } from './booths.service';
import { Roles, Public } from '@common/decorators';
import { UserRole } from '@common/constants';
import { success, created } from '@common/dto/api-response.dto';

@ApiTags('Booths')
@Controller('booths')
export class BoothsController {
  constructor(private readonly boothsService: BoothsService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Get all active booths' })
  async findAll() {
    return success(await this.boothsService.findAllActive());
  }

  @Public()
  @Get('nearby')
  @ApiOperation({ summary: 'Find nearest booths' })
  async nearby(@Query('lat') lat: number, @Query('lng') lng: number) {
    return success(await this.boothsService.findNearest(lat, lng));
  }

  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Get booth by ID' })
  async findOne(@Param('id') id: string) {
    return success(await this.boothsService.findOne(id));
  }

  @ApiBearerAuth()
  @Post()
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Create booth (admin)' })
  async create(@Body() dto: { name: string; address: string; lat: number; lng: number }) {
    return created(await this.boothsService.create({
      name: dto.name,
      location: { address: dto.address, lat: dto.lat, lng: dto.lng },
    }));
  }

  @ApiBearerAuth()
  @Patch(':id/featured')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Set featured products for booth (admin)' })
  async featured(@Param('id') id: string, @Body() dto: { productIds: string[] }) {
    return success(await this.boothsService.updateFeaturedProducts(id, dto.productIds));
  }
}
