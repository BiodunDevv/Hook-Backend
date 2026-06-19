import { Entity, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { BaseEntity } from '@database/base.entity';
import { NegotiationStatus } from '@common/constants';
import { User } from '@modules/users/entities/user.entity';
import { Product } from '@modules/products/entities/product.entity';

@Entity('negotiations')
@Index(['userId', 'productId', 'status'])
export class Negotiation extends BaseEntity {
  @ManyToOne(() => User, (user) => user.negotiations)
  @JoinColumn({ name: 'userId' })
  user!: User;

  @Column()
  userId!: string;

  @ManyToOne(() => Product, (product) => product.negotiations)
  @JoinColumn({ name: 'productId' })
  product!: Product;

  @Column()
  productId!: string;

  // Session tracking
  @Column({ type: 'int', default: 1 })
  round!: number;

  @Column({ type: 'float' })
  offeredPrice!: number;

  @Column({ type: 'float' })
  counterPrice!: number; // AI-generated counter

  @Column({ type: 'float', nullable: true })
  acceptedPrice?: number;

  @Column({
    type: 'varchar',
    default: NegotiationStatus.ACTIVE,
  })
  status!: NegotiationStatus;

  // Margins at time of negotiation
  @Column({ type: 'float' })
  costPrice!: number; // Snapshot

  @Column({ type: 'float' })
  sellingPrice!: number; // Snapshot

  @Column({ type: 'float' })
  minAcceptablePrice!: number; // Snapshot

  @Column({ type: 'simple-json', default: '[]' })
  messageHistory!: Array<{
    role: 'user' | 'bot';
    message: string;
    price?: number;
    timestamp: string;
  }>;

  @Column({ nullable: true })
  expiredAt?: Date;

  @Column({ nullable: true })
  acceptedAt?: Date;

  @Column({ type: 'text', nullable: true })
  declineReason?: string;
}


