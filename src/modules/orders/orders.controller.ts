import { Controller, Get, Post, Patch, Param, Body, Query, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { OrdersService } from './orders.service';
import { CurrentUser, Roles } from '@common/decorators';
import { UserRole, OrderStatus } from '@common/constants';
import { success, created } from '@common/dto/api-response.dto';

@ApiTags('Orders')
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @ApiBearerAuth()
  @Post('checkout')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create order from cart (checkout)' })
  async checkout(
    @CurrentUser('sub') userId: string,
    @Body() dto: { deliveryAddress: Record<string, unknown>; notes?: string },
  ) {
    return created(
      await this.ordersService.createFromCart(userId, dto.deliveryAddress as any, dto.notes),
      'Order placed successfully',
    );
  }

  @ApiBearerAuth()
  @Get()
  @ApiOperation({ summary: 'Get my orders' })
  async myOrders(
    @CurrentUser('sub') userId: string,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return success(await this.ordersService.findByUser(userId, page, limit));
  }

  @ApiBearerAuth()
  @Get(':id')
  @ApiOperation({ summary: 'Get order details' })
  async findOne(@Param('id') id: string) {
    return success(await this.ordersService.findOne(id));
  }

  @ApiBearerAuth()
  @Patch(':id/status')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Update order status (admin)' })
  async updateStatus(
    @Param('id') id: string,
    @Body() dto: { status: OrderStatus; reason?: string },
  ) {
    return success(await this.ordersService.updateStatus(id, dto.status, dto.reason));
  }

  @ApiBearerAuth()
  @Get('admin/all')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'List all orders (admin)' })
  async allOrders(@Query('page') page = 1, @Query('limit') limit = 20) {
    return success(await this.ordersService.findAll(page, limit));
  }
}
