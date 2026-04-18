import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('email_tracking')
export class EmailTracking {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Stable id embedded into the tracking pixel URL. */
  @Index({ unique: true })
  @Column({ type: 'uuid' })
  messageId: string;

  @Column({ type: 'varchar', length: 512 })
  to: string;

  @Column({ type: 'varchar', length: 255 })
  subject: string;

  @Column({ type: 'timestamp', nullable: true })
  sentAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  firstOpenedAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  lastOpenedAt: Date | null;

  @Column({ type: 'int', default: 0 })
  openCount: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

