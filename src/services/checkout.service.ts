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
  POD_PAUSED,
  ProductAvailabilityStatus,
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
import { OrderFulfilmentGroup } from "@models/orders/order-fulfilment-group.model";
import { Payment } from "@models/payments/payment.model";
import { OperationState } from "@models/platform/geography.model";
import { HookPartner } from "@models/platform/operations-accounts.model";
import { Product } from "@models/products/product.model";
import { User } from "@models/users/user.model";
import { AddressService } from "@services/address.service";
import {
  calculateDeliveryPricing,
  resolveDeliveryState,
} from "@services/delivery-pricing.service";
import { nextPublicId } from "@services/public-id.service";
import { createCommerceNotification } from "@services/commerce-notification.service";
import { EmailService } from "@emails/email.service";
import { CouponService } from "@services/coupon.service";
import { CreditService } from "@services/credit.service";
import { LogisticsProviderService } from "@services/logistics-provider.service";
import { HttpError, isDuplicateKeyError } from "@utils/http";
import { emitOutbox } from "@services/outbox.service";
import { wakeOutbox } from "../jobs/wake";
import { timelineEntry } from "@lib/order-timeline";

type PreviewInput = {
  addressId?: string;
  deliveryMethod: DeliveryMethod;
  paymentMethod: CommercePaymentMethod;
  policyVersions: Record<string, string>;
  logisticsProviderId?: string;
  couponCode?: string;
  useCredits?: boolean;
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
  private email = new EmailService();
  private coupons = new CouponService();
  private credits = new CreditService();
  private logisticsProviders = new LogisticsProviderService();

  /**
   * The single source of truth for checkout money. preview() and confirm()
   * both call this, so the totals confirm re-derives can never drift from the
   * ones the customer was quoted — the exact-equality revalidation below
   * depends on that.
   *
   * Order of operations: a coupon discounts the item subtotal (so it also
   * lowers the VAT basis, which is "product_subtotal") unless it is a
   * free-delivery coupon, which discounts the shipping line instead. Credits
   * come off last, capped at a share of the subtotal, and never take the
   * payable below zero.
   */
  private async calculateMoney(input: {
    customerId: string;
    subtotalMinor: number;
    deliveryFeeMinor: number;
    paymentMethod: CommercePaymentMethod;
    couponCode?: string;
    useCredits?: boolean;
  }) {
    const coupon = await this.coupons.tryValidate(input.couponCode, {
      userId: input.customerId,
      subtotalMinor: input.subtotalMinor,
      deliveryFeeMinor: input.deliveryFeeMinor,
    });

    const couponDiscountMinor = coupon?.discountMinor ?? 0;
    const deliveryDiscountMinor = coupon?.appliesToDelivery ? couponDiscountMinor : 0;
    const itemDiscountMinor = coupon?.appliesToDelivery ? 0 : couponDiscountMinor;

    const deliveryFeeMinor = Math.max(0, input.deliveryFeeMinor - deliveryDiscountMinor);
    const vatRate = 0.075;
    const vatBasisMinor = Math.max(0, input.subtotalMinor - itemDiscountMinor);
    const vatMinor = Math.round(vatBasisMinor * vatRate);
    const taxSnapshot = {
      jurisdiction: "NG",
      name: "VAT",
      rate: vatRate,
      basis: "product_subtotal",
      version: "ng-vat-7.5-v1",
    };

    const payableBeforeCredits = Math.max(
      0,
      input.subtotalMinor - itemDiscountMinor + vatMinor + deliveryFeeMinor,
    );
    // Credits are a prepayment instrument: they come off what Hook collects
    // up front. On Pay at Handover there is nothing to collect up front, so
    // there is nothing for them to reduce — they stay in the wallet instead
    // of silently vanishing against a cash-on-delivery total.
    const creditsEligible = input.paymentMethod === CommercePaymentMethod.PREPAID;
    const creditsAppliedMinor = input.useCredits && creditsEligible
      ? Math.min(
          await this.credits.spendableFor(input.customerId, input.subtotalMinor),
          payableBeforeCredits,
        )
      : 0;

    if (input.useCredits && !creditsEligible) {
      throw new HttpError(
        409,
        "Hook credit can only be used when you pay now",
        undefined,
        "CREDITS_REQUIRE_PREPAYMENT",
      );
    }

    return {
      coupon,
      couponDiscountMinor,
      itemDiscountMinor,
      creditsEligible,
      creditsAppliedMinor,
      vatRate,
      vatMinor,
      taxSnapshot,
      deliveryFeeMinor,
      totalMinor: Math.max(0, payableBeforeCredits - creditsAppliedMinor),
    };
  }

  async preview(
    actor: CheckoutActor,
    stateIdentifier: string,
    input: PreviewInput,
  ) {
    const combined = actor.type === "customer" && stateIdentifier === "all";
    const combinedCart = combined
      ? await Cart.findOne({ customerId: actor.customerId, ownerType: "customer", status: "active", isCheckedOut: false }).lean({ virtuals: true })
      : null;
    const firstCombinedItem = combinedCart
      ? await CartItem.findOne({ cartId: recordId(combinedCart) }).select("stateId").lean()
      : null;
    const resolvedStateIdentifier = combined
      ? String(firstCombinedItem?.stateId || "")
      : stateIdentifier;
    if (combined && !resolvedStateIdentifier) {
      throw new HttpError(409, "Cart is empty", undefined, "CART_EMPTY");
    }
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
      ...idFilter(resolvedStateIdentifier),
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
    const stateIdentifiers = storedStateIdentifiers(state, resolvedStateIdentifier);
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

    const cart = combinedCart || await Cart.findOne({
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
      ...(combined ? {} : { stateId: { $in: stateIdentifiers } }),
    }).lean({ virtuals: true });
    if (!cartItems.length)
      throw new HttpError(
        409,
        "This State basket is empty",
        undefined,
        "CART_EMPTY",
      );
    const lines = await this.revalidateLines(actor.customerId, cartItems);
    const groupedLines = [...lines.reduce((groups, line) => {
      const key = String(line.stateId);
      const group = groups.get(key) || { sourceStateId: key, lines: [], subtotalMinor: 0 };
      group.lines.push(line);
      group.subtotalMinor += Number(line.totalPriceMinor);
      groups.set(key, group);
      return groups;
    }, new Map<string, { sourceStateId: string; lines: typeof lines; subtotalMinor: number }>()).values()];

    let addressSnapshot: Record<string, unknown> | undefined;
    let deliveryState = state;
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
    const logisticsProvider = input.logisticsProviderId
      ? await this.logisticsProviders.getSelectable(input.logisticsProviderId)
      : undefined;
    const deliveryPricing = input.deliveryMethod === DeliveryMethod.PARTNER_PICKUP
      ? { scope: "partner" as const, mode: "flat" as const, feeMinor: 0, ruleVersion: "partner-pickup-v1" }
      : await calculateDeliveryPricing({
            state: deliveryState,
            coordinates: addressSnapshot?.coordinates as { latitude: number; longitude: number } | undefined,
            defaultFeeMinor: settings.defaultDeliveryFeeMinor ?? DEFAULT_DELIVERY_FEE_MINOR,
          });
    const money = await this.calculateMoney({
      customerId: actor.customerId,
      subtotalMinor,
      deliveryFeeMinor: deliveryPricing.feeMinor,
      paymentMethod: input.paymentMethod,
      couponCode: input.couponCode,
      useCredits: input.useCredits,
    });
    const { vatRate, vatMinor, taxSnapshot, deliveryFeeMinor, couponDiscountMinor, creditsAppliedMinor, totalMinor, coupon } = money;
    const podLimitMinor = Number(
      deliveryState.podLimitMinor ??
        settings.defaultPodLimitMinor ??
        DEFAULT_POD_LIMIT_MINOR,
    );
    const podEnabled = Boolean(
      !POD_PAUSED &&
      settings.podEnabled &&
      deliveryState.podEnabled &&
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
      sourceStateIds: groupedLines.map((group) => group.sourceStateId),
      fulfilmentGroups: groupedLines.map((group) => ({ sourceStateId: group.sourceStateId, subtotalMinor: group.subtotalMinor })),
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
      vatRate,
      vatMinor,
      taxSnapshot,
      deliveryFeeMinor,
      deliveryPricing,
      logisticsProviderId: logisticsProvider?.publicId,
      logisticsProviderSnapshot: logisticsProvider
        ? { publicId: logisticsProvider.publicId, code: logisticsProvider.code, name: logisticsProvider.name }
        : undefined,
      couponId: coupon?.couponId,
      couponCode: coupon?.code,
      couponDiscountMinor,
      creditsAppliedMinor,
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
      fulfilmentGroups: groupedLines,
      sourceStateCount: groupedLines.length,
      subtotalMinor,
      vatRate,
      vatMinor,
      taxSnapshot,
      deliveryFeeMinor,
      deliveryPricing,
      logisticsProvider: logisticsProvider
        ? { id: logisticsProvider.publicId, code: logisticsProvider.code, name: logisticsProvider.name }
        : undefined,
      coupon: coupon ? { code: coupon.code, type: coupon.type, discountMinor: coupon.discountMinor } : undefined,
      couponDiscountMinor,
      creditsAppliedMinor,
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
    const combined = Array.isArray(preview.sourceStateIds) && preview.sourceStateIds.length > 1;
    const cartItems = await CartItem.find({
      cartId: cart.id,
      ...(combined ? {} : { stateId: { $in: stateIdentifiers } }),
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

    const currentSubtotalMinor = currentLines.reduce(
      (sum, line) => sum + Number(line.totalPriceMinor),
      0,
    );
    // calculateMoney() takes the GROSS delivery fee and applies any
    // free-delivery coupon itself, so this must be the pre-discount figure
    // that was quoted — preview.deliveryFeeMinor is already net of it.
    let currentGrossDeliveryFeeMinor = Number(
      (preview.deliveryPricing as any)?.feeMinor ?? preview.deliveryFeeMinor,
    );
    if (preview.logisticsProviderId) {
      // Re-resolve the courier: an admin may have withdrawn it since the quote.
      // The courier no longer sets the price; the delivery State does.
      await this.logisticsProviders.getSelectable(String(preview.logisticsProviderId));
    }
    if (preview.deliveryMethod === DeliveryMethod.HOME_DELIVERY) {
      const address = await this.addresses.getOwned(actor.customerId, String(preview.addressId || ""));
      const deliveryState = await resolveDeliveryState(String(address.stateId));
      if (!deliveryState || deliveryState.deliveryEnabled === false)
        throw new HttpError(409, "Delivery is no longer available in this State", undefined, "ADDRESS_OUTSIDE_COVERAGE");
      const settings = await this.getSettings();
      const pricing = await calculateDeliveryPricing({
        state: deliveryState,
        defaultFeeMinor: settings.defaultDeliveryFeeMinor ?? DEFAULT_DELIVERY_FEE_MINOR,
      });
      currentGrossDeliveryFeeMinor = pricing.feeMinor;
      if (pricing.ruleVersion !== (preview.deliveryPricing as any)?.ruleVersion)
        throw new HttpError(409, "Delivery pricing changed. Review checkout again.", undefined, "CHECKOUT_REVALIDATION_REQUIRED");
    }

    // Re-run the same money math the quote used. This re-validates the coupon
    // as a side effect, so one that expired or hit its cap in the meantime
    // throws here rather than silently under-charging.
    const currentMoney = await this.calculateMoney({
      customerId: actor.customerId,
      subtotalMinor: currentSubtotalMinor,
      deliveryFeeMinor: currentGrossDeliveryFeeMinor,
      paymentMethod: preview.paymentMethod as CommercePaymentMethod,
      couponCode: preview.couponCode,
      useCredits: Number(preview.creditsAppliedMinor || 0) > 0,
    });

    if (
      currentSubtotalMinor !== Number(preview.subtotalMinor) ||
      currentMoney.vatMinor !== Number(preview.vatMinor) ||
      currentMoney.deliveryFeeMinor !== Number(preview.deliveryFeeMinor) ||
      currentMoney.couponDiscountMinor !== Number(preview.couponDiscountMinor || 0) ||
      currentMoney.creditsAppliedMinor !== Number(preview.creditsAppliedMinor || 0) ||
      currentMoney.totalMinor !== Number(preview.totalMinor)
    )
      throw new HttpError(409, "Order totals changed. Review checkout again.", undefined, "CHECKOUT_REVALIDATION_REQUIRED");

    const groupSnapshots = (preview.fulfilmentGroups || []).map((group: any) => ({
      sourceStateId: String(group.sourceStateId),
      subtotalMinor: Number(group.subtotalMinor || 0),
    }));
    const effectiveGroups = groupSnapshots.length ? groupSnapshots : [{ sourceStateId: preview.stateId, subtotalMinor: Number(preview.subtotalMinor) }];
    const groupIds = await Promise.all(effectiveGroups.map(() => nextPublicId("orderFulfilmentGroup")));
    const pod = preview.paymentMethod === CommercePaymentMethod.PAY_AT_HANDOVER;
    const paymentIds = await Promise.all((pod ? effectiveGroups : [null]).map(() => nextPublicId("payment")));
    let allocatedFee = 0;
    let allocatedVat = 0;
    let allocatedDiscount = 0;
    let allocatedCredits = 0;
    const previewSubtotal = Math.max(Number(preview.subtotalMinor), 1);
    // Every money line is split across per-state groups by subtotal share,
    // with the remainder landing on the last group so the parts always sum
    // back to the whole. Discounts and credits need the same treatment as VAT
    // and delivery, or per-group settlement drifts from the order total.
    const share = (total: number, groupSubtotal: number, allocated: number, isLast: boolean) =>
      isLast ? total - allocated : Math.floor((total * groupSubtotal) / previewSubtotal);
    const groupPlans = effectiveGroups.map((group, index) => {
      const isLast = index === effectiveGroups.length - 1;
      const feeShare = share(Number(preview.deliveryFeeMinor), group.subtotalMinor, allocatedFee, isLast);
      allocatedFee += feeShare;
      const vatShare = share(Number(preview.vatMinor || 0), group.subtotalMinor, allocatedVat, isLast);
      allocatedVat += vatShare;
      const discountShare = share(Number(preview.couponDiscountMinor || 0), group.subtotalMinor, allocatedDiscount, isLast);
      allocatedDiscount += discountShare;
      const creditShare = share(Number(preview.creditsAppliedMinor || 0), group.subtotalMinor, allocatedCredits, isLast);
      allocatedCredits += creditShare;
      return {
        ...group,
        publicId: groupIds[index],
        vatShareMinor: vatShare,
        deliveryFeeShareMinor: feeShare,
        couponDiscountShareMinor: discountShare,
        creditsAppliedShareMinor: creditShare,
        paymentPublicId: pod ? paymentIds[index] : undefined,
      };
    });
    const ids = {
      order: await nextPublicId("order"),
      payment: paymentIds[0],
      items: await Promise.all(
        currentLines.map(() => nextPublicId("orderItem")),
      ),
    };
    const session = await mongoose.startSession();
    let orderId = "";
    try {
      await session.withTransaction(async () => {
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
          sourceStateIds: groupPlans.map((group) => group.sourceStateId),
          fulfilmentGroupIds: groupPlans.map((group) => group.publicId),
          initiatingPartnerId: actor.partnerId,
          deliveryMethod: preview.deliveryMethod,
          commercePaymentMethod: preview.paymentMethod,
          commerceStatus,
          commercePaymentStatus: pod
            ? CommercePaymentStatus.DUE_AT_HANDOVER
            : CommercePaymentStatus.PENDING,
          subtotalMinor: preview.subtotalMinor,
          vatRate: preview.vatRate,
          vatMinor: preview.vatMinor,
          taxSnapshot: preview.taxSnapshot,
          deliveryFeeMinor: preview.deliveryFeeMinor,
          deliveryPricing: preview.deliveryPricing,
          logisticsProviderId: preview.logisticsProviderId,
          logisticsProviderSnapshot: preview.logisticsProviderSnapshot,
          couponId: preview.couponId,
          couponCode: preview.couponCode,
          couponDiscountMinor: Number(preview.couponDiscountMinor || 0),
          creditsAppliedMinor: Number(preview.creditsAppliedMinor || 0),
          totalMinor: preview.totalMinor,
          currency: preview.currency,
          subtotal: preview.subtotalMinor / 100,
          deliveryFee: preview.deliveryFeeMinor / 100,
          // Legacy major-unit mirror of everything taken off the order.
          discount:
            (Number(preview.couponDiscountMinor || 0) + Number(preview.creditsAppliedMinor || 0)) / 100,
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
          timeline: [timelineEntry(commerceStatus, actor.actorId, { channel: preview.channel })],
        });
        await order.save({ session });
        orderId = order.id;
        const createdItems = await OrderItem.insertMany(
          currentLines.map((line, index) => ({
            publicId: ids.items[index],
            orderId: order.id,
            productId: line.productId,
            variantId: line.variantId,
            marketId: line.marketId,
            stateId: line.stateId,
            fulfilmentGroupId: groupPlans.find((group) => group.sourceStateId === String(line.stateId))?.publicId,
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
        await OrderFulfilmentGroup.insertMany(
          groupPlans.map((group) => ({
            publicId: group.publicId,
            orderId: order.id,
            sourceStateId: group.sourceStateId,
            orderItemIds: createdItems.filter((item) => item.fulfilmentGroupId === group.publicId).map((item) => item.publicId || item.id),
            subtotalMinor: group.subtotalMinor,
            vatShareMinor: group.vatShareMinor,
            deliveryFeeShareMinor: group.deliveryFeeShareMinor,
            couponDiscountShareMinor: group.couponDiscountShareMinor,
            creditsAppliedShareMinor: group.creditsAppliedShareMinor,
            status: "PENDING",
          })),
          { session },
        );
        await Payment.create(
          (pod ? groupPlans : [{
            publicId: undefined,
            subtotalMinor: Number(preview.subtotalMinor),
            vatShareMinor: Number(preview.vatMinor || 0),
            deliveryFeeShareMinor: Number(preview.deliveryFeeMinor),
            couponDiscountShareMinor: Number(preview.couponDiscountMinor || 0),
            creditsAppliedShareMinor: Number(preview.creditsAppliedMinor || 0),
            paymentPublicId: ids.payment,
          }]).map((group) => {
            // Charge the discounted figure: the coupon and any credits the
            // customer applied come off what the gateway actually collects.
            const payableMinor = Math.max(
              0,
              group.subtotalMinor
                + group.vatShareMinor
                + group.deliveryFeeShareMinor
                - group.couponDiscountShareMinor
                - group.creditsAppliedShareMinor,
            );
            return {
              publicId: group.paymentPublicId,
              orderId: order.id,
              fulfilmentGroupId: group.publicId,
              resourceType: "order",
              transactionRef: `PSK-${group.paymentPublicId}`,
              gateway: "paystack",
              paymentMethod: pod ? "pos" : "card",
              amount: payableMinor / 100,
              amountMinor: payableMinor,
              currency: preview.currency,
              gatewayFee: 0,
              amountSettled: 0,
              status: PaymentStatus.PENDING,
              commerceStatus: pod
                ? CommercePaymentStatus.DUE_AT_HANDOVER
                : CommercePaymentStatus.PENDING,
              refundedAmount: 0,
            };
          }),
          { session },
        );
        if (pod) {
          const payments = await Payment.find({ orderId: order.id }).session(session).select("_id publicId fulfilmentGroupId").lean();
          for (const payment of payments) {
            await OrderFulfilmentGroup.updateOne(
              { publicId: payment.fulfilmentGroupId },
              { $set: { paymentId: payment.publicId || String(payment._id) } },
              { session },
            );
          }
        }
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
          { cartId: cart.id, ...(combined ? {} : { stateId: { $in: stateIdentifiers } }) },
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
        // Coupon use, Hook credit debit and the follow-up notification commit
        // with the order. They used to run after the commit with errors
        // swallowed, so a failure silently gave a discount that was never
        // booked. Now any failure rolls the whole checkout back. Both are
        // keyed on the caller's idempotencyKey, so a retried confirm is a no-op.
        if (preview.couponId && Number(preview.couponDiscountMinor || 0) > 0) {
          await this.coupons.redeem({
            couponId: String(preview.couponId),
            couponCode: String(preview.couponCode),
            userId: actor.customerId,
            orderId,
            discountMinor: Number(preview.couponDiscountMinor),
            idempotencyKey,
          }, session);
        }
        if (Number(preview.creditsAppliedMinor || 0) > 0) {
          await this.credits.spend({
            userId: actor.customerId,
            amountMinor: Number(preview.creditsAppliedMinor),
            orderId,
            idempotencyKey,
          }, session);
        }
        await emitOutbox([{
          aggregateType: "order",
          aggregateId: order.id,
          eventType: "ORDER_CREATED_EFFECTS",
          payload: {
            orderId: ids.order,
            customerId: actor.customerId,
            paymentMethod: preview.paymentMethod,
            stateId: preview.stateId,
          },
        }], session);
      });
    } catch (error) {
      // A concurrent confirm with the same key lost the unique-index race (or
      // hit a write conflict). Return the winner's order instead of an error.
      if (isDuplicateKeyError(error) || (error as any)?.hasErrorLabel?.("TransientTransactionError")) {
        const winner = await Order.findOne({ idempotencyKey }).lean({ virtuals: true });
        if (winner && winner.userId === actor.customerId) return this.orderResult(winner.id);
      }
      throw error;
    } finally {
      await session.endSession();
    }

    wakeOutbox();
    const result = await this.orderResult(orderId);
    return result;
  }

  /**
   * Outbox consumer for ORDER_CREATED_EFFECTS. Runs after the checkout
   * transaction commits; the notification is keyed on the order, so a replay
   * cannot notify twice, and a failure retries instead of being swallowed.
   */
  async deliverOrderCreatedEffects(event: { payload: Record<string, any> }) {
    const { orderId, customerId, paymentMethod, stateId } = event.payload;
    if (!customerId) return;
    const prepaid = paymentMethod === CommercePaymentMethod.PREPAID;
    await createCommerceNotification({
      eventKey: `order:${orderId}:created`,
      userId: customerId,
      title: prepaid ? "Complete your payment" : "Order under review",
      body: prepaid
        ? "Your State Order is ready for secure Paystack payment."
        : "Hook Operations will review your Pay-at-Handover request.",
      type: "order_created",
      data: { orderId, stateId },
    });
    const order = await Order.findOne({ publicId: orderId }).lean({ virtuals: true }) as any;
    const customer = await User.findById(customerId).select("email firstName").lean() as any;
    if (order && customer?.email) {
      const itemCount = await OrderItem.countDocuments({ orderId: String(order._id) });
      await this.email.sendOrderConfirmation({
        to: customer.email,
        name: customer.firstName,
        orderCode: orderId,
        amount: Number(order.totalMinor || 0) / 100,
        itemCount,
      });
    }
  }

  private async revalidateLines(customerId: string, items: any[]) {
    const products = await Product.find({
      _id: { $in: items.map((item) => item.productId) },
      status: ProductStatus.PUBLISHED,
      availabilityStatus: { $in: [ProductAvailabilityStatus.AVAILABLE, ProductAvailabilityStatus.LIMITED] },
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
          ...(item.variantId ? { variantId: item.variantId } : {}),
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
    const [order, items, payments, fulfilmentGroups] = await Promise.all([
      Order.findById(id).lean({ virtuals: true }),
      OrderItem.find({ orderId: id }).lean({ virtuals: true }),
      Payment.find({ orderId: id }).lean({ virtuals: true }),
      OrderFulfilmentGroup.find({ orderId: id }).sort({ createdAt: 1 }).lean({ virtuals: true }),
    ]);
    return {
      ...order,
      id: order?.publicId,
      items: items.map((item) => ({ ...item, id: item.publicId })),
      payment: payments[0] ? { ...payments[0], id: payments[0].publicId } : undefined,
      payments: payments.map((payment) => ({ ...payment, id: payment.publicId })),
      fulfilmentGroups: fulfilmentGroups.map((group) => ({ ...group, id: group.publicId })),
    };
  }
}
