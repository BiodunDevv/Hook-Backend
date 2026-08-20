import { z } from 'zod';

export const itemVerifySchema = z.object({
  photoUrl: z.string().url(),
  photoAssetId: z.string().trim().max(200).optional(),
  checks: z.object({
    productMatches: z.boolean(),
    sizeMatches: z.boolean(),
    colorMatches: z.boolean(),
    quantityMatches: z.boolean(),
  }),
}).strict();
