import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { Job } from '../../jobs/entities/job.entity';
import { File as FileEntity } from '../../files/entities/file.entity';
import type { RoofDesignDoc } from '../types/roof-design-doc.type';

/**
 * One row per job — the live (unsent) roof design a coordinator is drawing
 * in the Solar Design Studio. `doc` is the full `RoofDesignDoc` (§2 of
 * `docs/specs/solar-design-studio.md`); a sent `ProposalVersion` freezes a
 * copy into `systemSnapshot.roofDesign` so this row may keep changing after
 * a proposal has gone out without mutating what the customer was shown.
 */
@Entity('roof_designs')
@Unique('uq_roof_designs_job', ['jobId'])
export class RoofDesign {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Job, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'jobId' })
  job: Job;

  @Column({ type: 'uuid' })
  jobId: string;

  /** Full `RoofDesignDoc` payload — see `roof-design-doc.type.ts`. */
  @Column({ type: 'json' })
  doc: RoofDesignDoc;

  @ManyToOne(() => FileEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'renderFileId' })
  renderFile: FileEntity | null;

  @Column({ type: 'uuid', nullable: true })
  renderFileId: string | null;

  @Column({ type: 'uuid', nullable: true })
  updatedByUserId: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
