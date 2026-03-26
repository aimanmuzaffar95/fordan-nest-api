import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { InverterStockStatus } from './inverter-stock-status.enum';

@Entity('inverters')
@Index('UQ_inverters_brand_model', ['brand', 'model'], { unique: true })
export class Inverter {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100 })
  brand: string;

  @Column({ type: 'varchar', length: 100 })
  model: string;

  @Column({ type: 'numeric', precision: 10, scale: 2 })
  capacityKw: string;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 })
  defaultUnitPrice: string;

  @Column({
    type: 'varchar',
    length: 30,
    default: InverterStockStatus.AVAILABLE,
  })
  stockStatus: InverterStockStatus;

  @Column({ type: 'varchar', length: 50, nullable: true })
  inverterType: string | null;

  @Column({ type: 'varchar', length: 30, nullable: true })
  phases: string | null;

  @Column({ type: 'numeric', precision: 5, scale: 2, nullable: true })
  efficiency: string | null;

  @Column({ type: 'int', nullable: true })
  warrantyYears: number | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
