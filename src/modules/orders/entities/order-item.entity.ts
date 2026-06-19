import { Entity, Column, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from '@database/base.entity';
import { Order } from './order.entity';
import { Product } from '@modules/products/entities/product.entity';
import { Vendor } from '@modules/vendors/entities/vendor.entity';

@Entity('order_items')
export class OrderItem extends BaseEntity {
  @ManyToOne(() => Order, (order) => order.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'orderId' })
  order!: Order;

  @Column()
  orderId!: string;

  @ManyToOne(() => Product)
  @JoinColumn({ name: 'productId' })
  product!: Product;

  @Column()
  productId!: string;

  @Column({ length: 100 })
  productTitle!: string; // Snapshot at order time

  @Column({ length: 255, nullable: true })
  productImage?: string;

  @ManyToOne(() => Vendor)
  @JoinColumn({ name: 'vendorId' })
  vendor!: Vendor;

  @Column()
  vendorId!: string;

  @Column()
  quantity!: number;

  @Column({ type: 'float' })
  unitPrice!: number;

  @Column({ type: 'float' })
  totalPrice!: number;

  @Column({ type: 'simple-json', nullable: true })
  selectedVariants?: { color?: string; size?: string };

  @Column({ type: 'float', default: 0 })
  commissionAmount!: number; // 15% of vendor's share
}

