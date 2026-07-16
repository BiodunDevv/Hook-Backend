// ============================================================
// Role constants — maps directly to user.role column
// ============================================================
export enum UserRole {
  SHOPPER = 'shopper',
  VENDOR = 'vendor',
  FIELD_AGENT = 'field_agent',
  EV_DRIVER = 'ev_driver',
  SUPPORT = 'support',
  ADMIN = 'admin',
  SUPER_ADMIN = 'super_admin',
}

// ============================================================
// Order lifecycle
// ============================================================
export enum OrderStatus {
  AWAITING_PAYMENT = 'awaiting_payment',
  PENDING = 'pending',
  CONFIRMED = 'confirmed',
  SHIPPED = 'shipped',
  // Legacy aliases keep older callers source-compatible while the public
  // lifecycle remains pending -> confirmed -> shipped -> delivered.
  PROCESSING = 'confirmed',
  PACKED = 'confirmed',
  PICKED_UP = 'shipped',
  IN_TRANSIT = 'shipped',
  DELIVERED = 'delivered',
  CANCELLED = 'cancelled',
  RETURNED = 'returned',
  REFUNDED = 'refunded',
}

export enum PaymentMode {
  PAY_NOW = 'pay_now',
  PAY_ON_DELIVERY = 'pay_on_delivery',
}

export enum OrderType {
  STANDARD = 'standard',
  GIFT = 'gift',
}

export enum VendorFulfilmentStatus {
  AWAITING_CONFIRMATION = 'awaiting_confirmation',
  CONFIRMED = 'confirmed',
  REJECTED = 'rejected',
  SHIPPED = 'shipped',
  DELIVERED = 'delivered',
}

export enum EscrowEventType {
  PAYMENT_RECEIVED = 'payment_received',
  HELD = 'held',
  PARTIALLY_REFUNDED = 'partially_refunded',
  REFUND_PENDING = 'refund_pending',
  ELIGIBLE_FOR_PAYOUT = 'eligible_for_payout',
  PAID_OUT = 'paid_out',
  DISPUTED = 'disputed',
}

export enum PaymentStatus {
  UNPAID = 'unpaid',
  PENDING = 'pending',
  SUCCESSFUL = 'successful',
  FAILED = 'failed',
  REFUNDED = 'refunded',
  PARTIALLY_REFUNDED = 'partially_refunded',
}

export enum NegotiationStatus {
  ACTIVE = 'active',
  ACCEPTED = 'accepted',
  DECLINED = 'declined',
  EXPIRED = 'expired',
  WITHDRAWN = 'withdrawn',
}

export enum LogisticsStatus {
  ASSIGNED = 'assigned',
  DRIVER_ACKNOWLEDGED = 'driver_acknowledged',
  AT_PICKUP = 'at_pickup',
  ITEM_PACKED = 'item_packed',
  QR_TAGGED = 'qr_tagged',
  IN_TRANSIT = 'in_transit',
  DELIVERED = 'delivered',
  FAILED = 'failed',
}

export enum ProductStatus {
  DRAFT = 'draft',
  PENDING_APPROVAL = 'pending_approval',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  DISABLED = 'disabled',
  SOLD_OUT = 'sold_out',
}

export enum VendorTier {
  TIER_1 = 'tier_1', // Major retailers — full IMS/API integration
  TIER_2 = 'tier_2', // Independent boutiques — vendor portal
  TIER_3 = 'tier_3', // Open market stalls — field-agent managed
}

export enum SettlementStatus {
  PENDING_ESCROW = 'pending_escrow',
  CLEARED = 'cleared',
  PAID = 'paid',
  FAILED = 'failed',
}

export enum BoothType {
  PHYGITAL = 'phygital',
  MICRO_HUB = 'micro_hub',
}

// ============================================================
// Defaults
// ============================================================
export const PAGINATION_DEFAULTS = {
  PAGE: 1,
  LIMIT: 20,
  MAX_LIMIT: 100,
};

export const VENDOR_COMMISSION_PERCENTAGE = 15;
export const ESCROW_HOLD_HOURS = 24;
export const DELIVERY_SLA_HOURS = 24;
export const DEFAULT_DELIVERY_FEE = 3000;
export const VENDOR_CONFIRMATION_HOURS = 2;
export const GIFT_EXPIRY_DAYS = 7;
