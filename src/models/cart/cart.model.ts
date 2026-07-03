import { Entity, Column, OneToOne, OneToMany, JoinColumn } from 'typeorm';
import { BaseEntity } from '@models/base.model';
import { User } from '@models/users/user.model';
import { CartItem } from './cart-item.model';

@Entity('carts')
export class Cart extends BaseEntity {
  @OneToOne(() => User, (user) => user.cart)
  @JoinColumn({ name: 'userId' })
  user!: User;

  @Column()
  userId!: string;

  @OneToMany(() => CartItem, (item) => item.cart, { cascade: true })
  items!: CartItem[];

  @Column({ type: 'float', default: 0 })
  subtotal!: number;

  @Column({ type: 'float', default: 0 })
  deliveryFee!: number;

  @Column({ type: 'float', default: 0 })
  total!: number;

  @Column({ default: false })
  isCheckedOut!: boolean;
}
