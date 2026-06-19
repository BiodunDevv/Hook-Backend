import { Controller, Get, Post, Query, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Roles } from '@common/decorators';
import { UserRole } from '@common/constants';
import { success, created } from '@common/dto/api-response.dto';
import { ReportsService } from '../services/reports.service';
import { GenerateReportDto } from '../dto/reports.dto';

@ApiTags('Admin')
@ApiBearerAuth()
@Controller('admin/reports')
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get()
  @ApiOperation({ summary: 'List all generated reports' })
  async getReports(@Query('page') page = 1, @Query('limit') limit = 20): Promise<any> {
    return success(await this.reportsService.getReports(page, limit));
  }

  @Post('generate')
  @ApiOperation({ summary: 'Generate a new analytics report' })
  async generateReport(@Body() dto: GenerateReportDto) {
    return created(await this.reportsService.generateReport(dto));
  }
}
