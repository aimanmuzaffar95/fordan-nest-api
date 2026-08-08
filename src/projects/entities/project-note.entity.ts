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
import { Project } from './project.entity';

/**
 * A free-text note on a project's timeline.
 *
 * This is deliberately a separate store from `projects.notes` (a single
 * free-text column with its own meaning, written by another surface). Notes
 * created here are append-only per row rather than concatenated into one
 * column, so there is no accumulated-length rejection and no read-modify-write
 * race between concurrent authors. The author is always the authenticated
 * principal (`createdByUserId`), never client-supplied text.
 */
@Entity('project_notes')
@Index('idx_project_notes_project', ['projectId'])
export class ProjectNote {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Project, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'projectId' })
  project: Project;

  @Column({ type: 'uuid' })
  projectId: string;

  @Column({ type: resolveLongTextColumnType() })
  body: string;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'createdByUserId' })
  createdByUser: User | null;

  @Column({ type: 'uuid', nullable: true })
  createdByUserId: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
