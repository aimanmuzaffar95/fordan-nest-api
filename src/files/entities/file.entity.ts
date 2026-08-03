import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  JoinColumn,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

@Entity('files')
export class File {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 50 })
  ownerType: string;

  @Column({ type: 'uuid' })
  ownerId: string;

  @Column({ type: 'varchar', length: 80 })
  kind: string;

  @Column({ type: 'varchar', length: 20, default: 'local' })
  storageDriver: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  storageBucket: string | null;

  @Column({ type: 'varchar', length: 255 })
  storageKey: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  originalName: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  displayName: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  contentType: string | null;

  @Column({ type: 'bigint', nullable: true })
  sizeBytes: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'uploadedByUserId' })
  uploadedByUser: User | null;

  @Column({ type: 'uuid', nullable: true })
  uploadedByUserId: string | null;

  // ─── Document taxonomy (PRD v2, Phase 2) ────────────────────────────────
  // `kind` stays the internal upload channel (job_file, meter_doc, …); these
  // describe the document to a human and to the required-by-stage rules.

  /** `documentTaxonomy.categories[].id`. Null means uncategorised. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  categoryId: string | null;

  @Column({ type: 'json', nullable: true })
  tags: string[] | null;

  /** 1-based within `(ownerId, categoryId)` for versioned categories. */
  @Column({ type: 'int', nullable: true })
  versionNumber: number | null;

  /**
   * False once a newer version of the same category supersedes this file. The
   * old file is kept — superseding is not deleting.
   */
  @Column({ type: 'boolean', default: true })
  isCurrentVersion: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
