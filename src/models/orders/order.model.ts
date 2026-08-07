import {
  OrderStatus,
  OrderType,
  PaymentMode,
  PaymentStatus,
} from "@lib/constants";
import { BaseEntity, createModel, createSchema } from "@models/base.model";

export interface Order extends BaseEntity {
  publicId?: string;
  channel?: "SHOPPER_APP" | "PARTNER_ASSISTED";
  sourceStateId?: string;
  initiatingPartnerId?: string;
  deliveryMethod?: "HOME_DELIVERY" | "PARTNER_PICKUP";
  commercePaymentMethod?: "PREPAID" | "PAY_AT_HANDOVER";
  commerceStatus?:
    | "AWAITING_PAYMENT"
    | "VERIFICATION_PENDING"
    | "OPERATIONS_REVIEW"
    | "APPROVED_FOR_FULFILMENT"
    | "IN_FULFILMENT"
    | "PARTIALLY_RECEIVED"
    | "READY_FOR_CONSOLIDATION"
    | "READY_FOR_DISPATCH"
    | "IN_TRANSIT"
    | "DELIVERED"
    | "COLLECTED"
    | "COMPLETED"
    | "ON_HOLD"
    | "RETURN_IN_PROGRESS"
    | "REFUNDED"
    | "CANCELLED";
  commercePaymentStatus?:
    | "PENDING"
    | "PROCESSING"
    | "CONFIRMED"
    | "FAILED"
    | "DUE_AT_HANDOVER"
    | "REFUND_PENDING"
    | "REFUNDED";
  subtotalMinor?: number;
  deliveryFeeMinor?: number;
  deliveryPricing?: Record<string, unknown>;
  totalMinor?: number;
  currency?: string;
  customerSnapshot?: Record<string, unknown>;
  addressSnapshot?: Record<string, unknown>;
  pickupPartnerSnapshot?: Record<string, unknown>;
  policyVersions?: Record<string, string>;
  timeline?: Array<Record<string, unknown>>;
  checkoutPreviewId?: string;
  idempotencyKey?: string;
  podReview?: Record<string, unknown>;
  orderCode: string;
  userId?: string;
  guestId?: string;
  guestEmail?: string;
  guestName?: string;
  items?: any[];
  payment?: any;
  logistics?: any;
  user?: any;
  subtotal: number;
  deliveryFee: number;
  discount: number;
  total: number;
  vendorCount: number;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  paymentMode: PaymentMode;
  orderType: OrderType;
  giftRecipient?: {
    name: string;
    email: string;
    phone: string;
    address: Order["deliveryAddress"];
    message?: string;
  };
  boothId?: string;
  boothSnapshot?: {
    name: string;
    accessCodeMasked: string;
    source: "code" | "qr";
  };
  attendantSnapshot?: {
    userId: string;
    name: string;
    email: string;
    phone: string;
  };
  deliverySubsidy: number;
  vendorConfirmationDeadline?: Date;
  partialFulfilment: boolean;
  deliveryAddress: {
    street: string;
    city: string;
    state: string;
    landmark?: string;
    coordinates?: { lat: number; lng: number };
    phone: string;
  };
  deliveryNotes?: string;
  scheduledDeliveryAt?: Date;
  deliveredAt?: Date;
  cancelledAt?: Date;
  cancellationReason?: string;
  commerceMigrationVersion?: number;
  legacyCommerceSnapshot?: Record<string, unknown>;
  fulfilmentSummary?: Record<string, unknown>;
  fulfilmentCompletedAt?: Date;
  customerProgress?: Array<Record<string, unknown>>;
}

