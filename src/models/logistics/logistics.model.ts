import { LogisticsStatus } from '@lib/constants';
import { BaseEntity, createModel, createSchema } from '@models/base.model';

export interface Logistics extends BaseEntity {
  orderId: string;
  driverId?: string;
  status: LogisticsStatus;
  pickupLocation?: { name: string; address: string; coordinates: { lat: number; lng: number }; notes?: string };
  pickedUpAt?: Date;
  qrCodeRef?: string;
  qrScannedAt?: Date;
  vendorOtp?: string;
  otpVerifiedAt?: Date;
  deliveryLocation?: { address: string; coordinates: { lat: number; lng: number }; instructions?: string };
  deliveredAt?: Date;
  deliveryProof?: string;
  trackingPath?: Array<{ lat: number; lng: number; timestamp: string }>;
  estimatedDeliveryAt?: Date;
  estimatedDistanceKm?: number;
  order?: any;
  driver?: any;
}

const LogisticsSchema = createSchema<Logistics>({
  orderId: { type: String, required: true, unique: true, index: true },
  driverId: { type: String, index: true },
  status: { type: String, enum: Object.values(LogisticsStatus), default: LogisticsStatus.ASSIGNED, index: true },
  pickupLocation: { type: Object },
  pickedUpAt: { type: Date },
  qrCodeRef: { type: String },
  qrScannedAt: { type: Date },
  vendorOtp: { type: String },
  otpVerifiedAt: { type: Date },
  deliveryLocation: { type: Object },
  deliveredAt: { type: Date },
  deliveryProof: { type: String },
  trackingPath: [{ type: Object }],
  estimatedDeliveryAt: { type: Date },
  estimatedDistanceKm: { type: Number },
  deletedAt: { type: Date },
});

LogisticsSchema.index({ driverId: 1, status: 1 });

export const Logistics = createModel<Logistics>('Logistics', LogisticsSchema);
