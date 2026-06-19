import { Entity, Column, ManyToOne, JoinColumn, OneToMany, Index } from 'typeorm';
import { BaseEntity } from '@database/base.entity';
import { ProductStatus } from '@common/constants';
import { Vendor } from '@modules/vendors/entities/vendor.entity';
import { Category } from '@modules/categories/entities/category.entity';
import { CartItem } from '@modules/cart/entities/cart-item.entity';
import { OrderItem } from '@modules/orders/entities/order-item.entity';
import { Negotiation } from '@modules/negotiation/entities/negotiation.entity';

@Entity('products')
@Index(['vendorId', 'status'])
@Index(['categoryId'])
@Index(['slug'], { unique: true })
export class Product extends BaseEntity {
  @Column({ length: 255 })
  title!: string;

  @Column({ length: 255, unique: true })
  slug!: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  // Pricing
  @Column({ type: 'float' })
  costPrice!: number; // What Hook's runner pays at market

  @Column({ type: 'float' })
  sellingPrice!: number; // Listed retail price

  @Column({ type: 'float', nullable: true })
  discountedPrice?: number; // Promotional price

  @Column({ type: 'float' })
  minAcceptablePrice!: number; // Floor for AI negotiation

  // Inventory
  @Column({ default: 0 })
  quantity!: number;

  @Column({ default: 0 })
  reservedQuantity!: number;

  // Variants
  @Column({ type: 'simple-json', nullable: true })
  colors?: string[];

  @Column({ type: 'simple-json', nullable: true })
  sizes?: string[];

  // Media
  @Column({ type: 'simple-json', default: '[]' })
  images!: string[];

  @Column({ type: 'simple-json', nullable: true })
  videos?: string[];

  // Hook ID (HID) for market tracking
  @Column({ length: 20, nullable: true, unique: true })
  hookId?: string; // e.g. BAL-SHK-089

  // Status
  @Column({
    type: 'varchar',
    default: ProductStatus.DRAFT,
  })
  status!: ProductStatus;

  @Column({ type: 'int', default: 0 })
  viewCount!: number;

  @Column({ type: 'int', default: 0 })
  orderCount!: number;

  @Column({ type: 'float', default: 0 })
  averageRating!: number;

  // === Relationships ===

  @ManyToOne(() => Vendor, (vendor) => vendor.products)
  @JoinColumn({ name: 'vendorId' })
  vendor!: Vendor;

  @Column()
  vendorId!: string;

  @ManyToOne(() => Category, (cat) => cat.products)
  @JoinColumn({ name: 'categoryId' })
  category!: Category;

  @Column()
  categoryId!: string;

  @OneToMany(() => CartItem, (ci) => ci.product)
  cartItems!: CartItem[];

  @OneToMany(() => OrderItem, (oi) => oi.product)
  orderItems!: OrderItem[];

  @OneToMany(() => Negotiation, (neg) => neg.product)
  negotiations!: Negotiation[];
}


