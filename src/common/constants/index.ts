// ============================================================
// Role constants — maps directly to user.role column
// ============================================================
export enum UserRole {
  SHOPPER = 'shopper',
  VENDOR = 'vendor',
  FIELD_AGENT = 'field_agent',
  EV_DRIVER = 'ev_driver',
  ADMIN = 'admin',
  SUPER_ADMIN = 'super_admin',
}

// ============================================================
// Order lifecycle
// ============================================================
export enum OrderStatus {
  PENDING = 'pending',
  CONFIRMED = 'confirmed',
  PROCESSING = 'processing',
  PACKED = 'packed',
  PICKED_UP = 'picked_up',
  IN_TRANSIT = 'in_transit',
  DELIVERED = 'delivered',
  CANCELLED = 'cancelled',
  RETURNED = 'returned',
  REFUNDED = 'refunded',
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
