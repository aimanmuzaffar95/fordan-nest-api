import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../users/entities/user.entity';

export const ORGANIZATION_PROFILE_SINGLETON_ID = 'global';

@Entity('organization_profile')
export class OrganizationProfile {
  @PrimaryColumn({ type: 'varchar', length: 32 })
  id: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  legalName: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  tradingName: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  registeredAddressLine1: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  registeredAddressLine2: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  city: string | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  state: string | null;

  @Column({ type: 'varchar', length: 30, nullable: true })
  postalCode: string | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  country: string | null;

  @Column({ type: 'boolean', default: true })
  billingSameAsRegistered: boolean;

  @Column({ type: 'varchar', length: 255, nullable: true })
  billingAddressLine1: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  billingAddressLine2: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  billingCity: string | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  billingState: string | null;

  @Column({ type: 'varchar', length: 30, nullable: true })
  billingPostalCode: string | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  billingCountry: string | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  taxIdPrimary: string | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  taxIdSecondary: string | null;

  @Column({ type: 'varchar', length: 8, default: 'AUD' })
  defaultCurrency: string;

  @Column({ type: 'varchar', length: 80, default: 'Australia/Sydney' })
  defaultTimezone: string;

  @Column({ type: 'varchar', length: 160, nullable: true })
  documentsContactName: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  documentsContactEmail: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  documentsContactPhone: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'updatedByUserId' })
  updatedByUser: User | null;

  @Column({ type: 'uuid', nullable: true })
  updatedByUserId: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
