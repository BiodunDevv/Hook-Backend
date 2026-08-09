import { BaseEntity, createModel, createSchema } from "@models/base.model";

export interface OrderFulfilmentGroup extends BaseEntity {
  publicId: string;
  orderId: string;
  sourceStateId: string;
  hubId?: string;
  orderItemIds: string[];
  subtotalMinor: number;
  deliveryFeeShareMinor: number;
  status: "PENDING" | "IN_FULFILMENT" | "READY_FOR_DISPATCH" | "IN_TRANSIT" | "DELIVERED" | "COMPLETED" | "ON_HOLD";
  paymentId?: string;
  consolidationId?: string;
  shipmentId?: string;
}

const schema = createSchema<OrderFulfilmentGroup>({
  publicId: { type: String, required: true, unique: true, index: true },
  orderId: { type: String, required: true, index: true },
  sourceStateId: { type: String, required: true, index: true },
  hubId: { type: String, index: true, sparse: true },
  orderItemIds: { type: [String], default: [] },
  subtotalMinor: { type: Number, required: true, min: 0 },
  deliveryFeeShareMinor: { type: Number, required: true, min: 0 },
  status: {
    type: String,
    enum: ["PENDING", "IN_FULFILMENT", "READY_FOR_DISPATCH", "IN_TRANSIT", "DELIVERED", "COMPLETED", "ON_HOLD"],
    default: "PENDING",
    index: true,
  },
  paymentId: { type: String, index: true, sparse: true },
  consolidationId: { type: String, index: true, sparse: true },
  shipmentId: { type: String, index: true, sparse: true },
  deletedAt: { type: Date },
});

schema.index({ orderId: 1, sourceStateId: 1 }, { unique: true });

export const OrderFulfilmentGroup = createModel<OrderFulfilmentGroup>(
  "OrderFulfilmentGroup",
  schema,
);
