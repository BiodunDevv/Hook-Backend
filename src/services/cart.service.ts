import type { MongoRepository as Repository } from '@lib/mongo-repository';
import { Cart } from '@models/cart/cart.model';
import { CartItem } from '@models/cart/cart-item.model';
import { Product } from '@models/products/product.model';
import { HttpError } from '@utils/http';
import { DEFAULT_DELIVERY_FEE } from '@lib/constants';
import { BoothAccessService } from './booth-access.service';
import { BoothInventory } from '@models/booths/booth-inventory.model';
import { Booth } from '@models/booths/booth.model';
import { normalizeProductColor, normalizeProductColors } from '@lib/product-color';

export type CustomerOwner = { userId?: string; guestId?: string };

export class CartService {
  private readonly boothAccess = new BoothAccessService();
  constructor(
    private readonly carts: Repository<Cart>,
    private readonly items: Repository<CartItem>,
    private readonly products: Repository<Product>,
  ) {}

  async getCart(owner: CustomerOwner, boothSessionToken?: string) {
    const where = this.ownerWhere(owner);
    let cart: any = await this.carts.findOne({
      where: { ...where, isCheckedOut: false },
      relations: { items: { product: true } },
    });
    if (!cart) {
      cart = await this.carts.save(this.carts.create({ ...where, subtotal: 0, deliveryFee: 0, total: 0 }));
      cart.items = [];
    }
    cart.items = cart.items || await this.items.find({ where: { cartId: cart.id }, relations: { product: true } });
    return this.enrichCart(cart, boothSessionToken);
  }

