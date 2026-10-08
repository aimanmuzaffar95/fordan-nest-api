import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { resolveTimestampColumnType } from '../../common/timestamp-column-type.util';
import { User } from '../../users/entities/user.entity';
import { TrainingModuleEntity } from './training-module.entity';

@Entity('training_attempts')
@Index('idx_training_attempts_user_module', ['userId', 'moduleId'])
export class TrainingAttempt {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => TrainingModuleEntity, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'moduleId' })
  module: TrainingModuleEntity;

  @Column({ type: 'uuid' })
  moduleId: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ type: 'uuid' })
  userId: string;

  @Column({ type: 'json' })
  answers: number[];

  @Column({ type: 'int' })
  scorePercent: number;

  @Column({ type: 'boolean' })
  passed: boolean;

  @CreateDateColumn({ type: resolveTimestampColumnType() })
  createdAt: Date;
}
