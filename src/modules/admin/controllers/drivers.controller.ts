import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Roles } from '@common/decorators';
import { UserRole } from '@common/constants';
import { success } from '@common/dto/api-response.dto';
import { DriversService } from '../services/drivers.service';

@ApiTags('Admin')
@ApiBearerAuth()
@Controller('admin/dispatch')
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
export class DriversController {
  constructor(private readonly driversService: DriversService) {}

  @Get('active')
  @ApiOperation({ summary: 'Get all active deliveries in transit' })
  async getActiveDeliveries() {
    return success(await this.driversService.getActiveDeliveries());
  }

  @Get()
  @ApiOperation({ summary: 'Get all delivery records' })
  async getAllDeliveries(@Query('page') page = 1, @Query('limit') limit = 20) {
    return success(await this.driversService.getAllDeliveries(page, limit));
  }

  @Get('drivers')
  @ApiOperation({ summary: 'List available EV drivers' })
  async getAvailableDrivers() {
    return success(await this.driversService.getAvailableDrivers());
  }
}