  async addItem(owner: CustomerOwner, productId: string, quantity: number, selectedVariants?: CartItem['selectedVariants'], boothSessionToken?: string) {
    const product = await this.products.findOne({ where: { id: productId } });
    if (!product) throw new HttpError(404, 'Product not found');
    const availableQuantity = Math.max(0, product.quantity - Number(product.reservedQuantity || 0));
    if (availableQuantity < quantity) throw new HttpError(400, 'Insufficient stock for this product');
    this.validateVariants(product, selectedVariants);

    const cart = await this.getCart(owner);
    if (boothSessionToken) {
      const session = this.boothAccess.verifySession(boothSessionToken);
      await this.boothAccess.assertCurrent(session);
      if (cart.boothId && cart.boothId !== session.boothId && (cart.items || []).length) {
        throw new HttpError(409, 'Your cart belongs to another booth. Clear it before switching booths.');
      }
      const assigned = await BoothInventory.exists({ boothId: session.boothId, productId, isActive: true });
      if (!assigned) throw new HttpError(409, 'This product is not available from the selected booth');
      cart.boothId = session.boothId;
      cart.boothSessionVersion = session.version;
      cart.boothSource = session.source;
      await this.carts.save(cart);
    } else if (cart.boothId) {
      throw new HttpError(401, 'A valid booth session is required for this cart');
    }
    const variantKey = this.variantKey(selectedVariants);
    const existing = (cart.items || []).find((item: any) => item.productId === productId && (item.variantKey || 'default') === variantKey);
    const unitPrice = product.discountedPrice || product.sellingPrice;

    if (existing) {
      if (availableQuantity < existing.quantity + quantity) throw new HttpError(400, 'Insufficient stock for the requested quantity');
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
        variantKey,
      }));
    }

    return this.recalculate(cart.id);
  }

  async updateItem(owner: CustomerOwner, itemId: string, quantity: number) {
    const cart = await this.getCart(owner);
    const item = await this.items.findOne({ where: { id: itemId, cartId: cart.id } });
    if (!item) throw new HttpError(404, 'Cart item not found');
    const product = await this.products.findOne({ where: { id: item.productId } });
    if (!product) throw new HttpError(409, 'This product is no longer available');
    const availableQuantity = Math.max(0, product.quantity - Number(product.reservedQuantity || 0));
    if (quantity > availableQuantity) throw new HttpError(400, `Only ${availableQuantity} item${availableQuantity === 1 ? '' : 's'} available`);
    if (cart.boothId && !(await BoothInventory.exists({ boothId: cart.boothId, productId: item.productId, isActive: true }))) {
      throw new HttpError(409, 'This product is no longer available from the selected booth');
    }
    item.quantity = quantity;
    item.totalPrice = quantity * item.unitPrice;
    await this.items.save(item);
    return this.recalculate(cart.id);
  }

  async removeItem(owner: CustomerOwner, itemId: string) {
    const cart = await this.getCart(owner);
    await this.items.delete({ id: itemId, cartId: cart.id });
    return this.recalculate(cart.id);
  }

  async clear(owner: CustomerOwner) {
    const cart = await this.getCart(owner);
    await this.items.delete({ cartId: cart.id });
    cart.boothId = undefined;
    cart.boothSessionVersion = undefined;
    cart.boothSource = undefined;
    await this.carts.save(cart);
    return this.recalculate(cart.id);
  }

  async recalculate(cartId: string) {
    const cart = await this.carts.findOne({
      where: { id: cartId },
      relations: { items: { product: true } },
    });
    if (!cart) throw new HttpError(404, 'Cart not found');
    cart.items = cart.items || [];
    cart.subtotal = cart.items.reduce((sum, item) => sum + item.totalPrice, 0);
    cart.deliveryFee = cart.items.length ? Number(process.env.DEFAULT_DELIVERY_FEE || DEFAULT_DELIVERY_FEE) : 0;
    cart.total = cart.subtotal + cart.deliveryFee;
    await this.carts.save(cart);
    return this.enrichCart(cart);
  }

  private variantKey(selected?: CartItem['selectedVariants']) {
    const color = String(selected?.color || '').trim().toLowerCase();
    const size = String(selected?.size || '').trim().toLowerCase();
    return color || size ? `${color || '-'}::${size || '-'}` : 'default';
  }

  private validateVariants(product: Product, selected?: CartItem['selectedVariants']) {
    if (product.colors?.length && !selected?.color) throw new HttpError(400, 'Choose a product color');
    if (product.sizes?.length && !selected?.size) throw new HttpError(400, 'Choose a product size');
    if (selected?.color && product.colors?.length && !normalizeProductColors(product.colors).includes(normalizeProductColor(selected.color) || '')) throw new HttpError(400, 'Selected color is unavailable');
    if (selected?.size && product.sizes?.length && !product.sizes.map((value) => value.toLowerCase()).includes(selected.size.toLowerCase())) throw new HttpError(400, 'Selected size is unavailable');
  }

  private async enrichCart(cart: any, boothSessionToken?: string) {
    const items = (cart.items || []).map((item: any) => {
      const product = item.product;
      const availableQuantity = product ? Math.max(0, Number(product.quantity || 0) - Number(product.reservedQuantity || 0)) : 0;
      return { ...item, variantKey: item.variantKey || 'default', availableQuantity, isAvailable: Boolean(product && availableQuantity >= item.quantity) };
    });
    let booth: any;
    let boothSessionValid = false;
    if (cart.boothId) {
      const row = await Booth.findById(cart.boothId).lean({ virtuals: true });
      if (row) booth = { id: String(row._id), name: row.name, previewImageUrl: row.previewImageUrl, location: row.location, isActive: row.isActive };
      if (boothSessionToken) {
        try {
          const session = this.boothAccess.verifySession(boothSessionToken);
          await this.boothAccess.assertCurrent(session);
          boothSessionValid = session.boothId === cart.boothId;
        } catch {
          boothSessionValid = false;
        }
      }
    }
    return { ...cart, items, booth, boothSessionValid, unavailableItemCount: items.filter((item: any) => !item.isAvailable).length };
  }

  private ownerWhere(owner: CustomerOwner) {
    if (owner.userId) return { userId: owner.userId };
    if (owner.guestId) return { guestId: owner.guestId };
    throw new HttpError(401, 'Authentication or guest session required');
  }
}
