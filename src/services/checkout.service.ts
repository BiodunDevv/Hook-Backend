import { createHash, randomBytes } from "crypto";
import mongoose, { isValidObjectId } from "mongoose";
import {
  CommerceChannel,
  CommerceOrderStatus,
  CommercePaymentMethod,
  CommercePaymentStatus,
  DEFAULT_DELIVERY_FEE_MINOR,
  DEFAULT_POD_LIMIT_MINOR,
  DeliveryMethod,
  NegotiatedQuoteStatus,
  OrderStatus,
  OrderType,
  PaymentMode,
  PaymentStatus,
  ProductStatus,
} from "@lib/constants";
import { Cart } from "@models/cart/cart.model";
import { CartItem } from "@models/cart/cart-item.model";
import { NegotiatedQuote } from "@models/catalog/catalog.model";
import {
  CheckoutPreview,
  CommercePolicyVersion,
  CommerceSettings,
} from "@models/commerce/commerce.model";
import { OrderItem } from "@models/orders/order-item.model";
import { Order } from "@models/orders/order.model";
import { Payment } from "@models/payments/payment.model";
import { OperationState } from "@models/platform/geography.model";
import { HookPartner } from "@models/platform/operations-accounts.model";
import { Product } from "@models/products/product.model";
import { User } from "@models/users/user.model";
import { AddressService } from "@services/address.service";
import {
  calculateDeliveryPricing,
  resolveDeliveryState,
  resolveDeliveryZone,
} from "@services/delivery-pricing.service";
import { nextPublicId } from "@services/public-id.service";
import { createCommerceNotification } from "@services/commerce-notification.service";
import { HttpError } from "@utils/http";

type PreviewInput = {
  addressId?: string;
  deliveryMethod: DeliveryMethod;
  paymentMethod: CommercePaymentMethod;
  policyVersions: Record<string, string>;
};

type CheckoutActor = {
  type: "customer" | "partner";
  actorId: string;
  customerId: string;
  partnerId?: string;
};

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
function idFilter(value: string) {
  return isValidObjectId(value)
    ? { $or: [{ _id: value }, { publicId: value }] }
    : { publicId: value };
}

function recordId(record: { _id?: unknown; id?: string }) {
  return String(record._id || record.id);
}

function storedStateIdentifiers(state: { _id?: unknown; publicId?: string }, fallback?: string) {
  return [...new Set(
    [state._id, state.publicId, fallback]
      .filter((value) => value != null && String(value).length > 0)
      .map(String),
  )];
}

export class CheckoutService {
  private addresses = new AddressService();

