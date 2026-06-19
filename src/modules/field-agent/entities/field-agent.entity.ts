import { Entity, Column, ManyToOne, JoinColumn, OneToMany } from 'typeorm';
import { BaseEntity } from '@database/base.entity';
import { User } from '@modules/users/entities/user.entity';
import { Booth } from '@modules/booths/entities/booth.entity';

@Entity('field_agents')
export class FieldAgent extends BaseEntity {
  @ManyToOne(() => User)
  @JoinColumn({ name: 'agentId' })
  agent!: User;

  @Column()
  agentId!: string;

  @Column({ length: 200 })
  assignedMarket!: string; // e.g. "Balogun Market"

  @Column({ type: 'simple-json', nullable: true })
  coverageArea?: {
    lat: number;
    lng: number;
    radiusKm: number;
  };

  @Column({ default: true })
  isActive!: boolean;

  @Column({ type: 'simple-json', nullable: true })
  stats?: {
    productsUploaded: number;
    pendingApproval: number;
    approvedToday: number;
  };

  @OneToMany(() => Booth, (booth) => booth.fieldAgent)
  booths!: Booth[];
}

