import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SettlementsService } from './settlements.service';
import { CurrentUser, Roles } from '@common/decorators';
import { UserRole } from '@common/constants';
import { success } from '@common/dto/api-response.dto';

@ApiTags('Settlements')
@ApiBearerAuth()
@Controller('settlements')
export class SettlementsController {
  constructor(private readonly settlementsService: SettlementsService) {}

  @Get('me')
  @ApiOperation({ summary: 'Get my settlement summary (vendor)' })
  async mySummary(@CurrentUser('sub') vendorId: string) {
    return success({
      summary: await this.settlementsService.getSummary(vendorId),
      history: await this.settlementsService.findByVendor(vendorId),
    });
  }

  @Get(':vendorId')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Get vendor settlement details (admin)' })
  async byVendor(@Param('vendorId') vendorId: string) {
    return success({
      summary: await this.settlementsService.getSummary(vendorId),
      history: await this.settlementsService.findByVendor(vendorId),
    });
  }
}