  async preview(
    actor: CheckoutActor,
    stateIdentifier: string,
    input: PreviewInput,
  ) {
    const customer = await User.findById(actor.customerId).lean({
      virtuals: true,
    });
    if (!customer || customer.accountType !== "customer" || !customer.isActive)
      throw new HttpError(404, "Customer not found");
    if (actor.type === "customer" && !customer.isEmailVerified)
      throw new HttpError(
        403,
        "Verify your email before checkout",
        undefined,
        "EMAIL_VERIFICATION_REQUIRED",
      );
    const state = await OperationState.findOne({
      ...idFilter(stateIdentifier),
      status: "active",
    }).lean({ virtuals: true });
    if (!state)
      throw new HttpError(
        409,
        "Selected State is not available",
        undefined,
        "CHECKOUT_STATE_UNAVAILABLE",
      );
    const stateId = recordId(state);
    const stateIdentifiers = storedStateIdentifiers(state, stateIdentifier);
    const partner = actor.partnerId
      ? await HookPartner.findOne({
          _id: actor.partnerId,
          status: "active",
        }).lean({ virtuals: true })
      : null;
    if (actor.type === "partner" && (!partner || partner.stateId !== stateId))
      throw new HttpError(
        403,
        "Partner cannot checkout this State group",
        undefined,
        "STATE_SCOPE_DENIED",
      );
    if (
      actor.type === "partner" &&
      input.paymentMethod !== CommercePaymentMethod.PREPAID
    )
      throw new HttpError(
        409,
        "Partner-assisted Orders require prepayment",
        undefined,
        "PAYMENT_METHOD_NOT_ALLOWED",
      );
    if (
      actor.type === "customer" &&
      input.deliveryMethod !== DeliveryMethod.HOME_DELIVERY
    )
      throw new HttpError(
        409,
        "Shopper App Orders support home delivery only",
        undefined,
        "DELIVERY_METHOD_NOT_ALLOWED",
      );
    if (
      actor.type === "partner" &&
      input.deliveryMethod === DeliveryMethod.PARTNER_PICKUP &&
      !partner
    )
      throw new HttpError(409, "Pickup Partner is unavailable");

    const cart = await Cart.findOne({
      ...(actor.type === "customer"
        ? { customerId: actor.customerId, ownerType: "customer" }
        : {
            partnerId: actor.partnerId,
            assistedCustomerId: actor.customerId,
            ownerType: "partner_assisted",
          }),
      status: "active",
      isCheckedOut: false,
    }).lean({ virtuals: true });
    if (!cart)
      throw new HttpError(409, "Basket is empty", undefined, "CART_EMPTY");
    const cartId = recordId(cart);
    const cartItems = await CartItem.find({
      cartId,
      stateId: { $in: stateIdentifiers },
    }).lean({ virtuals: true });
    if (!cartItems.length)
      throw new HttpError(
        409,
        "This State basket is empty",
        undefined,
        "CART_EMPTY",
      );
    const lines = await this.revalidateLines(actor.customerId, cartItems);

    let addressSnapshot: Record<string, unknown> | undefined;
    let deliveryState = state;
    let zone: any;
    if (input.deliveryMethod === DeliveryMethod.HOME_DELIVERY) {
      if (!input.addressId)
        throw new HttpError(400, "Delivery address is required");
      const address = await this.addresses.getOwned(
        actor.customerId,
        input.addressId,
      );
      const resolvedDeliveryState = await resolveDeliveryState(
        String(address.stateId),
      );
      if (
        !resolvedDeliveryState ||
        resolvedDeliveryState.deliveryEnabled === false
      )
        throw new HttpError(
          409,
          "Delivery is not available in this State",
          undefined,
          "ADDRESS_OUTSIDE_COVERAGE",
        );
      deliveryState = resolvedDeliveryState;
      zone = await resolveDeliveryZone(
        address.zoneId,
        String(deliveryState.id),
      );
      addressSnapshot = {
        publicId: address.publicId,
        label: address.label,
        recipientName: address.recipientName,
        phone: address.phone,
        line1: address.line1,
        line2: address.line2,
        landmark: address.landmark,
        stateId: deliveryState.publicId,
        cityId: address.cityId,
        zoneId: address.zoneId,
        localGovernmentAreaId: address.localGovernmentAreaId,
        postalCode: address.postalCode,
        coordinates: address.coordinates,
        formattedAddress: address.formattedAddress,
        stateCode: address.stateCode,
        stateName: address.stateName,
        cityName: address.cityName,
        localGovernmentArea: address.localGovernmentArea,
      };
    }

    const settings = await this.getSettings();
    await this.validatePolicies(
      input.policyVersions,
      settings.activePolicyVersions,
    );
    const subtotalMinor = lines.reduce(
      (sum, line) => sum + Number(line.totalPriceMinor),
      0,
    );
    const deliveryPricing = input.deliveryMethod === DeliveryMethod.PARTNER_PICKUP
      ? { scope: "partner" as const, mode: "flat" as const, feeMinor: 0, ruleVersion: "partner-pickup-v1" }
      : await calculateDeliveryPricing({
          state: deliveryState,
          zone,
          coordinates: addressSnapshot?.coordinates as { latitude: number; longitude: number } | undefined,
          defaultFeeMinor: settings.defaultDeliveryFeeMinor ?? DEFAULT_DELIVERY_FEE_MINOR,
        });
    const deliveryFeeMinor = deliveryPricing.feeMinor;
    const totalMinor = subtotalMinor + deliveryFeeMinor;
    const podLimitMinor = Number(
      zone?.podLimitMinor ??
        deliveryState.podLimitMinor ??
        settings.defaultPodLimitMinor ??
        DEFAULT_POD_LIMIT_MINOR,
    );
    const podEnabled = Boolean(
      settings.podEnabled &&
      deliveryState.podEnabled &&
      (zone?.podEnabled ?? true) &&
      customer.podEligible !== false,
    );
    if (
      input.paymentMethod === CommercePaymentMethod.PAY_AT_HANDOVER &&
      !podEnabled
    )
      throw new HttpError(
        409,
        "Pay at Handover is not available for this Order",
        undefined,
        "POD_NOT_ELIGIBLE",
      );
    const highValue =
      input.paymentMethod === CommercePaymentMethod.PAY_AT_HANDOVER &&
      totalMinor > podLimitMinor;
    const rawToken = randomBytes(32).toString("base64url");
    const publicTokenId = randomBytes(10).toString("hex");
    const expiresAt = new Date(
      Date.now() + settings.previewTtlMinutes * 60_000,
    );
    const preview = await CheckoutPreview.create({
      tokenHash: hash(rawToken),
      publicTokenId,
      actorType: actor.type,
      actorId: actor.actorId,
      customerId: actor.customerId,
      partnerId: actor.partnerId,
      stateId,
      cartId,
      cartVersion: cart.version || 1,
      channel:
        actor.type === "partner"
          ? CommerceChannel.PARTNER_ASSISTED
          : CommerceChannel.SHOPPER_APP,
      deliveryMethod: input.deliveryMethod,
      paymentMethod: input.paymentMethod,
      addressId: input.addressId,
      addressSnapshot,
      pickupPartnerSnapshot:
        input.deliveryMethod === DeliveryMethod.PARTNER_PICKUP && partner
          ? {
              publicId: partner.publicId,
              name: partner.name,
              address: partner.address,
              contact: partner.contact,
              stateId: state.publicId,
            }
          : undefined,
      lines,
      subtotalMinor,
      deliveryFeeMinor,
      deliveryPricing,
      totalMinor,
      currency: "NGN",
      policyVersions: settings.activePolicyVersions,
      podDecision: {
        eligible: podEnabled,
        limitMinor: podLimitMinor,
        highValue,
        requiresOverride: highValue,
        requiresConfirmationCall:
          input.paymentMethod === CommercePaymentMethod.PAY_AT_HANDOVER,
      },
      expiresAt,
    });
    return {
      previewToken: `${publicTokenId}.${rawToken}`,
      expiresAt,
      state: { id: state.publicId, name: state.name, code: state.code },
      channel: preview.channel,
      deliveryMethod: preview.deliveryMethod,
      paymentMethod: preview.paymentMethod,
      lines,
      subtotalMinor,
      deliveryFeeMinor,
      deliveryPricing,
      totalMinor,
      currency: "NGN",
      podDecision: preview.podDecision,
      policyVersions: preview.policyVersions,
    };
  }

