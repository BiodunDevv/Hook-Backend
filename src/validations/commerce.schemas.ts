import { z } from "zod";
import { CommercePaymentMethod, DeliveryMethod } from "@lib/constants";

const publicId = z.string().trim().min(3).max(40);
const phone = z
  .string()
  .trim()
  .regex(/^\+?[0-9 ()-]{7,24}$/);

export const addressCreateSchema = z
  .object({
    label: z.string().trim().min(1).max(60),
    recipientName: z.string().trim().min(2).max(120),
    phone,
    line1: z.string().trim().min(4).max(240),
    line2: z.string().trim().max(240).optional(),
    landmark: z.string().trim().max(240).optional(),
    stateId: publicId,
    cityId: publicId,
    zoneId: publicId,
    postalCode: z.string().trim().max(20).optional(),
    coordinates: z
      .object({
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
      })
      .optional(),
    isDefault: z.boolean().optional(),
  })
  .strict();
export const addressUpdateSchema = addressCreateSchema
  .partial()
  .refine(
    (value) => Object.keys(value).length > 0,
    "At least one field is required",
  );

export const commerceCartItemSchema = z
  .object({
    productId: publicId,
    quantity: z.coerce.number().int().min(1).max(99),
    variantId: publicId.optional(),
    quoteId: publicId.optional(),
    selectedVariants: z
      .object({
        color: z.string().trim().max(80).optional(),
        size: z.string().trim().max(80).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const checkoutPreviewSchema = z
  .object({
    addressId: publicId.optional(),
    deliveryMethod: z.nativeEnum(DeliveryMethod),
    paymentMethod: z.nativeEnum(CommercePaymentMethod),
    policyVersions: z
      .object({
        TERMS: z.string().min(1),
        PRIVACY: z.string().min(1),
        RETURNS: z.string().min(1),
      })
      .strict(),
  })
  .strict();

export const checkoutConfirmSchema = z
  .object({ previewToken: z.string().min(40).max(300) })
  .strict();
export const paymentInitializeV4Schema = z
  .object({ orderId: publicId })
  .strict();

export const podCallSchema = z
  .object({
    outcome: z.enum(["CONFIRMED", "NO_ANSWER", "DECLINED", "INVALID_CONTACT"]),
    notes: z.string().trim().max(1000).optional(),
  })
  .strict();
export const podDecisionSchema = z
  .object({
    decision: z.enum(["APPROVE", "PREPAYMENT_REQUIRED", "CANCELLED"]),
    reason: z.string().trim().min(5).max(1000),
  })
  .strict();
export const podOverrideSchema = z
  .object({ reason: z.string().trim().min(10).max(1000) })
  .strict();
export const commerceSettingsSchema = z
  .object({
    defaultDeliveryFeeMinor: z.number().int().min(0).optional(),
    podEnabled: z.boolean().optional(),
    defaultPodLimitMinor: z.number().int().min(0).optional(),
    previewTtlMinutes: z.number().int().min(2).max(30).optional(),
  })
  .strict();
