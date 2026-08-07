import {
  NegotiatedQuoteStatus,
  ProductAvailabilityStatus,
  ProductStatus,
} from "@lib/constants";
import type { MongoRepository as Repository } from "@lib/mongo-repository";
import { Cart } from "@models/cart/cart.model";
import { CartItem } from "@models/cart/cart-item.model";
import { NegotiatedQuote, ProductVariant } from "@models/catalog/catalog.model";
import { OperationState } from "@models/platform/geography.model";
import { Product } from "@models/products/product.model";
import {
  nextCartItemPublicId,
  nextPublicId,
} from "@services/public-id.service";
import { HttpError } from "@utils/http";
import { Types } from "mongoose";
import { publishRealtime } from "@services/realtime.service";

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
  // Legacy compatibility field.
  guestId?: string;
};

export class CartService {
  constructor(
    _carts?: Repository<Cart>,
    _items?: Repository<CartItem>,
    _products?: Repository<Product>,
  ) {}

  private async getOrCreateCart(owner: CustomerOwner) {
    const existing = await this.findActiveCart(owner);
    return existing || this.createCart(owner);
  }

  private findActiveCart(owner: CustomerOwner) {
    const ownerFilter = this.ownerWhere(owner);
    return Cart.findOne({
      ...ownerFilter,
      status: "active",
      isCheckedOut: false,
    })
      .select("_id publicId version")
      .lean({ virtuals: true });
  }

