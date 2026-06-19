import { Controller, Post, Patch, Get, Body, Param, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { LogisticsService } from './logistics.service';
import { CurrentUser, Roles } from '@common/decorators';
import { UserRole } from '@common/constants';
import { success, created } from '@common/dto/api-response.dto';

@ApiTags('Logistics')
@ApiBearerAuth()
@Controller('logistics')
export class LogisticsController {
  constructor(private readonly logisticsService: LogisticsService) {}

  @Post('assign')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Assign driver to order (admin)' })
  async assign(@Body() dto: { orderId: string; driverId: string }) {
    return created(await this.logisticsService.assignDriver(dto.orderId, dto.driverId));
  }

  @Patch(':id/pickup')
  @ApiOperation({ summary: 'Record item pickup with QR and OTP' })
  async pickup(
    @Param('id') id: string,
    @Body() dto: { qrCodeRef: string; vendorOtp: string },
  ) {
    return success(await this.logisticsService.recordPickup(id, dto.qrCodeRef, dto.vendorOtp));
  }

  @Patch(':id/verify-otp')
  @ApiOperation({ summary: 'Verify vendor OTP handshake' })
  async verifyOtp(@Param('id') id: string, @Body() dto: { otp: string }) {
    return success(await this.logisticsService.verifyOtp(id, dto.otp));
  }

  @Patch(':id/deliver')
  @ApiOperation({ summary: 'Confirm delivery' })
  async deliver(@Param('id') id: string, @Body() dto: { proof?: string }) {
    return success(await this.logisticsService.confirmDelivery(id, dto.proof));
  }

  @Patch(':id/location')
  @ApiOperation({ summary: 'Update real-time driver location' })
  async location(@Param('id') id: string, @Body() dto: { lat: number; lng: number }) {
    return success(await this.logisticsService.updateLocation(id, dto.lat, dto.lng));
  }

  @Get('driver/:driverId')
  @ApiOperation({ summary: 'Get logistics by driver' })
  async byDriver(@Param('driverId') driverId: string) {
    return success(await this.logisticsService.getByDriver(driverId));
  }

  @Get('order/:orderId')
  @ApiOperation({ summary: 'Get logistics by order' })
  async byOrder(@Param('orderId') orderId: string) {
    return success(await this.logisticsService.getByOrder(orderId));
  }
}
