import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { resolveLongTextColumnType } from '../common/timestamp-column-type.util';

export type MailOutboxStatus = 'queued' | 'sending' | 'sent' | 'failed';

/**
 * Durable send queue. A POST /mail/send inserts a row here and attempts one
 * immediate delivery; a background worker retries transient failures with
 * exponential backoff so mail survives flaky shared-host SMTP and app closure.
 */
@Entity('mail_outbox')
export class MailOutbox {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('idx_mail_outbox_mailbox')
  @Column({ type: 'uuid' })
  mailboxId: string;

  @Column({ type: 'uuid' })
  userId: string;

  // Recipient / cc address arrays, as submitted.
  @Column({ type: 'json' })
  toJson: string[];

  @Column({ type: 'json', nullable: true })
  ccJson: string[] | null;

  @Column({ type: 'text' })
  subject: string;

  // longtext under MySQL/MariaDB, text on Postgres (see migration) — bodies
  // can be large.
  @Column({ type: resolveLongTextColumnType() })
  bodyHtml: string;

  @Column({ type: 'boolean', default: true })
  appendSignature: boolean;

  // Outbound attachments as submitted (base64), stored so they survive retries.
  // json on Postgres, longtext under MySQL/MariaDB (see migration).
  @Column({ type: 'json', nullable: true })
  attachmentsJson:
    | { filename: string; contentType: string; contentBase64: string }[]
    | null;

  // Informational only in v1 — no threading headers are emitted.
  @Column({ type: 'int', nullable: true })
  inReplyToUid: number | null;

  @Index('idx_mail_outbox_status_next')
  @Column({ type: 'varchar', length: 16, default: 'queued' })
  status: MailOutboxStatus;

  @Column({ type: 'int', default: 0 })
  attempts: number;

  @Column({ type: 'int', default: 6 })
  maxAttempts: number;

  @Column({ type: 'varchar', length: 500, nullable: true })
  lastError: string | null;

  @Column({ type: 'timestamp', nullable: true })
  nextAttemptAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  sentAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
