import { Controller, Post, Get, Patch, Param, Body, Query, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { VendorsService } from './vendors.service';
import { CurrentUser, Roles } from '@common/decorators';
import { UserRole, VendorTier } from '@common/constants';
import { success, created } from '@common/dto/api-response.dto';

@ApiTags('Vendors')
@Controller('vendors')
export class VendorsController {
  constructor(private readonly vendorsService: VendorsService) {}

  @ApiBearerAuth()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register as a vendor' })
  async register(@CurrentUser('sub') userId: string, @Body() dto: { businessName: string; businessEmail?: string; businessPhone?: string; description?: string }) {
    return created(await this.vendorsService.register(userId, dto));
  }

  @ApiBearerAuth()
  @Get('me')
  @ApiOperation({ summary: 'Get my vendor profile' })
  async myProfile(@CurrentUser('sub') userId: string) {
    return success(await this.vendorsService.findByOwner(userId));
  }

  @ApiBearerAuth()
  @Get()
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'List all vendors (admin)' })
  async findAll(@Query('page') page = 1, @Query('limit') limit = 20) {
    return success(await this.vendorsService.findAll(page, limit));
  }

  @ApiBearerAuth()
  @Get(':id')
  @ApiOperation({ summary: 'Get vendor by ID' })
  async findOne(@Param('id') id: string) {
    return success(await this.vendorsService.findOne(id));
  }

  @ApiBearerAuth()
  @Patch(':id/approve')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Approve vendor (admin)' })
  async approve(@Param('id') id: string) {
    return success(await this.vendorsService.approve(id));
  }

  @ApiBearerAuth()
  @Patch(':id/tier')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Update vendor tier (admin)' })
  async updateTier(@Param('id') id: string, @Body() dto: { tier: VendorTier }) {
    return success(await this.vendorsService.updateTier(id, dto.tier));
  }

  @ApiBearerAuth()
  @Patch(':id/bank')
  @ApiOperation({ summary: 'Update bank details for settlement' })
  async updateBank(@Param('id') id: string, @Body() dto: { bankName: string; accountNumber: string; accountName: string; bankCode: string }) {
    return success(await this.vendorsService.updatePaymentInfo(id, dto));
  }
}
