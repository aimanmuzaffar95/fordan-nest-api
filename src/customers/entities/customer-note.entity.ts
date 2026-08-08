import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { resolveLongTextColumnType } from '../../common/timestamp-column-type.util';
import { User } from '../../users/entities/user.entity';
import { Customer } from './customer.entity';

/**
 * A free-text note on a customer record — dispatcher-facing context ("gate
 * code is 925", "beware of dog") that belongs to the customer, not to any one
 * job. Deliberately separate from the job-scoped `Note` entity
 * (`../../notes/entities/note.entity.ts`), which is unmodified by this table.
 *
 * Follows the `project_notes` shape: append-only per row, author is always
 * the authenticated principal (`createdByUserId`), never client-supplied
 * text.
 */
@Entity('customer_notes')
@Index('idx_customer_notes_customer', ['customerId'])
export class CustomerNote {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Customer, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'customerId' })
  customer: Customer;

  @Column({ type: 'uuid' })
  customerId: string;

  @Column({ type: resolveLongTextColumnType() })
  body: string;

  /**
   * Surfaces this note at the top of the list ahead of others. Small enough
   * to add now rather than as a follow-up migration.
   */
  @Column({ type: 'boolean', default: false })
  pinned: boolean;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'createdByUserId' })
  createdByUser: User | null;

  @Column({ type: 'uuid', nullable: true })
  createdByUserId: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
