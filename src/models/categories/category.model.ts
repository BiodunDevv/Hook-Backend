import { Entity, Column, OneToMany, ManyToOne, JoinColumn, Index } from 'typeorm';
import { BaseEntity } from '@models/base.model';
import { Product } from '@models/products/product.model';

@Entity('categories')
export class Category extends BaseEntity {
  @Column({ length: 100, unique: true })
  name!: string;

  @Column({ length: 100, unique: true })
  slug!: string;

  @Column({ length: 255, nullable: true })
  iconUrl?: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ default: 0 })
  sortOrder!: number;

  @Column({ default: true })
  isActive!: boolean;

  // === Self-referencing hierarchy ===
  @ManyToOne(() => Category, (cat) => cat.children, { nullable: true })
  @JoinColumn({ name: 'parentId' })
  parent?: Category;

  @Column({ nullable: true })
  parentId?: string;

  @OneToMany(() => Category, (cat) => cat.parent)
  children!: Category[];

  @OneToMany(() => Product, (product) => product.category)
  products!: Product[];
}