const OrderSchema = createSchema<Order>({
  publicId: { type: String, unique: true, sparse: true, index: true },
  channel: {
    type: String,
    enum: ["SHOPPER_APP", "PARTNER_ASSISTED"],
    index: true,
  },
  sourceStateId: { type: String, index: true, sparse: true },
  initiatingPartnerId: { type: String, index: true, sparse: true },
  deliveryMethod: { type: String, enum: ["HOME_DELIVERY", "PARTNER_PICKUP"] },
  commercePaymentMethod: {
    type: String,
    enum: ["PREPAID", "PAY_AT_HANDOVER"],
    index: true,
  },
  commerceStatus: {
    type: String,
    enum: [
      "AWAITING_PAYMENT",
      "VERIFICATION_PENDING",
      "OPERATIONS_REVIEW",
      "APPROVED_FOR_FULFILMENT",
      "IN_FULFILMENT",
      "PARTIALLY_RECEIVED",
      "READY_FOR_CONSOLIDATION",
      "READY_FOR_DISPATCH",
      "IN_TRANSIT",
      "DELIVERED",
      "COLLECTED",
      "COMPLETED",
      "ON_HOLD",
      "RETURN_IN_PROGRESS",
      "REFUNDED",
      "CANCELLED",
    ],
    index: true,
  },
  commercePaymentStatus: {
    type: String,
    enum: [
      "PENDING",
      "PROCESSING",
      "CONFIRMED",
      "FAILED",
      "DUE_AT_HANDOVER",
      "REFUND_PENDING",
      "REFUNDED",
    ],
    index: true,
  },
  subtotalMinor: { type: Number, min: 0 },
  deliveryFeeMinor: { type: Number, min: 0 },
  deliveryPricing: { type: Object },
  totalMinor: { type: Number, min: 0 },
  currency: { type: String, default: "NGN" },
  customerSnapshot: { type: Object },
  addressSnapshot: { type: Object },
  pickupPartnerSnapshot: { type: Object },
  policyVersions: { type: Object },
  timeline: { type: [Object], default: [] },
  checkoutPreviewId: { type: String, unique: true, sparse: true, index: true },
  idempotencyKey: { type: String, unique: true, sparse: true },
  podReview: { type: Object },
  orderCode: { type: String, required: true, unique: true, index: true },
  userId: { type: String, index: true },
  guestId: { type: String, index: true },
  guestEmail: { type: String, lowercase: true, trim: true },
  guestName: { type: String },
  subtotal: { type: Number, required: true },
  deliveryFee: { type: Number, default: 0 },
  discount: { type: Number, default: 0 },
  total: { type: Number, required: true },
  vendorCount: { type: Number, default: 0 },
  status: {
    type: String,
    enum: Object.values(OrderStatus),
    default: OrderStatus.PENDING,
    index: true,
  },
  paymentStatus: {
    type: String,
    enum: Object.values(PaymentStatus),
    default: PaymentStatus.UNPAID,
    index: true,
  },
  paymentMode: {
    type: String,
    enum: Object.values(PaymentMode),
    default: PaymentMode.PAY_NOW,
    index: true,
  },
  orderType: {
    type: String,
    enum: Object.values(OrderType),
    default: OrderType.STANDARD,
    index: true,
  },
  giftRecipient: { type: Object },
  boothId: { type: String, index: true },
  boothSnapshot: { type: Object },
  attendantSnapshot: { type: Object },
  deliverySubsidy: { type: Number, default: 0 },
  vendorConfirmationDeadline: { type: Date, index: true },
  partialFulfilment: { type: Boolean, default: false },
  deliveryAddress: { type: Object, required: true },
  deliveryNotes: { type: String },
  scheduledDeliveryAt: { type: Date },
  deliveredAt: { type: Date },
  cancelledAt: { type: Date },
  cancellationReason: { type: String },
  commerceMigrationVersion: { type: Number, index: true },
  legacyCommerceSnapshot: { type: Object },
  fulfilmentSummary: { type: Object, default: {} },
  fulfilmentCompletedAt: { type: Date },
  customerProgress: { type: [Object], default: [] },
  deletedAt: { type: Date },
});

OrderSchema.index({ userId: 1, status: 1 });
OrderSchema.index({ guestId: 1, status: 1 });
OrderSchema.index({ boothId: 1, createdAt: -1 });
OrderSchema.index({ boothId: 1, paymentStatus: 1, status: 1 });
OrderSchema.index({ userId: 1, commerceStatus: 1, createdAt: -1 });
OrderSchema.index({ sourceStateId: 1, commerceStatus: 1, createdAt: -1 });
OrderSchema.index({ initiatingPartnerId: 1, createdAt: -1 });

export const Order = createModel<Order>("Order", OrderSchema);
