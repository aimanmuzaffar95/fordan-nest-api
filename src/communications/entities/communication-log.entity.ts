import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { resolveTimestampColumnType } from '../../common/timestamp-column-type.util';

export enum CommunicationChannel {
  SMS = 'sms',
  CALL = 'call',
  /** Manually logged in-person conversation. */
  MEETING = 'meeting',
  /** Logged here only when it happened outside the mailbox system. */
  EMAIL = 'email',
}

export enum CommunicationDirection {
  INBOUND = 'inbound',
  OUTBOUND = 'outbound',
}

export enum CommunicationStatus {
  /** Handed to the provider; no delivery confirmation yet. */
  QUEUED = 'queued',
  SENT = 'sent',
  DELIVERED = 'delivered',
  FAILED = 'failed',
  /** Calls: connected and completed. */
  COMPLETED = 'completed',
  NO_ANSWER = 'no_answer',
  /** Inbound record with nothing to deliver. */
  RECEIVED = 'received',
}

/**
 * SMS, calls and manually-logged conversations, feeding the unified customer
 * timeline (PRD v2 Phase 4).
 *
 * Email stays in the existing mailbox system; this table is for the channels
 * that had nowhere to live, so the timeline stops being email-only.
 */
@Entity('communication_logs')
@Index('idx_comm_logs_customer', ['customerId'])
@Index('idx_comm_logs_job', ['jobId'])
@Index('idx_comm_logs_occurred', ['occurredAt'])
export class CommunicationLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  customerId: string;

  @Column({ type: 'uuid', nullable: true })
  jobId: string | null;

  @Column({ type: 'varchar', length: 20 })
  channel: CommunicationChannel;

  @Column({ type: 'varchar', length: 10 })
  direction: CommunicationDirection;

  @Column({ type: 'varchar', length: 20, default: CommunicationStatus.QUEUED })
  status: CommunicationStatus;

  /** The number or address on the customer's side. */
  @Column({ type: 'varchar', length: 320, nullable: true })
  counterparty: string | null;

  /** SMS body, call summary, or meeting notes. */
  @Column({ type: 'text', nullable: true })
  body: string | null;

  /** Call length in seconds. */
  @Column({ type: 'int', nullable: true })
  durationSeconds: number | null;

  /** Provider's message/call id, for reconciliation and webhooks. */
  @Column({ type: 'varchar', length: 120, nullable: true })
  externalId: string | null;

  @Column({ type: 'varchar', length: 60, nullable: true })
  providerName: string | null;

  /** Why a send failed — kept so a retry decision can be made. */
  @Column({ type: 'varchar', length: 200, nullable: true })
  failureReason: string | null;

  /** When the communication actually happened, not when it was recorded. */
  @Column({ type: resolveTimestampColumnType() })
  occurredAt: Date;

  /** The staff member on our side. */
  @Column({ type: 'uuid', nullable: true })
  staffUserId: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
