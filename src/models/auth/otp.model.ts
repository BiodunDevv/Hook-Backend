import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from '@models/base.model';
import { dateTimeColumnType } from '@models/column-types';

@Entity('otps')
@Index(['email', 'code'])
export class Otp extends BaseEntity {
  @Column({ length: 255 })
  email!: string;

  @Column({ length: 6 })
  code!: string;

  @Column({ length: 50, default: 'email_verification' })
  type!: 'email_verification' | 'password_reset' | 'phone_verification';

  @Column({ default: false })
  isUsed!: boolean;

  @Column({ type: dateTimeColumnType })
  expiresAt!: Date;

  get isValid(): boolean {
    return !this.isUsed && new Date() < this.expiresAt;
  }
}
