import { Entity, Column, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from '@models/base.model';
import { Cart } from './cart.model';
import { Product } from '@models/products/product.model';

@Entity('cart_items')
export class CartItem extends BaseEntity {
  @ManyToOne(() => Cart, (cart) => cart.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'cartId' })
  cart!: Cart;

  @Column()
  cartId!: string;

  @ManyToOne(() => Product)
  @JoinColumn({ name: 'productId' })
  product!: Product;

  @Column()
  productId!: string;

  @Column()
  quantity!: number;

  @Column({ type: 'float' })
  unitPrice!: number;

  @Column({ type: 'float' })
  totalPrice!: number;

  @Column({ type: 'simple-json', nullable: true })
  selectedVariants?: { color?: string; size?: string };
}

