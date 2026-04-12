import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Customer } from './customer.entity';

@Entity('customer_audit_logs')
export class CustomerAuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Customer, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'customerId' })
  customer: Customer;

  @Column({ type: 'uuid' })
  customerId: string;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'performedByUserId' })
  performedByUser: User | null;

  @Column({ type: 'uuid', nullable: true })
  performedByUserId: string | null;

  @Column({ type: 'varchar', length: 100 })
  eventType: string;

  @Column({ type: 'json', nullable: true })
  payload: unknown;

  @CreateDateColumn()
  createdAt: Date;
}
