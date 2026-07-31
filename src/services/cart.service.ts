import {
  NegotiatedQuoteStatus,
  ProductAvailabilityStatus,
  ProductStatus,
} from "@lib/constants";
import type { MongoRepository as Repository } from "@lib/mongo-repository";
import { Cart } from "@models/cart/cart.model";
import { CartItem } from "@models/cart/cart-item.model";
import { NegotiatedQuote, ProductVariant } from "@models/catalog/catalog.model";
import { Product } from "@models/products/product.model";
import { nextPublicId } from "@services/public-id.service";
import { HttpError } from "@utils/http";
import { Types } from "mongoose";

function identifierFilter(identifier: string) {
  return Types.ObjectId.isValid(identifier)
    ? { $or: [{ _id: identifier }, { publicId: identifier }] }
    : { publicId: identifier };
}

export type CustomerOwner = {
  userId?: string;
  guestSessionId?: string;
  partnerId?: string;
  assistedCustomerId?: string;
  /** Historical checkout compatibility only. */
  guestId?: string;
};

export class CartService {
  constructor(
    _carts?: Repository<Cart>,
    _items?: Repository<CartItem>,
    _products?: Repository<Product>,
  ) {}

  async getCart(owner: CustomerOwner) {
    const ownerFilter = this.ownerWhere(owner);
    let cart = await Cart.findOne({
      ...ownerFilter,
      status: "active",
      isCheckedOut: false,
    });
    if (!cart) {
      cart = await Cart.create({
        publicId: await nextPublicId("cart"),
        ...ownerFilter,
        ownerType: owner.partnerId
          ? "partner_assisted"
          : owner.userId
            ? "customer"
            : "guest",
        subtotal: 0,
        deliveryFee: 0,
        total: 0,
        version: 1,
        status: "active",
        isCheckedOut: false,
      });
    }
    return this.recalculate(cart.id);
  }

  async addItem(
    owner: CustomerOwner,
    productIdentifier: string,
    quantity: number,
    selectedVariants?: { color?: string; size?: string },
    variantId?: string,
    quoteId?: string,
  ) {
    const product = await Product.findOne({
      ...identifierFilter(productIdentifier),
      status: ProductStatus.PUBLISHED,
      availabilityStatus: {
        $in: [
          ProductAvailabilityStatus.AVAILABLE,
          ProductAvailabilityStatus.LIMITED,
        ],
      },
      deletedAt: null,
    }).lean({ virtuals: true });
    if (!product)
      throw new HttpError(
        404,
        "Product is not available",
        undefined,
        "PRODUCT_NOT_AVAILABLE",
      );
    const productId = product._id.toString();
    if (
      !product.marketId ||
      !product.sourceStateId ||
      !product.sellingPriceMinor
    ) {
      throw new HttpError(
        409,
        "Product commerce data is incomplete",
        undefined,
        "PRODUCT_NOT_AVAILABLE",
      );
    }
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 99) {
      throw new HttpError(
        400,
        "Quantity must be between 1 and 99",
        undefined,
        "VALIDATION_ERROR",
      );
    }
    const variant = variantId
      ? await ProductVariant.findOne({
          ...identifierFilter(variantId),
          productId,
          active: true,
        }).lean({ virtuals: true })
      : null;
    if (variantId && !variant)
      throw new HttpError(
        409,
        "Selected product option is unavailable",
        undefined,
        "PRODUCT_VARIANT_UNAVAILABLE",
      );

    let quote = null;
    if (quoteId) {
      quote = await NegotiatedQuote.findOne({
        ...identifierFilter(quoteId),
        productId,
        customerId: owner.userId,
        status: NegotiatedQuoteStatus.ACTIVE,
        expiresAt: { $gt: new Date() },
        quantity,
        ...(variant ? { variantId: variant.id } : {}),
      }).lean({ virtuals: true });
      if (!quote)
        throw new HttpError(
          409,
          "Negotiated quote is invalid or expired",
          undefined,
          "NEGOTIATION_QUOTE_EXPIRED",
        );
    }

