import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('staff_availability')
@Index('idx_staff_availability_user_starts', ['userId', 'startsAt'])
export class StaffAvailability {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  userId: string;

  @Column({ type: 'timestamp' })
  startsAt: Date;

  @Column({ type: 'timestamp' })
  endsAt: Date;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  recurrenceRule: string | null;

  @Column({ type: 'varchar', length: 32, default: 'mobile' })
  source: string;

  @CreateDateColumn()
  createdAt: Date;
}