  async confirm(
    actor: CheckoutActor,
    previewToken: string,
    idempotencyKey: string,
  ) {
    if (!idempotencyKey || idempotencyKey.length < 12)
      throw new HttpError(
        400,
        "A valid Idempotency-Key is required",
        undefined,
        "IDEMPOTENCY_CONFLICT",
      );
    const existing = await Order.findOne({ idempotencyKey }).lean({
      virtuals: true,
    });
    if (existing) {
      if (
        existing.userId !== actor.customerId ||
        existing.initiatingPartnerId !== actor.partnerId
      )
        throw new HttpError(
          409,
          "Idempotency key was used for another checkout",
          undefined,
          "IDEMPOTENCY_CONFLICT",
        );
      return this.orderResult(existing.id);
    }
    const [publicTokenId, rawToken] = previewToken.split(".");
    if (!publicTokenId || !rawToken)
      throw new HttpError(
        400,
        "Checkout preview token is invalid",
        undefined,
        "CHECKOUT_PREVIEW_INVALID",
      );
    const preview = await CheckoutPreview.findOne({ publicTokenId }).select(
      "+tokenHash",
    );
    if (
      !preview ||
      preview.tokenHash !== hash(rawToken) ||
      preview.expiresAt <= new Date()
    )
      throw new HttpError(
        409,
        "Checkout preview has expired",
        undefined,
        "CHECKOUT_PREVIEW_EXPIRED",
      );
    if (
      preview.consumedAt ||
      preview.actorId !== actor.actorId ||
      preview.customerId !== actor.customerId ||
      preview.partnerId !== actor.partnerId
    )
      throw new HttpError(
        409,
        "Checkout preview cannot be used",
        undefined,
        "CHECKOUT_PREVIEW_INVALID",
      );
    const cart = await Cart.findOne({
      _id: preview.cartId,
      status: "active",
      version: preview.cartVersion,
    });
    if (!cart)
      throw new HttpError(
        409,
        "Basket changed. Review checkout again.",
        undefined,
        "CART_VERSION_CHANGED",
      );
    const previewState = await OperationState.findOne({
      ...idFilter(preview.stateId),
      status: "active",
    })
      .select("_id publicId")
      .lean();
    const stateIdentifiers = storedStateIdentifiers(previewState || {}, preview.stateId);
    const cartItems = await CartItem.find({
      cartId: cart.id,
      stateId: { $in: stateIdentifiers },
    }).lean({ virtuals: true });
    const currentLines = await this.revalidateLines(
      actor.customerId,
      cartItems,
    );
    if (JSON.stringify(currentLines) !== JSON.stringify(preview.lines))
      throw new HttpError(
        409,
        "Product or quote details changed. Review checkout again.",
        undefined,
        "CHECKOUT_REVALIDATION_REQUIRED",
      );

    const ids = {
      order: await nextPublicId("order"),
      payment: await nextPublicId("payment"),
      items: await Promise.all(
        currentLines.map(() => nextPublicId("orderItem")),
      ),
    };
    const session = await mongoose.startSession();
    let orderId = "";
    try {
      await session.withTransaction(async () => {
        const pod =
          preview.paymentMethod === CommercePaymentMethod.PAY_AT_HANDOVER;
        const highValue = Boolean((preview.podDecision as any)?.highValue);
        const commerceStatus = pod
          ? highValue
            ? CommerceOrderStatus.VERIFICATION_PENDING
            : CommerceOrderStatus.OPERATIONS_REVIEW
          : CommerceOrderStatus.AWAITING_PAYMENT;
        const order = new Order({
          publicId: ids.order,
          orderCode: ids.order,
          userId: actor.customerId,
          channel: preview.channel,
          sourceStateId: preview.stateId,
          initiatingPartnerId: actor.partnerId,
          deliveryMethod: preview.deliveryMethod,
          commercePaymentMethod: preview.paymentMethod,
          commerceStatus,
          commercePaymentStatus: pod
            ? CommercePaymentStatus.DUE_AT_HANDOVER
            : CommercePaymentStatus.PENDING,
          subtotalMinor: preview.subtotalMinor,
          deliveryFeeMinor: preview.deliveryFeeMinor,
          deliveryPricing: preview.deliveryPricing,
          totalMinor: preview.totalMinor,
          currency: preview.currency,
          subtotal: preview.subtotalMinor / 100,
          deliveryFee: preview.deliveryFeeMinor / 100,
          discount: 0,
          total: preview.totalMinor / 100,
          vendorCount: 0,
          status: pod
            ? highValue
              ? OrderStatus.VERIFICATION_PENDING
              : OrderStatus.OPERATIONS_REVIEW
            : OrderStatus.AWAITING_PAYMENT,
          paymentStatus: PaymentStatus.PENDING,
          paymentMode: pod ? PaymentMode.PAY_ON_DELIVERY : PaymentMode.PAY_NOW,
          orderType: OrderType.STANDARD,
          deliveryAddress: preview.addressSnapshot || {
            street: String(
              (preview.pickupPartnerSnapshot as any)?.address || "",
            ),
            city: "",
            state: "",
            phone: String(
              (preview.pickupPartnerSnapshot as any)?.contact?.phone || "",
            ),
          },
          addressSnapshot: preview.addressSnapshot,
          pickupPartnerSnapshot: preview.pickupPartnerSnapshot,
          customerSnapshot: await this.customerSnapshot(actor.customerId),
          policyVersions: preview.policyVersions,
          checkoutPreviewId: preview.id,
          idempotencyKey,
          podReview: preview.podDecision,
          partialFulfilment: false,
          deliverySubsidy: 0,
          timeline: [
            {
              status: commerceStatus,
              at: new Date(),
              actorType: preview.channel,
              actorId: actor.actorId,
            },
          ],
        });
        await order.save({ session });
        orderId = order.id;
        await OrderItem.insertMany(
          currentLines.map((line, index) => ({
            publicId: ids.items[index],
            orderId: order.id,
            productId: line.productId,
            variantId: line.variantId,
            marketId: line.marketId,
            stateId: line.stateId,
            quoteId: line.quoteId,
            productTitle: (line.productSnapshot as any).title,
            productImage: (line.productSnapshot as any).image,
            quantity: line.quantity,
            unitPriceMinor: line.unitPriceMinor,
            totalPriceMinor: line.totalPriceMinor,
            currency: line.currency,
            unitPrice: Number(line.unitPriceMinor) / 100,
            totalPrice: Number(line.totalPriceMinor) / 100,
            selectedVariants: line.variantSnapshot,
            productSnapshot: line.productSnapshot,
            variantSnapshot: line.variantSnapshot,
            quoteSnapshot: line.quoteSnapshot,
            commissionAmount: 0,
          })),
          { session },
        );
        await Payment.create(
          [
            {
              publicId: ids.payment,
              orderId: order.id,
              resourceType: "order",
              transactionRef: `PSK-${ids.payment}`,
              gateway: "paystack",
              paymentMethod: pod ? "pos" : "card",
              amount: preview.totalMinor / 100,
              amountMinor: preview.totalMinor,
              currency: preview.currency,
              gatewayFee: 0,
              amountSettled: 0,
              status: PaymentStatus.PENDING,
              commerceStatus: pod
                ? CommercePaymentStatus.DUE_AT_HANDOVER
                : CommercePaymentStatus.PENDING,
              refundedAmount: 0,
            },
          ],
          { session },
        );
        for (const line of currentLines)
          if (line.quoteId) {
            const quoteUpdate = await NegotiatedQuote.updateOne(
              {
                _id: line.quoteId,
                status: NegotiatedQuoteStatus.ACTIVE,
                expiresAt: { $gt: new Date() },
              },
              {
                $set: {
                  status: NegotiatedQuoteStatus.USED,
                  usedByOrderId: order.id,
                  usedAt: new Date(),
                },
              },
              { session },
            );
            if (!quoteUpdate.modifiedCount)
              throw new HttpError(
                409,
                "Negotiated quote is no longer available",
                undefined,
                "NEGOTIATION_QUOTE_EXPIRED",
              );
          }
        await CartItem.deleteMany(
          { cartId: cart.id, stateId: { $in: stateIdentifiers } },
          { session },
        );
        await Cart.updateOne(
          { _id: cart.id, version: preview.cartVersion },
          { $inc: { version: 1 } },
          { session },
        );
        await CheckoutPreview.updateOne(
          { _id: preview.id, consumedAt: null },
          { $set: { consumedAt: new Date(), orderId: order.id } },
          { session },
        );
      });
    } finally {
      await session.endSession();
    }
    const result = await this.orderResult(orderId);
    await createCommerceNotification({
      eventKey: `order:${result.publicId || result.id}:created`,
      userId: actor.customerId,
      title:
        preview.paymentMethod === CommercePaymentMethod.PREPAID
          ? "Complete your payment"
          : "Order under review",
      body:
        preview.paymentMethod === CommercePaymentMethod.PREPAID
          ? "Your State Order is ready for secure Paystack payment."
          : "Hook Operations will review your Pay-at-Handover request.",
      type: "order_created",
      data: { orderId: result.publicId || result.id, stateId: preview.stateId },
    }).catch(() => undefined);
    return result;
  }

