import { Controller, Post, Get, Patch, Body, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { FieldAgentService } from './field-agent.service';
import { CurrentUser, Roles } from '@common/decorators';
import { UserRole } from '@common/constants';
import { success, created } from '@common/dto/api-response.dto';

@ApiTags('Field Agent')
@ApiBearerAuth()
@Controller('field-agents')
export class FieldAgentController {
  constructor(private readonly fieldAgentService: FieldAgentService) {}

  @Post('assign')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Assign field agent to market (admin)' })
  async assign(
    @Body() dto: { agentId: string; assignedMarket: string; coverageLat?: number; coverageLng?: number; radiusKm?: number },
  ) {
    const coverage = dto.coverageLat ? { lat: dto.coverageLat, lng: dto.coverageLng!, radiusKm: dto.radiusKm || 5 } : undefined;
    return created(await this.fieldAgentService.assign(dto.agentId, dto.assignedMarket, coverage));
  }

  @Get('me')
  @ApiOperation({ summary: 'Get my field agent profile' })
  async myProfile(@CurrentUser('sub') agentId: string) {
    return success(await this.fieldAgentService.findByAgent(agentId));
  }

  @Get()
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'List all field agents (admin)' })
  async findAll() {
    return success(await this.fieldAgentService.findAll());
  }
}
