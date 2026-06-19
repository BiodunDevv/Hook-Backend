import { Entity, Column, OneToOne, OneToMany, JoinColumn } from 'typeorm';
import { BaseEntity } from '@database/base.entity';
import { User } from '@modules/users/entities/user.entity';
import { CartItem } from './cart-item.entity';

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
