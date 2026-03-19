import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Customer } from '../../customers/entities/customer.entity';

@Entity('jobs')
export class Job {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Customer, { nullable: false })
  customer: Customer;

  @Column({ type: 'uuid' })
  customerId: string;

  // Frontend expects: 'solar' | 'battery' | 'both'
  @Column({ type: 'varchar', length: 10 })
  systemType: string;

  @Column({ type: 'numeric', precision: 12, scale: 2 })
  projectPrice: string;

  @Column({ type: 'boolean', default: false })
  contractSigned: boolean;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 })
  depositAmount: string;

  // Useful for future invoice rules (deposit paid vs not)
  @Column({ type: 'boolean', default: false })
  depositPaid: boolean;

  @Column({ type: 'date', nullable: true })
  depositDate: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