    const cart = await this.getCart(owner);
    const cartId = String(cart._id || cart.id);
    const variantKey = variant?._id.toString() || this.variantKey(selectedVariants);
    const unitPriceMinor = Number(
      quote?.agreedPriceMinor ??
        product.sellingPriceMinor - Number(product.discountMinor || 0),
    );
    const existing = await CartItem.findOne({
      cartId,
      productId,
      variantKey,
    });
    if (existing) {
      const nextQuantity = existing.quantity + quantity;
      if (nextQuantity > 99)
        throw new HttpError(
          400,
          "Quantity cannot exceed 99",
          undefined,
          "VALIDATION_ERROR",
        );
      if (existing.quoteId && nextQuantity !== quote?.quantity) {
        existing.quoteId = undefined;
        existing.quoteVersion = undefined;
        existing.unitPriceMinor = Number(
          product.sellingPriceMinor - Number(product.discountMinor || 0),
        );
      }
      existing.quantity = nextQuantity;
      existing.totalPriceMinor =
        nextQuantity * Number(existing.unitPriceMinor || unitPriceMinor);
      existing.unitPrice =
        Number(existing.unitPriceMinor || unitPriceMinor) / 100;
      existing.totalPrice = Number(existing.totalPriceMinor) / 100;
      await existing.save();
    } else {
      await CartItem.create({
        publicId: await nextPublicId("cartItem"),
        cartId,
        productId,
        variantId: variant?._id.toString(),
        marketId: product.marketId,
        stateId: product.sourceStateId,
        quoteId: quote?._id.toString(),
        quantity,
        unitPriceMinor,
        totalPriceMinor: unitPriceMinor * quantity,
        currency: product.currency || "NGN",
        unitPrice: unitPriceMinor / 100,
        totalPrice: (unitPriceMinor * quantity) / 100,
        productVersion: product.catalogVersion || 1,
        quoteVersion: quote?.version || undefined,
        selectedVariants: variant
          ? { color: variant.colour, size: variant.size }
          : selectedVariants,
        variantKey,
      });
    }
    await Cart.findByIdAndUpdate(cartId, { $inc: { version: 1 } });
    return this.recalculate(cartId);
  }

  async updateItem(owner: CustomerOwner, itemId: string, quantity: number) {
    const cart = await this.getCart(owner);
    const cartId = String(cart._id || cart.id);
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 99)
      throw new HttpError(400, "Quantity must be between 1 and 99");
    const item = await CartItem.findOne({
      ...identifierFilter(itemId),
      cartId,
    });
    if (!item) throw new HttpError(404, "Cart item not found");
    const product = await Product.findById(item.productId).lean();
    if (!product || product.status !== ProductStatus.PUBLISHED)
      throw new HttpError(
        409,
        "Product is no longer available",
        undefined,
        "PRODUCT_NOT_AVAILABLE",
      );
    if (item.quoteId && item.quantity !== quantity) {
      item.quoteId = undefined;
      item.quoteVersion = undefined;
      item.unitPriceMinor =
        Number(product.sellingPriceMinor || 0) -
        Number(product.discountMinor || 0);
    }
    item.quantity = quantity;
    item.totalPriceMinor = quantity * Number(item.unitPriceMinor || 0);
    item.unitPrice = Number(item.unitPriceMinor || 0) / 100;
    item.totalPrice = Number(item.totalPriceMinor || 0) / 100;
    await item.save();
    await Cart.findByIdAndUpdate(cartId, { $inc: { version: 1 } });
    return this.recalculate(cartId);
  }

  async removeItem(owner: CustomerOwner, itemId: string) {
    const cart = await this.getCart(owner);
    const cartId = String(cart._id || cart.id);
    const removed = await CartItem.findOneAndDelete({
      ...identifierFilter(itemId),
      cartId,
    });
    if (!removed) throw new HttpError(404, "Cart item not found");
    await Cart.findByIdAndUpdate(cartId, { $inc: { version: 1 } });
    return this.recalculate(cartId);
  }

  async clear(owner: CustomerOwner, stateId?: string) {
    const cart = await this.getCart(owner);
    const cartId = String(cart._id || cart.id);
    await CartItem.deleteMany({
      cartId,
      ...(stateId ? { stateId } : {}),
    });
    await Cart.findByIdAndUpdate(cartId, { $inc: { version: 1 } });
    return this.recalculate(cartId);
  }

  async recalculate(cartId: string) {
    const cart = await Cart.findById(cartId).lean({ virtuals: true });
    if (!cart) throw new HttpError(404, "Cart not found");
    const items = await CartItem.find({ cartId })
      .sort({ createdAt: 1 })
      .lean({ virtuals: true });
    const productIds = [...new Set(items.map((item) => item.productId))];
    const products = await Product.find({ _id: { $in: productIds } }).lean({
      virtuals: true,
    });
    const productMap = new Map(
      products.map((product) => [product._id.toString(), product]),
    );
    const enriched = items.map((item) => {
      const product = productMap.get(item.productId);
      const blockingReasons: string[] = [];
      if (!product || product.status !== ProductStatus.PUBLISHED)
        blockingReasons.push("PRODUCT_NOT_AVAILABLE");
      if (product && product.catalogVersion !== item.productVersion)
        blockingReasons.push("PRODUCT_CHANGED");
      return {
        ...item,
        product: product ? this.publicProduct(product) : undefined,
        blockingReasons,
        checkoutEligible: blockingReasons.length === 0,
      };
    });
    const groups = [
      ...new Set(enriched.map((item) => item.stateId).filter(Boolean)),
    ].map((stateId) => {
      const groupItems = enriched.filter((item) => item.stateId === stateId);
      const subtotalMinor = groupItems.reduce(
        (sum, item) => sum + Number(item.totalPriceMinor || 0),
        0,
      );
      const blockingReasons = [
        ...new Set(groupItems.flatMap((item) => item.blockingReasons)),
      ];
      return {
        stateId,
        items: groupItems,
        subtotalMinor,
        currency: "NGN",
        checkoutEligible: blockingReasons.length === 0,
        blockingReasons,
      };
    });
    const subtotalMinor = enriched.reduce(
      (sum, item) => sum + Number(item.totalPriceMinor || 0),
      0,
    );
    await Cart.findByIdAndUpdate(cartId, {
      subtotal: subtotalMinor / 100,
      deliveryFee: 0,
      total: subtotalMinor / 100,
    });
    return {
      ...cart,
      items: enriched,
      stateGroups: groups,
      subtotalMinor,
      currency: "NGN",
      itemCount: enriched.reduce((sum, item) => sum + item.quantity, 0),
    };
  }

  private publicProduct(product: any) {
    return {
      id: product.publicId || product.id,
      publicId: product.publicId,
      title: product.title,
      slug: product.slug,
      images: product.images || [],
      sellingPriceMinor: product.sellingPriceMinor,
      discountMinor: product.discountMinor || 0,
      currency: product.currency || "NGN",
      status: product.status,
      catalogVersion: product.catalogVersion,
    };
  }

  private variantKey(selected?: { color?: string; size?: string }) {
    const color = String(selected?.color || "")
      .trim()
      .toLowerCase();
    const size = String(selected?.size || "")
      .trim()
      .toLowerCase();
    return color || size ? `${color || "-"}::${size || "-"}` : "default";
  }

  private ownerWhere(owner: CustomerOwner) {
    if (owner.partnerId && owner.assistedCustomerId)
      return {
        partnerId: owner.partnerId,
        assistedCustomerId: owner.assistedCustomerId,
      };
    if (owner.userId) return { customerId: owner.userId };
    if (owner.guestSessionId) return { guestSessionId: owner.guestSessionId };
    throw new HttpError(
      401,
      "Customer or guest session required",
      undefined,
      "AUTHENTICATION_REQUIRED",
    );
  }
}
