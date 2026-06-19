import { Entity, Column, OneToOne, ManyToOne, JoinColumn, Index } from 'typeorm';
import { BaseEntity } from '@database/base.entity';
import { LogisticsStatus } from '@common/constants';
import { Order } from '@modules/orders/entities/order.entity';
import { User } from '@modules/users/entities/user.entity';

@Entity('logistics')
@Index(['driverId', 'status'])
@Index(['orderId'], { unique: true })
export class Logistics extends BaseEntity {
  @OneToOne(() => Order, (order) => order.logistics)
  @JoinColumn({ name: 'orderId' })
  order!: Order;

  @Column()
  orderId!: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'driverId' })
  driver!: User;

  @Column({ nullable: true })
  driverId?: string;

  @Column({
    type: 'varchar',
    default: LogisticsStatus.ASSIGNED,
  })
  status!: LogisticsStatus;

  // Pickup
  @Column({ type: 'simple-json', nullable: true })
  pickupLocation?: {
    name: string;
    address: string;
    coordinates: { lat: number; lng: number };
    notes?: string;
  };

  @Column({ nullable: true })
  pickedUpAt?: Date;

  // Pack-and-Tag
  @Column({ nullable: true })
  qrCodeRef?: string; // HK-XXXXXX-000001

  @Column({ nullable: true })
  qrScannedAt?: Date;

  // OTP handshake
  @Column({ nullable: true })
  vendorOtp?: string;

  @Column({ nullable: true })
  otpVerifiedAt?: Date;

  // Delivery
  @Column({ type: 'simple-json', nullable: true })
  deliveryLocation?: {
    address: string;
    coordinates: { lat: number; lng: number };
    instructions?: string;
  };

  @Column({ nullable: true })
  deliveredAt?: Date;

  @Column({ type: 'text', nullable: true })
  deliveryProof?: string; // Base64 signature or photo ref

  // Realtime tracking
  @Column({ type: 'simple-json', nullable: true })
  trackingPath?: Array<{
    lat: number;
    lng: number;
    timestamp: string;
  }>;

  @Column({ nullable: true })
  estimatedDeliveryAt?: Date;

  @Column({ nullable: true })
  estimatedDistanceKm?: number;
}


