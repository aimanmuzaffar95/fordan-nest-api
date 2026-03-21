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

  @Column({ type: 'varchar', length: 255 })
  storageKey: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  originalName: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  contentType: string | null;

  @Column({ type: 'bigint', nullable: true })
  sizeBytes: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'uploadedByUserId' })
  uploadedByUser: User | null;

  @Column({ type: 'uuid', nullable: true })
  uploadedByUserId: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
