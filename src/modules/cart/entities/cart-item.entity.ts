import { Entity, Column, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from '@database/base.entity';
import { Cart } from './cart.entity';
import { Product } from '@modules/products/entities/product.entity';

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