  private async revalidateLines(customerId: string, items: any[]) {
    const products = await Product.find({
      _id: { $in: items.map((item) => item.productId) },
      status: ProductStatus.PUBLISHED,
    }).lean({ virtuals: true });
    const map = new Map(
      products.map((product) => [recordId(product), product]),
    );
    const lines: any[] = [];
    for (const item of items) {
      const product = map.get(item.productId);
      if (
        !product ||
        product.catalogVersion !== item.productVersion ||
        !product.marketId ||
        !product.sourceStateId
      )
        throw new HttpError(
          409,
          "A basket product changed or is unavailable",
          undefined,
          "CHECKOUT_REVALIDATION_REQUIRED",
        );
      let quote: any;
      if (item.quoteId) {
        const productId = recordId(product);
        quote = await NegotiatedQuote.findOne({
          _id: item.quoteId,
          customerId,
          productId,
          quantity: item.quantity,
          status: NegotiatedQuoteStatus.ACTIVE,
          expiresAt: { $gt: new Date() },
        }).lean({ virtuals: true });
        if (!quote)
          throw new HttpError(
            409,
            "A negotiated quote expired",
            undefined,
            "NEGOTIATION_QUOTE_EXPIRED",
          );
      }
      const unitPriceMinor = Number(
        quote?.agreedPriceMinor ??
          Number(product.sellingPriceMinor) -
            Number(product.discountMinor || 0),
      );
      lines.push({
        cartItemId: recordId(item),
        productId: recordId(product),
        productPublicId: product.publicId,
        variantId: item.variantId,
        marketId: product.marketId,
        stateId: product.sourceStateId,
        quoteId: quote ? recordId(quote) : undefined,
        quantity: item.quantity,
        unitPriceMinor,
        totalPriceMinor: unitPriceMinor * item.quantity,
        currency: product.currency || "NGN",
        productVersion: product.catalogVersion,
        quoteVersion: quote?.version,
        productSnapshot: {
          publicId: product.publicId,
          title: product.title,
          slug: product.slug,
          image: product.images?.[0],
          catalogVersion: product.catalogVersion,
        },
        variantSnapshot: item.selectedVariants || {},
        quoteSnapshot: quote
          ? {
              publicId: quote.publicId,
              agreedPriceMinor: quote.agreedPriceMinor,
              expiresAt: quote.expiresAt,
              version: quote.version,
            }
          : undefined,
      });
    }
    return lines;
  }

