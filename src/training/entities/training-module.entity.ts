import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { resolveTimestampColumnType } from '../../common/timestamp-column-type.util';
import { UserRole } from '../../users/entities/user-role.enum';

export type TrainingPolicy = 'soft' | 'strict';

@Entity('training_modules')
export class TrainingModuleEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 200 })
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'varchar', length: 1000 })
  videoUrl: string;

  @Column({ type: 'varchar', length: 10, default: 'soft' })
  policy: TrainingPolicy;

  @Column({ type: 'int', default: 80 })
  passMarkPercent: number;

  /** `[]` = applies to every staff type. */
  @Column({ type: 'json' })
  roles: UserRole[];

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @Column({ type: 'int', default: 0 })
  sortOrder: number;

  // FK users ON DELETE SET NULL is declared in the migration / SQL only.
  @Column({ type: 'uuid', nullable: true })
  createdByUserId: string | null;

  @CreateDateColumn({ type: resolveTimestampColumnType() })
  createdAt: Date;

  @UpdateDateColumn({ type: resolveTimestampColumnType() })
  updatedAt: Date;
}
