import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { resolveEnumColumnType } from '../../common/timestamp-column-type.util';
import { JobProposalEquipmentType } from '../job-proposal-equipment-type.enum';
import { Job } from './job.entity';

@Entity('job_proposal_selections')
@Index('IDX_job_proposal_selections_job_sort', ['jobId', 'sortOrder'])
export class JobProposalSelection {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Job, { nullable: false, onDelete: 'CASCADE' })
  job: Job;

  @Column({ type: 'uuid' })
  jobId: string;

  @Column({
    type: resolveEnumColumnType(),
    enum: JobProposalEquipmentType,
    enumName: 'job_proposal_selections_equipmenttype_enum',
  })
  equipmentType: JobProposalEquipmentType;

  @Column({ type: 'uuid' })
  equipmentId: string;

  @Column({ type: 'varchar', length: 200 })
  equipmentNameSnapshot: string;

  @Column({ type: 'varchar', length: 200 })
  equipmentSubtitleSnapshot: string;

  @Column({ type: 'numeric', precision: 12, scale: 2 })
  defaultUnitPriceSnapshot: string;

  @Column({ type: 'numeric', precision: 12, scale: 2 })
  proposalUnitPrice: string;

  @Column({ type: 'int' })
  quantity: number;

  @Column({ type: 'int', default: 0 })
  sortOrder: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
