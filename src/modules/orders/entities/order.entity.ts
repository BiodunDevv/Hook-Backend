import { Entity, Column, ManyToOne, OneToMany, OneToOne, JoinColumn, Index } from 'typeorm';
import { BaseEntity } from '@database/base.entity';
import { OrderStatus, PaymentStatus } from '@common/constants';
import { User } from '@modules/users/entities/user.entity';
import { OrderItem } from './order-item.entity';
import { Payment } from '@modules/payments/entities/payment.entity';
import { Logistics } from '@modules/logistics/entities/logistics.entity';

@Entity('orders')
@Index(['userId', 'status'])
@Index(['orderCode'], { unique: true })
export class Order extends BaseEntity {
  @Column({ length: 20, unique: true })
  orderCode!: string; // Human-readable order code

  @ManyToOne(() => User, (user) => user.orders)
  @JoinColumn({ name: 'userId' })
  user!: User;

  @Column()
  userId!: string;

  @OneToMany(() => OrderItem, (item) => item.order, { cascade: true })
  items!: OrderItem[];

  @OneToOne(() => Payment, (payment) => payment.order)
  payment!: Payment;

  @OneToOne(() => Logistics, (logistics) => logistics.order)
  logistics!: Logistics;

  // Financials
  @Column({ type: 'float' })
  subtotal!: number;

  @Column({ type: 'float', default: 0 })
  deliveryFee!: number;

  @Column({ type: 'float', default: 0 })
  discount!: number;

  @Column({ type: 'float' })
  total!: number;

  // Vendor tracking
  @Column({ default: 0 })
  vendorCount!: number; // Number of vendors involved (cross-store)

  @Column({
    type: 'varchar',
    default: OrderStatus.PENDING,
  })
  status!: OrderStatus;

  @Column({
    type: 'varchar',
    default: PaymentStatus.UNPAID,
  })
  paymentStatus!: PaymentStatus;

  // Delivery
  @Column({ type: 'simple-json' })
  deliveryAddress!: {
    street: string;
    city: string;
    state: string;
    landmark?: string;
    coordinates?: { lat: number; lng: number };
    phone: string;
  };

  @Column({ nullable: true })
  deliveryNotes?: string;

  @Column({ nullable: true })
  scheduledDeliveryAt?: Date;

  @Column({ nullable: true })
  deliveredAt?: Date;

  @Column({ nullable: true })
  cancelledAt?: Date;

  @Column({ type: 'text', nullable: true })
  cancellationReason?: string;
}


