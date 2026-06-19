import { Controller, Get, Patch, Param, Body, Post, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Roles, Public } from '@common/decorators';
import { UserRole } from '@common/constants';
import { success, created } from '@common/dto/api-response.dto';
import { BoothsAdminService } from '../services/booths.service';

@ApiTags('Admin')
@ApiBearerAuth()
@Controller('admin/booths')
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
export class BoothsController {
  constructor(private readonly boothsAdminService: BoothsAdminService) {}

  @Get()
  @ApiOperation({ summary: 'Get all booths with analytics' })
  async getBooths(@Query('page') page = 1, @Query('limit') limit = 20) {
    return success(await this.boothsAdminService.getBooths(page, limit));
  }

  @Get('analytics')
  @ApiOperation({ summary: 'Get booth analytics summary' })
  async getAnalytics() {
    return success(await this.boothsAdminService.getAnalytics());
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get booth details' })
  async getBooth(@Param('id') id: string) {
    return success(await this.boothsAdminService.getBooth(id));
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Toggle booth active status' })
  async toggleStatus(@Param('id') id: string) {
    return success(await this.boothsAdminService.toggleStatus(id));
  }

  @Post()
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Provision a new booth' })
  async createBooth(@Body() dto: { name: string; location: any }) {
    return created(await this.boothsAdminService.createBooth(dto));
  }
}