  private async getSettings() {
    return CommerceSettings.findOneAndUpdate(
      { key: "commerce" },
      {
        $setOnInsert: {
          key: "commerce",
          currency: "NGN",
          defaultDeliveryFeeMinor: DEFAULT_DELIVERY_FEE_MINOR,
          podEnabled: false,
          defaultPodLimitMinor: DEFAULT_POD_LIMIT_MINOR,
          previewTtlMinutes: 10,
          activePolicyVersions: {},
        },
      },
      { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
    ).lean({ virtuals: true }) as Promise<any>;
  }

  private async validatePolicies(
    provided: Record<string, string>,
    configured: Record<string, string>,
  ) {
    const active = Object.keys(configured).length
      ? configured
      : Object.fromEntries(
          (
            await CommercePolicyVersion.find({
              status: "active",
              effectiveAt: { $lte: new Date() },
            })
              .sort({ effectiveAt: -1 })
              .lean()
          ).map((policy) => [policy.type, policy.version]),
        );
    for (const key of ["TERMS", "PRIVACY", "RETURNS"])
      if (!active[key] || provided[key] !== active[key])
        throw new HttpError(
          409,
          "Current policies must be accepted before checkout",
          { required: active },
          "POLICY_ACCEPTANCE_REQUIRED",
        );
  }

  private async customerSnapshot(customerId: string) {
    const user = await User.findById(customerId).lean();
    return {
      publicId: user?.publicId,
      email: user?.email,
      phone: user?.phone,
      name: `${user?.firstName || ""} ${user?.lastName || ""}`.trim(),
      emailVerified: user?.isEmailVerified,
    };
  }

  private async orderResult(id: string) {
    const order = await Order.findById(id).lean({ virtuals: true });
    const items = await OrderItem.find({ orderId: id }).lean({
      virtuals: true,
    });
    const payment = await Payment.findOne({ orderId: id }).lean({
      virtuals: true,
    });
    return {
      ...order,
      id: order?.publicId,
      items: items.map((item) => ({ ...item, id: item.publicId })),
      payment: payment ? { ...payment, id: payment.publicId } : undefined,
    };
  }
}
