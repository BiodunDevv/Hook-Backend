import { Controller, Get, Patch, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Roles } from '@common/decorators';
import { UserRole } from '@common/constants';
import { success } from '@common/dto/api-response.dto';
import { SettingsService } from '../services/settings.service';
import { UpdateSystemConfigDto } from '../dto/settings.dto';

@ApiTags('Admin')
@ApiBearerAuth()
@Controller('admin/settings')
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  @ApiOperation({ summary: 'Get platform settings' })
  async getSettings(): Promise<any> {
    return success(await this.settingsService.getSettings());
  }

  @Patch()
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Update platform settings' })
  async updateSettings(@Body() dto: UpdateSystemConfigDto): Promise<any> {
    return success(await this.settingsService.updateSettings(dto));
  }
}
