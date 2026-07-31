import { PaymentStatus } from "@lib/constants";
import { BaseEntity, createModel, createSchema } from "@models/base.model";

export interface Payment extends BaseEntity {
  publicId?: string;
  orderId?: string;
  giftId?: string;
  resourceType: "order" | "gift";
  transactionRef: string;
  gatewayRef?: string;
  gateway: "opay" | "paystack" | "nomba";
  paymentMethod: "card" | "bank_transfer" | "ussd" | "pos";
  amount: number;
  gatewayFee: number;
  amountSettled: number;
  status: PaymentStatus;
  gatewayResponse?: Record<string, unknown>;
  paidAt?: Date;
  splitData?: {
    hookShare: number;
    vendorShare: number;
    deliveryFee: number;
    commission: number;
  };
  refundedAt?: Date;
  refundedAmount: number;
  order?: any;
  amountMinor?: number;
  currency?: string;
  commerceStatus?:
    | "PENDING"
    | "PROCESSING"
    | "CONFIRMED"
    | "FAILED"
    | "DUE_AT_HANDOVER"
    | "REFUND_PENDING"
    | "REFUNDED";
  providerEventId?: string;
  authorizationUrl?: string;
  accessCode?: string;
  commerceMigrationVersion?: number;
  legacyProvider?: string;
}

const PaymentSchema = createSchema<Payment>({
  publicId: { type: String, unique: true, sparse: true, index: true },
  orderId: { type: String, unique: true, sparse: true, index: true },
  giftId: { type: String, unique: true, sparse: true, index: true },
  resourceType: {
    type: String,
    enum: ["order", "gift"],
    default: "order",
    index: true,
  },
  transactionRef: { type: String, required: true, unique: true },
  gatewayRef: { type: String, index: true },
  gateway: {
    type: String,
    enum: ["opay", "paystack", "nomba"],
    required: true,
  },
  paymentMethod: {
    type: String,
    enum: ["card", "bank_transfer", "ussd", "pos"],
    required: true,
  },
  amount: { type: Number, required: true },
  gatewayFee: { type: Number, default: 0 },
  amountSettled: { type: Number, default: 0 },
  status: {
    type: String,
    enum: Object.values(PaymentStatus),
    default: PaymentStatus.PENDING,
    index: true,
  },
  gatewayResponse: { type: Object },
  paidAt: { type: Date },
  splitData: { type: Object },
  refundedAt: { type: Date },
  refundedAmount: { type: Number, default: 0 },
  amountMinor: { type: Number, min: 0 },
  currency: { type: String, default: "NGN" },
  commerceStatus: {
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
  providerEventId: { type: String, index: true, sparse: true },
  authorizationUrl: { type: String },
  accessCode: { type: String },
  commerceMigrationVersion: { type: Number, index: true },
  legacyProvider: { type: String },
  deletedAt: { type: Date },
});

export const Payment = createModel<Payment>("Payment", PaymentSchema);
