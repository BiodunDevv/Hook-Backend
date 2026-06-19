import { Controller, Get, Patch, Param, Query, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Roles } from '@common/decorators';
import { UserRole } from '@common/constants';
import { success } from '@common/dto/api-response.dto';
import { FieldAgentsService } from '../services/field-agents.service';

@ApiTags('Admin')
@ApiBearerAuth()
@Controller('admin/field-agents')
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
export class FieldAgentsController {
  constructor(private readonly fieldAgentsService: FieldAgentsService) {}

  @Get()
  @ApiOperation({ summary: 'List all field agents with stats' })
  async getFieldAgents(@Query('page') page = 1, @Query('limit') limit = 20) {
    return success(await this.fieldAgentsService.getFieldAgents(page, limit));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get field agent details' })
  async getFieldAgent(@Param('id') id: string) {
    return success(await this.fieldAgentsService.getFieldAgent(id));
  }

  @Patch(':id/toggle')
  @ApiOperation({ summary: 'Activate / deactivate field agent' })
  async toggleAgent(@Param('id') id: string) {
    return success(await this.fieldAgentsService.toggleAgentStatus(id));
  }
}
