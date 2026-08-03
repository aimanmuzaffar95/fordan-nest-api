import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { resolveTimestampColumnType } from '../../common/timestamp-column-type.util';
import { User } from '../../users/entities/user.entity';
import { Territory } from './territory.entity';

/** A rep who can receive leads from a territory. */
@Entity('territory_members')
@Unique('uq_territory_member', ['territoryId', 'userId'])
@Index('idx_territory_members_territory', ['territoryId'])
export class TerritoryMember {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Territory, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'territoryId' })
  territory: Territory;

  @Column({ type: 'uuid' })
  territoryId: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ type: 'uuid' })
  userId: string;

  /** Share of leads under the `weighted` strategy. Ignored by round-robin. */
  @Column({ type: 'int', default: 1 })
  weight: number;

  /**
   * Temporarily skip this member without losing their weight or history
   * (leave, training, capacity).
   */
  @Column({ type: 'boolean', default: true })
  active: boolean;

  /** Set by the router; drives the weighted strategy's fairness check. */
  @Column({ type: 'int', default: 0 })
  assignedCount: number;

  @Column({ type: resolveTimestampColumnType(), nullable: true })
  lastAssignedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
