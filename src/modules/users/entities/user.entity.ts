import {
  Entity,
  Column,
  OneToMany,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { BaseEntity } from '@database/base.entity';
import { UserRole, VendorTier } from '@common/constants';
import { Product } from '@modules/products/entities/product.entity';
import { Order } from '@modules/orders/entities/order.entity';
import { Cart } from '@modules/cart/entities/cart.entity';
import { Negotiation } from '@modules/negotiation/entities/negotiation.entity';
import { Vendor } from '@modules/vendors/entities/vendor.entity';
import { FieldAgent } from '@modules/field-agent/entities/field-agent.entity';

@Entity('users')
export class User extends BaseEntity {
  @Column({ unique: true, length: 255 })
  email!: string;

  @Column({ length: 15, unique: true, nullable: true })
  phone?: string;

  @Column({ nullable: true })
  password?: string;

  @Column({ length: 100 })
  firstName!: string;

  @Column({ length: 100 })
  lastName!: string;

  @Column({
    type: 'varchar',
    default: UserRole.SHOPPER,
  })
  role!: UserRole;

  @Column({ default: false })
  isEmailVerified!: boolean;

  @Column({ default: false })
  isPhoneVerified!: boolean;

  @Column({ nullable: true })
  avatarUrl?: string;

  @Column({ type: 'simple-json', nullable: true })
  address?: Record<string, unknown>;

  @Column({ type: 'simple-json', nullable: true })
  preferences?: Record<string, unknown>;

  @Column({ default: true })
  isActive!: boolean;

  @Column({ nullable: true })
  lastLoginAt?: Date;

  @Column({ nullable: true })
  refreshToken?: string;

  // === Relationships ===

  @OneToMany(() => Cart, (cart) => cart.user)
  cart!: Cart[];

  @OneToMany(() => Order, (order) => order.user)
  orders!: Order[];

  @OneToMany(() => Negotiation, (neg) => neg.user)
  negotiations!: Negotiation[];

  @OneToMany(() => Vendor, (vendor) => vendor.owner)
  vendors!: Vendor[];
}


