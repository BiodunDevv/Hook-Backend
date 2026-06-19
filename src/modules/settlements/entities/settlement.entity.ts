import { Entity, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { BaseEntity } from '@database/base.entity';
import { SettlementStatus } from '@common/constants';
import { Vendor } from '@modules/vendors/entities/vendor.entity';
import { Order } from '@modules/orders/entities/order.entity';

@Entity('settlements')
@Index(['vendorId', 'status'])
@Index(['orderId'])
export class Settlement extends BaseEntity {
  @ManyToOne(() => Vendor, (vendor) => vendor.settlements)
  @JoinColumn({ name: 'vendorId' })
  vendor!: Vendor;

  @Column()
  vendorId!: string;

  @ManyToOne(() => Order)
  @JoinColumn({ name: 'orderId' })
  order!: Order;

  @Column()
  orderId!: string;

  @Column({ length: 50, unique: true, nullable: true })
  settlementRef?: string;

  // Financial breakdown
  @Column({ type: 'float' })
  itemTotal!: number;

  @Column({ type: 'float' })
  commissionAmount!: number; // Hook's 15%

  @Column({ type: 'float' })
  netAmount!: number; // What vendor gets

  @Column({ type: 'float' })
  deliveryFeePortion!: number;

  @Column({
    type: 'varchar',
    default: SettlementStatus.PENDING_ESCROW,
  })
  status!: SettlementStatus;

  // Escrow
  @Column({ type: 'datetime' })
  escrowReleaseAt!: Date; // 24h post-delivery

  @Column({ nullable: true })
  escrowReleasedAt?: Date;

  @Column({ nullable: true })
  paidAt?: Date;

  @Column({ length: 100, nullable: true })
  gatewayTransferRef?: string; // Paystack/Nomba transfer ref

  @Column({ type: 'text', nullable: true })
  notes?: string;
}


