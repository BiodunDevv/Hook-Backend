import { z } from 'zod';
import { normalizeProductColor } from '@lib/product-color';
import {
  BoothType,
  LogisticsStatus,
  NegotiationStatus,
  OrderStatus,
  OrderType,
  PaymentMode,
  PaymentStatus,
  ProductStatus,
  UserRole,
  VendorTier,
} from '@lib/constants';

// Entity ids are Mongo ObjectIds (24-char hex); accept UUIDs too for portability
export const idSchema = z.string().regex(
  /^([a-f0-9]{24}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i,
  'Invalid id format',
);

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  guestId: z.string().min(12).optional(),
});

export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

export const profileSchema = z.object({
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  phone: z.string().min(6).optional(),
  avatarUrl: z.string().url().optional(),
  address: z.record(z.string(), z.unknown()).optional(),
  preferences: z.record(z.string(), z.unknown()).optional(),
});

export const passwordResetRequestSchema = z.object({ email: z.string().email() });
export const passwordResetSchema = z.object({
  email: z.string().email(),
  code: z.string().min(4),
  password: z.string().min(6),
});
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(6),
});

export const cartItemSchema = z.object({
  productId: idSchema,
  quantity: z.coerce.number().int().positive(),
  selectedVariants: z.object({
    color: z.string().optional(),
    size: z.string().optional(),
  }).optional(),
  boothSessionToken: z.string().min(20).optional(),
});

export const cartQuantitySchema = z.object({ quantity: z.coerce.number().int().positive() });

export const checkoutSchema = z.object({
  guestEmail: z.string().email().optional(),
  guestName: z.string().min(2).optional(),
  deliveryAddress: z.object({
    street: z.string().min(1),
    city: z.string().min(1),
    state: z.string().min(1),
    landmark: z.string().optional(),
    coordinates: z.object({ lat: z.number(), lng: z.number() }).optional(),
    phone: z.string().min(6),
  }),
  deliveryNotes: z.string().optional(),
  scheduledDeliveryAt: z.coerce.date().optional(),
  paymentMode: z.nativeEnum(PaymentMode).default(PaymentMode.PAY_NOW),
  orderType: z.nativeEnum(OrderType).default(OrderType.STANDARD),
  giftRecipient: z.object({
    name: z.string().trim().min(2),
    email: z.string().email(),
    phone: z.string().trim().min(7),
    address: z.object({
      street: z.string().min(1), city: z.string().min(1), state: z.string().min(1),
      landmark: z.string().optional(), coordinates: z.object({ lat: z.number(), lng: z.number() }).optional(),
      phone: z.string().min(6),
    }),
    message: z.string().trim().max(500).optional(),
  }).optional(),
  boothSessionToken: z.string().min(20).optional(),
}).superRefine((data, ctx) => {
  if (data.orderType === OrderType.GIFT && !data.giftRecipient) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['giftRecipient'], message: 'Gift recipient delivery details are required' });
  }
  if (data.orderType === OrderType.GIFT && data.paymentMode !== PaymentMode.PAY_NOW) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['paymentMode'], message: 'Gift orders must be paid before fulfilment' });
  }
});

export const negotiationSchema = z.object({
  productId: idSchema,
  offeredPrice: z.coerce.number().positive(),
  message: z.string().optional(),
}).strict();

export const paymentInitializeSchema = z.object({
  orderId: idSchema,
  gateway: z.literal('opay').default('opay'),
  paymentMethod: z.enum(['card', 'bank_transfer', 'ussd', 'pos']).default('card'),
  savePaymentMethod: z.boolean().default(false),
});

export const vendorRegistrationSchema = z.object({
  businessName: z.string().min(2),
  businessEmail: z.string().email().optional(),
  businessPhone: z.string().optional(),
  businessAddress: z.string().optional(),
  description: z.string().optional(),
});

export const vendorBankSchema = z.object({
  bankName: z.string().min(1),
  accountNumber: z.string().min(6),
  accountName: z.string().min(2),
  bankCode: z.string().min(1),
});

const productBaseSchema = z.object({
  title: z.string().min(2),
  description: z.string().optional(),
  costPrice: z.coerce.number().positive(),
  sellingPrice: z.coerce.number().positive(),
  discountedPrice: z.coerce.number().positive().optional(),
  minAcceptablePrice: z.coerce.number().positive(),
  quantity: z.coerce.number().int().nonnegative().default(0),
  categoryId: idSchema,
  images: z.array(z.string().url()).min(1, 'At least one product image is required'),
  colors: z.array(z.string().transform((value, ctx) => {
    const normalized = normalizeProductColor(value);
    if (!normalized) {
      ctx.addIssue({ code: 'custom', message: 'Colors must be a valid hex value such as #FFC809' });
      return z.NEVER;
    }
    return normalized;
  })).optional(),
  sizes: z.array(z.string()).optional(),
});

