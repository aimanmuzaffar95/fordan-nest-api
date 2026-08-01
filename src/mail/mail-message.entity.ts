import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { LinkedMailbox } from './linked-mailbox.entity';

/**
 * Locally synced copy of an IMAP message (summary + optionally full body).
 * Populated by MailSyncService; read endpoints serve from this table so mail
 * stays readable when the mail host throttles or is down. bodyHtml is
 * sanitized at ingest — never store raw remote HTML.
 */
@Entity('mail_messages')
@Unique('UQ_mail_msg_box_folder_uid', ['mailboxId', 'folder', 'uid'])
@Index('idx_mail_msg_box_folder_date', ['mailboxId', 'folder', 'date'])
export class MailMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  mailboxId: string;

  @ManyToOne(() => LinkedMailbox, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'mailboxId' })
  mailbox: LinkedMailbox;

  @Column({ type: 'varchar', length: 128 })
  folder: string;

  @Column({ type: 'int' })
  uid: number;

  @Column({ type: 'text' })
  subject: string;

  @Column({ type: 'varchar', length: 255, default: '' })
  fromName: string;

  @Column({ type: 'varchar', length: 320, default: '' })
  fromAddress: string;

  @Column({ type: 'json', nullable: true })
  toJson: string[] | null;

  @Column({ type: 'json', nullable: true })
  ccJson: string[] | null;

  @Column({ type: 'timestamp', nullable: true })
  date: Date | null;

  @Column({ type: 'boolean', default: false })
  seen: boolean;

  @Column({ type: 'boolean', default: false })
  hasAttachments: boolean;

  @Column({ type: 'varchar', length: 500, default: '' })
  snippet: string;

  // Sanitized at ingest (sanitize-html conservative allowlist).
  @Column({ type: 'longtext', nullable: true })
  bodyHtml: string | null;

  @Column({ type: 'text', nullable: true })
  bodyText: string | null;

  @Column({ type: 'json', nullable: true })
  attachmentsJson:
    | { filename: string; size: number; contentType: string }[]
    | null;

  @Column({ type: 'timestamp' })
  syncedAt: Date;
}
