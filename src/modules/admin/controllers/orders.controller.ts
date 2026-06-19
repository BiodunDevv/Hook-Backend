import { Controller, Get, Patch, Param, Query, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Roles } from '@common/decorators';
import { UserRole, OrderStatus } from '@common/constants';
import { success } from '@common/dto/api-response.dto';
import { OrdersService } from '../services/orders.service';
import { UpdateOrderStatusDto } from '../dto/orders.dto';

@ApiTags('Admin')
@ApiBearerAuth()
@Controller('admin/orders')
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
  @ApiOperation({ summary: 'List all orders with filters' })
  async getOrders(
    @Query('page') page = 1,
    @Query('limit') limit = 20,
    @Query('status') status?: OrderStatus,
  ) {
    return success(await this.ordersService.getAllOrders(page, limit, status));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get full order detail with all relations' })
  async getOrderDetail(@Param('id') id: string) {
    return success(await this.ordersService.getOrderDetail(id));
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Update order status (admin override)' })
  async updateOrderStatus(@Param('id') id: string, @Body() dto: UpdateOrderStatusDto) {
    return success(await this.ordersService.updateOrderStatus(id, dto.status, dto.reason));
  }
}
