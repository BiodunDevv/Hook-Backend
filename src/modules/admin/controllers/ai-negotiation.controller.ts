import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Roles } from '@common/decorators';
import { UserRole } from '@common/constants';
import { success } from '@common/dto/api-response.dto';
import { AINegotiationService } from '../services/ai-negotiation.service';

@ApiTags('Admin')
@ApiBearerAuth()
@Controller('admin/negotiations')
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
export class AINegotiationController {
  constructor(private readonly aiNegotiationService: AINegotiationService) {}

  @Get()
  @ApiOperation({ summary: 'View negotiation activity & conversion stats' })
  async getNegotiations(@Query('page') page = 1, @Query('limit') limit = 20) {
    return success(await this.aiNegotiationService.getNegotiations(page, limit));
  }
}
