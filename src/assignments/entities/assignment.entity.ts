import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Job } from '../../jobs/entities/job.entity';
import { Team } from '../../teams/entities/team.entity';
import { User } from '../../users/entities/user.entity';

// TypeORM compatibility:
// - sqljs doesn't support `timestamp` (used in earlier failures).
// - Postgres doesn't support `datetime` in TypeORM's validator.
// Use a dialect-aware mapping at runtime.
const lockedAtColumnType = (() => {
  const raw =
    process.env.DB_DIALECT ??
    process.env.DATABASE_DIALECT ??
    process.env.TYPEORM_CONNECTION ??
    '';
  const v = raw.trim().toLowerCase();
  return v.includes('postgres') ? 'timestamp' : 'datetime';
})();

@Entity('assignments')
@Index(
  'IDX_assignments_staff_scheduled_slot_unique',
  ['staffUserId', 'scheduledDate', 'slot'],
  { unique: true },
)
export class Assignment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Job, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'jobId' })
  job: Job;

  @Column({ type: 'uuid' })
  jobId: string;

  @ManyToOne(() => Team, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'teamId' })
  team: Team;

  @Column({ type: 'uuid' })
  teamId: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'staffUserId' })
  staffUser: User;

  @Column({ type: 'uuid' })
  staffUserId: string;

  @Column({ type: 'date' })
  scheduledDate: string;

  @Column({ type: 'varchar', length: 10 })
  slot: string;

  @Column({ type: 'boolean', default: false })
  locked: boolean;

  @Column({ type: lockedAtColumnType, nullable: true })
  lockedAt: Date | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'lockedByUserId' })
  lockedByUser: User | null;

  @Column({ type: 'uuid', nullable: true })
  lockedByUserId: string | null;

  @Column({ type: 'text', nullable: true })
  lockReason: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
