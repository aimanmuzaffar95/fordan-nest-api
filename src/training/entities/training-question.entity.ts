import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { TrainingModuleEntity } from './training-module.entity';

@Entity('training_questions')
@Index('idx_training_questions_module', ['moduleId', 'sortOrder'])
export class TrainingQuestion {
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

  @Column({ type: 'text' })
  prompt: string;

  @Column({ type: 'json' })
  options: string[];

  @Column({ type: 'int' })
  correctIndex: number;

  @Column({ type: 'int', default: 0 })
  sortOrder: number;
}
