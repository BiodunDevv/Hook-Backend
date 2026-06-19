import {
  Controller, Get, Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { Roles } from '@common/decorators';
import { UserRole } from '@common/constants';
import { success } from '@common/dto/api-response.dto';
import { DashboardService } from '../services/dashboard.service';
import { AnalyticsQueryDto } from '../dto/dashboard.dto';

@ApiTags('Admin')
@ApiBearerAuth()
@Controller('admin')
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'Get admin dashboard — all key metrics' })
  async getDashboard() {
    return success(await this.dashboardService.getDashboard());
  }

  @Get('analytics')
  @ApiOperation({ summary: 'Get granular analytics with trend data' })
  async getAnalytics(@Query() query: AnalyticsQueryDto) {
    return success(await this.dashboardService.getAnalytics(query.from, query.to, query.period));
  }

  @Get('health')
  @ApiOperation({ summary: 'System health check' })
  async getHealth() {
    return success(await this.dashboardService.getSystemHealth());
  }
}