function validateNegotiationFloor(
  data: { minAcceptablePrice?: number; sellingPrice?: number },
  ctx: z.RefinementCtx,
) {
  if (
    data.minAcceptablePrice !== undefined &&
    data.sellingPrice !== undefined &&
    data.minAcceptablePrice > data.sellingPrice
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['minAcceptablePrice'],
      message: 'Negotiation floor cannot exceed the Hook platform price',
    });
  }
}

export const productSchema = productBaseSchema.superRefine(validateNegotiationFloor);

export const adminVendorCreateSchema = z.object({
  ownerEmail: z.string().email(),
  ownerFirstName: z.string().min(1).default('Vendor'),
  ownerLastName: z.string().min(1).default('Owner'),
  ownerPhone: z.string().optional(),
  password: z.string().min(6).default('123456'),
  businessName: z.string().min(2),
  businessEmail: z.string().email().optional(),
  businessPhone: z.string().optional(),
  businessAddress: z.string().optional(),
  stateCode: z.string().trim().min(2).max(3).optional(),
  description: z.string().optional(),
  imageUrl: z.string().url().optional(),
  tier: z.nativeEnum(VendorTier).default(VendorTier.TIER_3),
  commissionPercentage: z.coerce.number().min(0).max(100).default(15),
  isApproved: z.boolean().default(false),
  isActive: z.boolean().default(true),
});

export const adminVendorUpdateSchema = adminVendorCreateSchema.omit({
  ownerEmail: true,
  ownerFirstName: true,
  ownerLastName: true,
  ownerPhone: true,
  password: true,
}).partial();

export const adminProductCreateSchema = productBaseSchema.extend({
  vendorId: idSchema,
  status: z.nativeEnum(ProductStatus).default(ProductStatus.PENDING_APPROVAL),
}).superRefine(validateNegotiationFloor);

export const adminProductUpdateSchema = productBaseSchema.extend({
  vendorId: idSchema,
  status: z.nativeEnum(ProductStatus).default(ProductStatus.PENDING_APPROVAL),
}).partial().superRefine(validateNegotiationFloor);

export const adminOrderCreateSchema = z.object({
  userId: idSchema,
  items: z.array(z.object({
    productId: idSchema,
    quantity: z.coerce.number().int().positive(),
    selectedVariants: z.object({
      color: z.string().optional(),
      size: z.string().optional(),
    }).optional(),
  })).min(1),
  deliveryAddress: checkoutSchema.shape.deliveryAddress,
  deliveryFee: z.coerce.number().nonnegative().default(0),
  discount: z.coerce.number().nonnegative().default(0),
  deliveryNotes: z.string().optional(),
  scheduledDeliveryAt: z.coerce.date().optional(),
  paymentStatus: z.nativeEnum(PaymentStatus).default(PaymentStatus.UNPAID),
  status: z.nativeEnum(OrderStatus).default(OrderStatus.PENDING),
});

export const adminOrderUpdateSchema = z.object({
  deliveryAddress: checkoutSchema.shape.deliveryAddress.optional(),
  deliveryFee: z.coerce.number().nonnegative().optional(),
  discount: z.coerce.number().nonnegative().optional(),
  deliveryNotes: z.string().optional(),
  scheduledDeliveryAt: z.coerce.date().optional(),
  paymentStatus: z.nativeEnum(PaymentStatus).optional(),
  status: z.nativeEnum(OrderStatus).optional(),
});

export const adminAssignDriverSchema = z.object({
  driverId: idSchema,
});

export const adminDriverCreateSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6).default('123456'),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  phone: z.string().optional(),
  stateCode: z.string().trim().min(2).max(3).optional(),
  isActive: z.boolean().default(true),
});

export const adminBoothCreateSchema = z.object({
  name: z.string().min(2),
  description: z.string().optional(),
  boothType: z.nativeEnum(BoothType).default(BoothType.PHYGITAL),
  location: z.object({
    address: z.string().min(1),
    lat: z.coerce.number().default(0),
    lng: z.coerce.number().default(0),
    stateCode: z.string().trim().min(2).max(3).optional(),
  }),
  fieldAgentId: idSchema.optional(),
  attendantUserId: idSchema.optional(),
  newAttendant: z.object({ firstName: z.string().min(1), lastName: z.string().min(1), email: z.string().email(), phone: z.string().regex(/^\+?[0-9\s-]{7,20}$/) }).optional(),
  previewImageUrl: z.string().url().optional(),
  isActive: z.boolean().default(true),
});

export const boothAttendantSchema = z.union([
  z.object({ attendantUserId: idSchema }),
  z.object({ firstName: z.string().min(1), lastName: z.string().min(1), email: z.string().email(), phone: z.string().regex(/^\+?[0-9\s-]{7,20}$/, 'Enter a valid phone number'), password: z.string().min(8).optional() }),
]);

