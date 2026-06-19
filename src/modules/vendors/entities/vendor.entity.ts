import { Entity, Column, ManyToOne, JoinColumn, OneToMany, Index } from 'typeorm';
import { BaseEntity } from '@database/base.entity';
import { ProductStatus, VendorTier } from '@common/constants';
import { User } from '@modules/users/entities/user.entity';
import { Product } from '@modules/products/entities/product.entity';
import { Settlement } from '@modules/settlements/entities/settlement.entity';

@Entity('vendors')
export class Vendor extends BaseEntity {
  @Column({ length: 200 })
  businessName!: string;

  @Column({ length: 255, nullable: true })
  businessEmail?: string;

  @Column({ length: 15, nullable: true })
  businessPhone?: string;

  @Column({ length: 255, nullable: true })
  businessAddress?: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ type: 'simple-json', nullable: true })
  socialLinks?: Record<string, string>;

  @Column({
    type: 'varchar',
    default: VendorTier.TIER_3,
  })
  tier!: VendorTier;

  @Column({ default: false })
  isApproved!: boolean;

  @Column({ nullable: true })
  approvedAt?: Date;

  @Column({ type: 'float', default: 15 })
  commissionPercentage!: number;

  // Payment integration
  @Column({ nullable: true })
  paystackSubaccountCode?: string;

  @Column({ nullable: true })
  nombaMerchantId?: string;

  @Column({ type: 'simple-json', nullable: true })
  bankDetails?: {
    bankName: string;
    accountNumber: string;
    accountName: string;
    bankCode: string;
  };

  // IMS integration
  @Column({ nullable: true })
  imsType?: string; // 'shopify' | 'custom_erp' | null

  @Column({ type: 'simple-json', nullable: true })
  imsConfig?: Record<string, unknown>;

  @Column({ default: true })
  isActive!: boolean;

  // === Relationships ===

  @ManyToOne(() => User, (user) => user.vendors)
  @JoinColumn({ name: 'ownerId' })
  owner!: User;

  @Column()
  ownerId!: string;

  @OneToMany(() => Product, (product) => product.vendor)
  products!: Product[];

  @OneToMany(() => Settlement, (settlement) => settlement.vendor)
  settlements!: Settlement[];
}


