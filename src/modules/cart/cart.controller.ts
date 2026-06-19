import { Controller, Get, Post, Patch, Delete, Body, Param, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { CartService } from './cart.service';
import { CurrentUser } from '@common/decorators';
import { success } from '@common/dto/api-response.dto';

@ApiTags('Cart')
@ApiBearerAuth()
@Controller('cart')
export class CartController {
  constructor(private readonly cartService: CartService) {}

  @Get()
  @ApiOperation({ summary: 'Get current user cart' })
  async getCart(@CurrentUser('sub') userId: string) {
    return success(await this.cartService.getCart(userId));
  }

  @Post('items')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add item to cart' })
  async addItem(
    @CurrentUser('sub') userId: string,
    @Body() dto: { productId: string; quantity: number; color?: string; size?: string },
  ) {
    return success(await this.cartService.addItem(userId, dto.productId, dto.quantity, { color: dto.color, size: dto.size }));
  }

  @Patch('items/:itemId')
  @ApiOperation({ summary: 'Update cart item quantity' })
  async updateItem(
    @CurrentUser('sub') userId: string,
    @Param('itemId') itemId: string,
    @Body('quantity') quantity: number,
  ) {
    return success(await this.cartService.updateItemQuantity(userId, itemId, quantity));
  }

  @Delete('items/:itemId')
  @ApiOperation({ summary: 'Remove item from cart' })
  async removeItem(@CurrentUser('sub') userId: string, @Param('itemId') itemId: string) {
    return success(await this.cartService.removeItem(userId, itemId));
  }

  @Delete()
  @ApiOperation({ summary: 'Clear entire cart' })
  async clearCart(@CurrentUser('sub') userId: string) {
    return success(await this.cartService.clearCart(userId));
  }
}
