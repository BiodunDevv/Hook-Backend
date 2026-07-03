import {
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';
import { dateTimeColumnType } from './column-types';

export abstract class BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @CreateDateColumn({ type: dateTimeColumnType, default: () => 'CURRENT_TIMESTAMP' })
  createdAt!: Date;

  @UpdateDateColumn({ type: dateTimeColumnType, default: () => 'CURRENT_TIMESTAMP' })
  updatedAt!: Date;

  @DeleteDateColumn({ type: dateTimeColumnType, nullable: true })
  deletedAt?: Date;
}
