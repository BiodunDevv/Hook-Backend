import { Entity, Column, OneToOne, ManyToOne, JoinColumn, Index } from 'typeorm';
import { BaseEntity } from '@database/base.entity';
import { PaymentStatus } from '@common/constants';
import { Order } from '@modules/orders/entities/order.entity';

@Entity('payments')
export class Payment extends BaseEntity {
  @OneToOne(() => Order, (order) => order.payment)
  @JoinColumn({ name: 'orderId' })
  order!: Order;

  @Column()
  orderId!: string;

  @Column({ length: 20, unique: true })
  transactionRef!: string; // Our internal reference

  @Column({ length: 100, nullable: true })
  gatewayRef?: string; // Paystack/Nomba reference

  @Column({ length: 50 })
  gateway!: 'paystack' | 'nomba';

  @Column({ length: 50 })
  paymentMethod!: 'card' | 'bank_transfer' | 'ussd';

  @Column({ type: 'float' })
  amount!: number;

  @Column({ type: 'float', default: 0 })
  gatewayFee!: number;

  @Column({ type: 'float', default: 0 })
  amountSettled!: number;

  @Column({
    type: 'varchar',
    default: PaymentStatus.PENDING,
  })
  status!: PaymentStatus;

  @Column({ type: 'simple-json', nullable: true })
  gatewayResponse?: Record<string, unknown>;

  @Column({ nullable: true })
  paidAt?: Date;

  @Column({ type: 'simple-json', nullable: true })
  splitData?: {
    hookShare: number;
    vendorShare: number;
    deliveryFee: number;
    commission: number;
  };

  @Column({ nullable: true })
  refundedAt?: Date;

  @Column({ type: 'float', default: 0 })
  refundedAmount!: number;
}


