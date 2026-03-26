import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { BatteryStockStatus } from './battery-stock-status.enum';

@Entity('batteries')
@Index('UQ_batteries_brand_model', ['brand', 'model'], { unique: true })
export class Battery {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100 })
  brand: string;

  @Column({ type: 'varchar', length: 100 })
  model: string;

  @Column({ type: 'numeric', precision: 10, scale: 2 })
  capacityKwh: string;

  @Column({
    type: 'varchar',
    length: 30,
    default: BatteryStockStatus.AVAILABLE,
  })
  stockStatus: BatteryStockStatus;

  @Column({ type: 'numeric', precision: 10, scale: 2, nullable: true })
  voltage: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  chemistry: string | null;

  @Column({ type: 'int', nullable: true })
  cycleLife: number | null;

  @Column({ type: 'int', nullable: true })
  warrantyYears: number | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
