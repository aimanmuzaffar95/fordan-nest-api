import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * A real cPanel-hosted mailbox linked to one CRM user. Admin links it under
 * Settings; the user then reads/sends mail live over IMAP/SMTP (no local mail
 * store). The mailbox password is stored encrypted with the same
 * SETTINGS_ENCRYPTION_KEY AES-GCM helper runtime-settings uses for smtpPass.
 */
@Entity('linked_mailboxes')
export class LinkedMailbox {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('idx_linked_mailboxes_user', { unique: true })
  @Column({ type: 'uuid' })
  userId: string;

  @Column({ type: 'varchar', length: 255 })
  emailAddress: string;

  // IMAP/SMTP login name — usually identical to emailAddress.
  @Column({ type: 'varchar', length: 255 })
  username: string;

  // encryptSettingsValue() output — never returned by any endpoint.
  @Column({ type: 'text' })
  passwordEncrypted: string;

  @Column({ type: 'varchar', length: 255 })
  imapHost: string;

  @Column({ type: 'int', default: 993 })
  imapPort: number;

  @Column({ type: 'boolean', default: true })
  imapSecure: boolean;

  @Column({ type: 'varchar', length: 255 })
  smtpHost: string;

  @Column({ type: 'int', default: 465 })
  smtpPort: number;

  @Column({ type: 'boolean', default: true })
  smtpSecure: boolean;

  @Column({ type: 'text', nullable: true })
  signatureHtml: string | null;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
