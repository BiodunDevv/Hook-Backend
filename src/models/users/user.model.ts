import {
  Entity,
  Column,
  OneToMany,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { BaseEntity } from '@models/base.model';
import { UserRole, VendorTier } from '@lib/constants';
import { Product } from '@models/products/product.model';
import { Order } from '@models/orders/order.model';
import { Cart } from '@models/cart/cart.model';
import { Negotiation } from '@models/negotiations/negotiation.model';
import { Vendor } from '@models/vendors/vendor.model';
import { FieldAgent } from '@models/field-agents/field-agent.model';

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


