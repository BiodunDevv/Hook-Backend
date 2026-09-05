import { BaseEntity, createModel, createSchema } from "@models/base.model";

export interface CommerceImport extends BaseEntity {
  customerId: string;
  idempotencyKey: string;
  payloadHash: string;
  response: Record<string, unknown>;
}

const schema = createSchema<CommerceImport>({
  customerId: { type: String, required: true, index: true },
  idempotencyKey: { type: String, required: true },
  payloadHash: { type: String, required: true },
  response: { type: Object, required: true },
  deletedAt: { type: Date },
});

schema.index({ customerId: 1, idempotencyKey: 1 }, { unique: true });

export const CommerceImport = createModel<CommerceImport>(
  "CommerceImport",
  schema,
);
