import { Controller, Get, Patch, Param, Query, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { Roles } from '@common/decorators';
import { UserRole } from '@common/constants';
import { success } from '@common/dto/api-response.dto';
import { VendorsService } from '../services/vendors.service';
import { UpdateVendorTierDto } from '../dto/vendors.dto';

@ApiTags('Admin')
@ApiBearerAuth()
@Controller('admin/vendors')
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
export class VendorsController {
  constructor(private readonly vendorsService: VendorsService) {}

  @Get()
  @ApiOperation({ summary: 'List all vendors' })
  @ApiQuery({ name: 'approved', required: false })
  async getVendors(
    @Query('page') page = 1,
    @Query('limit') limit = 20,
    @Query('approved') approved?: string,
  ) {
    const approvedBool = approved === 'true' ? true : approved === 'false' ? false : undefined;
    return success(await this.vendorsService.getVendors(page, limit, approvedBool));
  }

  @Patch(':id/approve')
  @ApiOperation({ summary: 'Approve a vendor' })
  async approveVendor(@Param('id') id: string) {
    return success(await this.vendorsService.approveVendor(id));
  }

  @Patch(':id/reject')
  @ApiOperation({ summary: 'Reject a vendor application' })
  async rejectVendor(@Param('id') id: string, @Body('reason') reason?: string) {
    return success(await this.vendorsService.rejectVendor(id, reason));
  }

  @Patch(':id/tier')
  @ApiOperation({ summary: "Update vendor's tier & commission" })
  async updateVendorTier(@Param('id') id: string, @Body() dto: UpdateVendorTierDto) {
    return success(await this.vendorsService.updateVendorTier(id, dto.tier, dto.commissionPercentage));
  }
}
