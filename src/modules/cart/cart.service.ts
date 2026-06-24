import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cart } from './entities/cart.entity';
import { CartItem } from './entities/cart-item.entity';
import { Product } from '@modules/products/entities/product.entity';

@Injectable()
export class CartService {
  constructor(
    @InjectRepository(Cart) private cartRepo: Repository<Cart>,
    @InjectRepository(CartItem) private cartItemRepo: Repository<CartItem>,
    @InjectRepository(Product) private productRepo: Repository<Product>,
  ) {}

  async getCart(userId: string) {
    let cart = await this.cartRepo.findOne({
      where: { userId, isCheckedOut: false },
      relations: {
  items: {
    product: true
  }
},
    });
    if (!cart) {
      cart = this.cartRepo.create({ userId, items: [], subtotal: 0, deliveryFee: 0, total: 0 });
      cart = await this.cartRepo.save(cart);
    }
    return cart;
  }

  async addItem(userId: string, productId: string, quantity: number, variants?: { color?: string; size?: string }) {
    const cart = await this.getCart(userId);
    const product = await this.productRepo.findOne({ where: { id: productId } });
    if (!product) throw new NotFoundException('Product not found');
    if (product.quantity < quantity) throw new BadRequestException('Insufficient stock');

    // Check if item already in cart
    const existing = cart.items.find(i => i.productId === productId);
    if (existing) {
      existing.quantity += quantity;
      existing.totalPrice = existing.unitPrice * existing.quantity;
      await this.cartItemRepo.save(existing);
    } else {
      const item = this.cartItemRepo.create({
        cartId: cart.id,
        productId,
        quantity,
        unitPrice: product.discountedPrice || product.sellingPrice,
        totalPrice: (product.discountedPrice || product.sellingPrice) * quantity,
        selectedVariants: variants,
      });
      await this.cartItemRepo.save(item);
    }

    return this.recalculateCart(cart.id);
  }

  async updateItemQuantity(userId: string, itemId: string, quantity: number) {
    if (quantity < 1) return this.removeItem(userId, itemId);
    const item = await this.cartItemRepo.findOne({ where: { id: itemId }, relations: {
  cart: true
} });
    if (!item || item.cart.userId !== userId) throw new NotFoundException('Cart item not found');
    item.quantity = quantity;
    item.totalPrice = item.unitPrice * quantity;
    await this.cartItemRepo.save(item);
    return this.recalculateCart(item.cartId);
  }

  async removeItem(userId: string, itemId: string) {
    const item = await this.cartItemRepo.findOne({ where: { id: itemId }, relations: {
  cart: true
} });
    if (!item || item.cart.userId !== userId) throw new NotFoundException('Cart item not found');
    await this.cartItemRepo.remove(item);
    return this.recalculateCart(item.cartId);
  }

  async clearCart(userId: string) {
    const cart = await this.getCart(userId);
    await this.cartItemRepo.delete({ cartId: cart.id });
    cart.subtotal = 0; cart.deliveryFee = 0; cart.total = 0;
    return this.cartRepo.save(cart);
  }

  private async recalculateCart(cartId: string) {
    const cart = await this.cartRepo.findOne({ where: { id: cartId }, relations: {
  items: {
    product: true
  }
} });
    if (!cart) throw new NotFoundException('Cart not found');
    cart.subtotal = cart.items.reduce((sum, i) => sum + i.totalPrice, 0);
    cart.deliveryFee = cart.subtotal > 0 ? 1500 : 0; // Flat ₦1500 delivery
    cart.total = cart.subtotal + cart.deliveryFee;
    return this.cartRepo.save(cart);
  }
}
