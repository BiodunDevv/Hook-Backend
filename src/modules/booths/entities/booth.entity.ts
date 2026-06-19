import { Entity, Column, ManyToOne, JoinColumn, OneToMany, Index } from 'typeorm';
import { BaseEntity } from '@database/base.entity';
import { BoothType } from '@common/constants';
import { FieldAgent } from '@modules/field-agent/entities/field-agent.entity';
import { Product } from '@modules/products/entities/product.entity';

@Entity('booths')
@Index(['isActive', 'location'])
export class Booth extends BaseEntity {
  @Column({ length: 200 })
  name!: string;

  @Column({ length: 255, nullable: true })
  description?: string;

  @Column({
    type: 'varchar',
    default: BoothType.PHYGITAL,
  })
  boothType!: BoothType;

  @Column({ type: 'simple-json' })
  location!: {
    address: string;
    lat: number;
    lng: number;
  };

  @Column({ type: 'simple-json', nullable: true })
  operatingHours?: {
    weekday: { open: string; close: string };
    weekend?: { open: string; close: string };
  };

  @Column({ default: true })
  isActive!: boolean;

  // For inventory display in app
  @Column({ type: 'simple-json', default: '[]' })
  featuredProductIds!: string[];

  @Column({ nullable: true })
  previewImageUrl?: string;

  // === Relationships ===

  @ManyToOne(() => FieldAgent, (agent) => agent.booths)
  @JoinColumn({ name: 'fieldAgentId' })
  fieldAgent?: FieldAgent;

  @Column({ nullable: true })
  fieldAgentId?: string;

  @OneToMany(() => Product, (product) => product.vendor)
  products?: Product[];
}