export const operationalStateToggleSchema = z.object({
  isEnabled: z.boolean(),
});

export const operationalStateAssignSchema = z.object({
  stateCode: z.string().trim().min(2).max(3),
});

export const adminUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  role: z.nativeEnum(UserRole).default(UserRole.SHOPPER),
});

const PHONE_REGEX = /^\+?[0-9\s-]{7,20}$/;

export const staffCreateSchema = z
  .object({
    email: z.string().email(),
    password: z.string().min(6),
    firstName: z.string().min(1),
    lastName: z.string().min(1),
    phone: z.string().regex(PHONE_REGEX, 'Enter a valid phone number').optional(),
    role: z.enum([UserRole.SUPPORT, UserRole.ADMIN, UserRole.SUPER_ADMIN]),
    permissions: z.array(z.string()).default([]),
  })
  .superRefine((data, ctx) => {
    // Admin and support staff are reachable contacts for categories — phone required
    if (data.role !== UserRole.SUPER_ADMIN && !data.phone) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['phone'],
        message: 'Phone number is required for admin and support staff',
      });
    }
  });

export const staffUpdateSchema = z.object({
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  phone: z.string().regex(PHONE_REGEX, 'Enter a valid phone number').optional(),
});

export const staffPermissionsSchema = z.object({
  permissions: z.array(z.string()),
});

export const staffCategoriesSchema = z.object({
  categoryIds: z.array(idSchema),
});

export const categoryCreateSchema = z.object({
  name: z.string().min(2).max(60),
  description: z.string().max(300).optional(),
  iconUrl: z.string().url().optional(),
  sortOrder: z.coerce.number().int().min(0).optional(),
});

export const categoryUpdateSchema = categoryCreateSchema.partial();

export const roleSchema = z.object({ role: z.nativeEnum(UserRole) });
export const orderStatusSchema = z.object({ status: z.nativeEnum(OrderStatus) });
export const fulfilmentDecisionSchema = z.object({
  reason: z.string().trim().min(3).max(500).optional(),
  idempotencyKey: z.string().trim().min(8).max(100),
});
export const giftCreateSchema = z.object({
  productId: idSchema,
  recipientEmail: z.string().email(),
  quantity: z.coerce.number().int().positive().default(1),
  message: z.string().trim().max(500).optional(),
});
export const giftClaimSchema = z.object({ token: z.string().min(32) });
export const boothInventorySchema = z.object({ productIds: z.array(idSchema).max(500) });
export const deletionRequestSchema = z.object({ reason: z.string().trim().max(1000).optional() });
export const deletionUpdateSchema = z.object({
  status: z.enum(['identity_verified', 'cooling_off', 'approved', 'anonymized', 'cancelled']),
  assignedTo: idSchema.optional(),
});
export const checkoutEventSchema = z.object({
  sessionId: z.string().min(8).max(100),
  orderId: idSchema.optional(),
  event: z.enum(['payment_options_shown', 'payment_method_selected', 'checkout_abandoned', 'payment_initiated', 'payment_completed', 'refund_requested', 'order_cancelled', 'delivered']),
  paymentMode: z.nativeEnum(PaymentMode).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export const logisticsStatusSchema = z.object({ status: z.nativeEnum(LogisticsStatus) });
export const productReviewSchema = z.object({
  status: z.nativeEnum(ProductStatus),
  adjustedSellingPrice: z.coerce.number().positive().optional(),
});
export const vendorTierSchema = z.object({
  tier: z.nativeEnum(VendorTier).optional(),
  commissionPercentage: z.coerce.number().min(0).max(100).optional(),
});
export const settlementTriggerSchema = z.object({
  reason: z.string().optional(),
  idempotencyKey: z.string().optional(),
});
export const refundSchema = z.object({
  amount: z.coerce.number().positive(),
  reason: z.string().trim().min(3).max(500),
  idempotencyKey: z.string().trim().min(8).max(100),
});
export const customerRefundRequestSchema = z.object({
  reasonType: z.enum(['not_delivered', 'damaged', 'wrong_item', 'other']),
  reason: z.string().trim().min(10).max(1000),
  evidenceUrls: z.array(z.string().url()).max(8).default([]),
  amount: z.coerce.number().positive().optional(),
  idempotencyKey: z.string().trim().min(8).max(100),
});
export const adminRefundReviewSchema = z.object({
  status: z.enum(['under_review', 'rejected']),
  assignedSupportUserId: idSchema.optional(),
  decisionNote: z.string().trim().min(3).max(1000),
});
export const settingsSchema = z.record(z.string(), z.unknown());
export const reportSchema = z.object({ type: z.string().default('sales') });

export { NegotiationStatus, PaymentStatus };
