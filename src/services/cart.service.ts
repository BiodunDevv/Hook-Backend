import { Repository } from 'typeorm';
import { Cart } from '@models/cart/cart.model';
import { CartItem } from '@models/cart/cart-item.model';
import { Product } from '@models/products/product.model';
import { HttpError } from '@utils/http';

export class CartService {
  constructor(
    private readonly carts: Repository<Cart>,
    private readonly items: Repository<CartItem>,
    private readonly products: Repository<Product>,
  ) {}

  async getCart(userId: string) {
    let cart = await this.carts.findOne({
      where: { userId, isCheckedOut: false },
      relations: { items: { product: true } },
    });
    if (!cart) {
      cart = await this.carts.save(this.carts.create({ userId, subtotal: 0, deliveryFee: 0, total: 0 }));
      cart.items = [];
    }
    return cart;
  }

  async addItem(userId: string, productId: string, quantity: number, selectedVariants?: CartItem['selectedVariants']) {
    const product = await this.products.findOne({ where: { id: productId } });
    if (!product) throw new HttpError(404, 'Product not found');
    if (product.quantity < quantity) throw new HttpError(400, 'Insufficient stock for this product');

    const cart = await this.getCart(userId);
    const existing = cart.items.find((item) => item.productId === productId);
    const unitPrice = product.discountedPrice || product.sellingPrice;

    if (existing) {
      existing.quantity += quantity;
      existing.totalPrice = existing.quantity * existing.unitPrice;
      existing.selectedVariants = selectedVariants ?? existing.selectedVariants;
      await this.items.save(existing);
    } else {
      await this.items.save(this.items.create({
        cartId: cart.id,
        productId,
        quantity,
        unitPrice,
        totalPrice: unitPrice * quantity,
        selectedVariants,
      }));
    }

    return this.recalculate(cart.id);
  }

  async updateItem(userId: string, itemId: string, quantity: number) {
    const cart = await this.getCart(userId);
    const item = await this.items.findOne({ where: { id: itemId, cartId: cart.id } });
    if (!item) throw new HttpError(404, 'Cart item not found');
    item.quantity = quantity;
    item.totalPrice = quantity * item.unitPrice;
    await this.items.save(item);
    return this.recalculate(cart.id);
  }

  async removeItem(userId: string, itemId: string) {
    const cart = await this.getCart(userId);
    await this.items.delete({ id: itemId, cartId: cart.id });
    return this.recalculate(cart.id);
  }

  async clear(userId: string) {
    const cart = await this.getCart(userId);
    await this.items.delete({ cartId: cart.id });
    return this.recalculate(cart.id);
  }

  async recalculate(cartId: string) {
    const cart = await this.carts.findOne({
      where: { id: cartId },
      relations: { items: { product: true } },
    });
    if (!cart) throw new HttpError(404, 'Cart not found');
    cart.subtotal = cart.items.reduce((sum, item) => sum + item.totalPrice, 0);
    cart.deliveryFee = cart.items.length ? Number(process.env.DEFAULT_DELIVERY_FEE || 1500) : 0;
    cart.total = cart.subtotal + cart.deliveryFee;
    await this.carts.save(cart);
    return cart;
  }
}
