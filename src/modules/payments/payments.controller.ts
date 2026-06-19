import { Controller, Post, Get, Body, Param, Query, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { PaymentsService } from './payments.service';
import { CurrentUser, Roles, Public } from '@common/decorators';
import { UserRole } from '@common/constants';
import { success, created } from '@common/dto/api-response.dto';

@ApiTags('Payments')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @ApiBearerAuth()
  @Post('initialize/:orderId')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Initialize payment for an order' })
  async initialize(@CurrentUser('sub') userId: string, @Param('orderId') orderId: string) {
    return success(await this.paymentsService.initiatePayment(orderId, userId));
  }

  @ApiBearerAuth()
  @Get('verify/:reference')
  @ApiOperation({ summary: 'Verify payment by transaction reference' })
  async verify(@Param('reference') reference: string) {
    return success(await this.paymentsService.verifyPayment(reference));
  }

  @ApiBearerAuth()
  @Get('order/:orderId')
  @ApiOperation({ summary: 'Get payment for an order' })
  async getByOrder(@Param('orderId') orderId: string) {
    return success(await this.paymentsService.getPaymentByOrder(orderId));
  }

  @Public()
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Payment gateway webhook' })
  async webhook(@Body() body: any) {
    return success(await this.paymentsService.handleWebhook(body));
  }

  @ApiBearerAuth()
  @Get('admin/all')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'List all payments (admin)' })
  async all(@Query('page') page = 1, @Query('limit') limit = 20) {
    return success(await this.paymentsService.getAllPayments(page, limit));
  }
}