  private async createCart(owner: CustomerOwner) {
    const ownerFilter = this.ownerWhere(owner);
    return Cart.create({
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

  async getCart(owner: CustomerOwner) {
    const existing = await Cart.findOne({
      ...this.ownerWhere(owner),
      status: "active",
      isCheckedOut: false,
    })
      .select("_id publicId version status isCheckedOut ownerType")
      .lean({ virtuals: true });
    const cart = existing || (await this.createCart(owner));
    return this.recalculate(String(cart._id || cart.id), cart);
  }

  async addItem(
    owner: CustomerOwner,
    productIdentifier: string,
    quantity: number,
    selectedVariants?: { color?: string; size?: string },
    variantId?: string,
    quoteId?: string,
    options?: { deferRecalculation?: boolean },
  ) {
    // Validate the product and find the cart in parallel.
    const [product, existingCart] = await Promise.all([
      Product.findOne({
        ...identifierFilter(productIdentifier),
        status: ProductStatus.PUBLISHED,
        availabilityStatus: {
          $in: [
            ProductAvailabilityStatus.AVAILABLE,
            ProductAvailabilityStatus.LIMITED,
          ],
        },
        deletedAt: null,
      })
        .select(
          "_id publicId hookId marketId sourceStateId sellingPriceMinor discountMinor currency catalogVersion status availabilityStatus",
        )
        .lean({ virtuals: true }),
      this.findActiveCart(owner),
    ]);
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

    // Writes return a receipt; the client reconciles the cart in the background.
    const cart = existingCart || (await this.createCart(owner));
    const cartId = String(cart._id || cart.id);
    const variantKey =
      variant?._id.toString() || this.variantKey(selectedVariants);
    const unitPriceMinor = Number(
      quote?.agreedPriceMinor ??
        product.sellingPriceMinor - Number(product.discountMinor || 0),
    );
    let changedItemPublicId: string | undefined;
    let reservedPublicId: string | undefined;
    let fastPathCompleted = false;

    if (!quoteId) {
      reservedPublicId = await nextCartItemPublicId();
      try {
        const updated = await CartItem.findOneAndUpdate(
          {
            cartId,
            productId,
            variantKey,
            // Preserve quoted and stale-price lines.
            $or: [{ quoteId: { $exists: false } }, { quoteId: null }],
            unitPriceMinor,
            totalPriceMinor: { $exists: true },
            totalPrice: { $exists: true },
            quantity: { $lte: 99 - quantity },
          },
          {
            $inc: {
              quantity,
              totalPriceMinor: unitPriceMinor * quantity,
              totalPrice: (unitPriceMinor * quantity) / 100,
            },
            $setOnInsert: {
              publicId: reservedPublicId,
              cartId,
              productId,
              variantId: variant?._id.toString(),
              marketId: product.marketId,
              stateId: product.sourceStateId,
              unitPriceMinor,
              currency: product.currency || "NGN",
              unitPrice: unitPriceMinor / 100,
              productVersion: product.catalogVersion || 1,
              selectedVariants: variant
                ? { color: variant.colour, size: variant.size }
                : selectedVariants,
              variantKey,
            },
          },
          { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
        ).select(
          "publicId quantity quoteId quoteVersion unitPriceMinor totalPriceMinor totalPrice",
        );
        changedItemPublicId = updated?.publicId;
        fastPathCompleted = Boolean(updated);
      } catch (error) {
        // Retry through the validated path when the fast update misses.
        if ((error as { code?: number })?.code !== 11000) throw error;
      }
    }

    if (!fastPathCompleted) {
      const existing = await CartItem.findOne({
        cartId,
        productId,
        variantKey,
      }).select(
        "publicId quantity quoteId quoteVersion unitPriceMinor totalPriceMinor unitPrice totalPrice",
      );
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
        changedItemPublicId = existing.publicId;
      } else {
        const created = await CartItem.create({
          publicId: reservedPublicId || (await nextCartItemPublicId()),
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
        changedItemPublicId = created.publicId;
      }
    }
    const versionedCart = await Cart.findOneAndUpdate(
      { _id: cartId, status: "active", isCheckedOut: false },
      { $inc: { version: 1 } },
      { returnDocument: "after" },
    )
      .select("_id publicId version")
      .lean({ virtuals: true });
    if (!versionedCart)
      throw new HttpError(
        409,
        "Basket is no longer active",
        undefined,
        "CART_VERSION_CHANGED",
      );
    const nextVersion = Number(versionedCart.version || 1);
    const publicCartId = versionedCart.publicId || cart.publicId || cartId;

    if (options?.deferRecalculation) {
      publishRealtime(
        {
          type: "cart.updated",
          entityId: publicCartId,
          version: nextVersion,
        },
        owner.userId
          ? { accountId: owner.userId }
          : owner.guestId
            ? { guestId: owner.guestId }
            : undefined,
      );
      // Refresh legacy totals without hydrating the cart.
      setImmediate(() => {
        void this.refreshSummary(cartId).catch((error) => {
          console.error("[cart] deferred summary refresh failed", error);
        });
      });
      return {
        cartId: publicCartId,
        itemId: changedItemPublicId,
        version: nextVersion,
        accepted: true,
      };
    }
    return this.changedCart(owner, cartId);
  }

  async updateItem(
    owner: CustomerOwner,
    itemId: string,
    quantity: number,
    options?: { deferRecalculation?: boolean },
  ) {
    const cart = await this.getOrCreateCart(owner);
    const cartId = String(cart._id || cart.id);
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 99)
      throw new HttpError(400, "Quantity must be between 1 and 99");
    const item = await CartItem.findOne({ ...identifierFilter(itemId), cartId })
      .select("quantity unitPriceMinor quoteId quoteVersion productId")
      .lean();
    if (!item) throw new HttpError(404, "Cart item not found");
    const product = await Product.findById(item.productId)
      .select("status sellingPriceMinor discountMinor")
      .lean();
    if (!product || product.status !== ProductStatus.PUBLISHED)
      throw new HttpError(
        409,
        "Product is no longer available",
        undefined,
        "PRODUCT_NOT_AVAILABLE",
      );
    let unitPriceMinor = Number(item.unitPriceMinor || 0);
    const resetQuote = Boolean(item.quoteId && item.quantity !== quantity);
    if (item.quoteId && item.quantity !== quantity) {
      unitPriceMinor =
        Number(product.sellingPriceMinor || 0) -
        Number(product.discountMinor || 0);
    }
    const updated = await CartItem.findOneAndUpdate(
      { ...identifierFilter(itemId), cartId },
      {
        $set: {
          quantity,
          unitPriceMinor,
          unitPrice: unitPriceMinor / 100,
          totalPriceMinor: quantity * unitPriceMinor,
          totalPrice: (quantity * unitPriceMinor) / 100,
        },
        ...(resetQuote ? { $unset: { quoteId: 1, quoteVersion: 1 } } : {}),
      },
      { returnDocument: "after" },
    )
      .select("publicId quantity unitPriceMinor totalPriceMinor totalPrice")
      .lean();
    if (!updated)
      throw new HttpError(
        409,
        "Cart changed before the quantity update completed",
        undefined,
        "CART_VERSION_CHANGED",
      );
    return this.finishMutation(
      owner,
      cartId,
      updated.publicId,
      options?.deferRecalculation === true,
    );
  }

  async removeItem(
    owner: CustomerOwner,
    itemId: string,
    options?: { deferRecalculation?: boolean },
  ) {
    const cart = await this.getOrCreateCart(owner);
    const cartId = String(cart._id || cart.id);
    const removed = await CartItem.findOneAndDelete({ ...identifierFilter(itemId), cartId })
      .select("publicId")
      .lean();
    if (!removed) throw new HttpError(404, "Cart item not found");
    return this.finishMutation(owner, cartId, removed.publicId, options?.deferRecalculation === true);
  }

  async clear(
    owner: CustomerOwner,
    stateId?: string,
    options?: { deferRecalculation?: boolean },
  ) {
    const cart = await this.getOrCreateCart(owner);
    const cartId = String(cart._id || cart.id);
    let storedStateId = stateId;
    if (stateId && !Types.ObjectId.isValid(stateId)) {
      const state = await OperationState.findOne({ publicId: stateId })
        .select("_id")
        .lean();
      storedStateId = state?._id?.toString();
    }
    await CartItem.deleteMany({
      cartId,
      ...(storedStateId ? { stateId: storedStateId } : {}),
    });
    return this.finishMutation(owner, cartId, undefined, options?.deferRecalculation === true);
  }

  async recalculate(cartId: string, existingCart?: any) {
    const [cart, items] = await Promise.all([
      existingCart
        ? Promise.resolve(existingCart)
        : Cart.findById(cartId).select("_id publicId version status isCheckedOut ownerType").lean({ virtuals: true }),
      CartItem.find({ cartId })
        .select(
          "_id publicId productId quantity selectedVariants variantKey variantId marketId stateId quoteId quoteVersion unitPriceMinor totalPriceMinor currency productVersion createdAt",
        )
        .sort({ createdAt: 1 })
        .lean({ virtuals: true }),
    ]);
    if (!cart) throw new HttpError(404, "Cart not found");
    const productIds = [...new Set(items.map((item) => item.productId))];
    const stateIds = [...new Set(items.map((item) => item.stateId).filter(Boolean))];
    const [products, states] = await Promise.all([
      productIds.length
        ? Product.find({ _id: { $in: productIds } })
            .select(
              "_id publicId hookId title slug images sellingPriceMinor discountMinor currency catalogVersion status",
            )
            .lean({ virtuals: true })
        : [],
      stateIds.length
        ? OperationState.find({ _id: { $in: stateIds } })
            .select("_id publicId name code")
            .lean({ virtuals: true })
        : [],
    ]);
    const productMap = new Map(products.map((product) => [product._id.toString(), product]));
    const stateMap = new Map(
      states.map((state) => [
        state._id.toString(),
        { publicId: state.publicId, name: state.name, code: state.code },
      ]),
    );
    const groupsByState = new Map<string, any[]>();
    const enriched = items.map((item) => {
      const product = productMap.get(item.productId);
      const blockingReasons: string[] = [];
      if (!product || product.status !== ProductStatus.PUBLISHED)
        blockingReasons.push("PRODUCT_NOT_AVAILABLE");
      if (product && product.catalogVersion !== item.productVersion)
        blockingReasons.push("PRODUCT_CHANGED");
      const enrichedItem = {
        ...item,
        productId: product?.publicId || product?.hookId || item.productId,
        publicStateId: stateMap.get(String(item.stateId))?.publicId,
        product: product ? this.cartProduct(product) : undefined,
        blockingReasons,
        checkoutEligible: blockingReasons.length === 0,
      };
      if (item.stateId) {
        const existing = groupsByState.get(String(item.stateId)) || [];
        existing.push(enrichedItem);
        groupsByState.set(String(item.stateId), existing);
      }
      return enrichedItem;
    });
    const groups = [...groupsByState.entries()].map(([stateId, groupItems]) => {
      const subtotalMinor = groupItems.reduce(
        (sum, item) => sum + Number(item.totalPriceMinor || 0),
        0,
      );
      const blockingReasons = [
        ...new Set(groupItems.flatMap((item) => item.blockingReasons)),
      ];
      return {
        stateId,
        publicStateId: stateMap.get(String(stateId))?.publicId,
        state: stateMap.get(String(stateId)),
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
    return {
      ...cart,
      items: enriched,
      stateGroups: groups,
      subtotalMinor,
      currency: "NGN",
      itemCount: enriched.reduce((sum, item) => sum + item.quantity, 0),
    };
  }

  private async refreshSummary(cartId: string) {
    const [summary] = await CartItem.aggregate<{
      _id: null;
      subtotalMinor: number;
    }>([
      { $match: { cartId } },
      {
        $group: {
          _id: null,
          subtotalMinor: {
            $sum: {
              $ifNull: [
                "$totalPriceMinor",
                { $multiply: ["$unitPriceMinor", "$quantity"] },
              ],
            },
          },
        },
      },
    ]);
    const subtotalMinor = Number(summary?.subtotalMinor || 0);
    await Cart.updateOne(
      { _id: cartId },
      {
        $set: {
          subtotal: subtotalMinor / 100,
          deliveryFee: 0,
          total: subtotalMinor / 100,
        },
      },
    );
  }

  private cartProduct(product: any) {
    const images = Array.isArray(product.images)
      ? product.images
          .map((image: any) => (typeof image === "string" ? image : image?.url))
          .filter(Boolean)
      : [];
    return {
      id: product.publicId || product.hookId,
      publicId: product.publicId || product.hookId,
      title: product.title,
      slug: product.slug,
      imageUrl: images[0] || null,
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

  private async changedCart(owner: CustomerOwner, cartId: string) {
    const cart = await this.recalculate(cartId);
    publishRealtime({
      type: "cart.updated",
      entityId: cart.publicId || cart.id,
      version: Number(cart.version || 1),
    }, owner.userId ? { accountId: owner.userId } : owner.guestId ? { guestId: owner.guestId } : undefined);
    return cart;
  }

  private async finishMutation(
    owner: CustomerOwner,
    cartId: string,
    itemId?: string,
    deferRecalculation = false,
  ) {
    const versionedCart = await Cart.findOneAndUpdate(
      { _id: cartId, status: "active", isCheckedOut: false },
      { $inc: { version: 1 } },
      { returnDocument: "after" },
    )
      .select("publicId version")
      .lean();
    if (!versionedCart)
      throw new HttpError(
        409,
        "Basket is no longer active",
        undefined,
        "CART_VERSION_CHANGED",
      );
    const receipt = {
      cartId: versionedCart.publicId || cartId,
      ...(itemId ? { itemId } : {}),
      version: Number(versionedCart.version || 1),
      accepted: true,
    };
    publishRealtime(
      {
        type: "cart.updated",
        entityId: receipt.cartId,
        version: receipt.version,
      },
      owner.userId
        ? { accountId: owner.userId }
        : owner.guestId
          ? { guestId: owner.guestId }
          : undefined,
    );
    if (deferRecalculation) {
      setImmediate(() => {
        void this.refreshSummary(cartId).catch((error) => {
          console.error("[cart] summary refresh failed", error);
        });
      });
      return receipt;
    }
    return this.changedCart(owner, cartId);
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
