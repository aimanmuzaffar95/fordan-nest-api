import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { SolarPanelStockStatus } from './solar-panel-stock-status.enum';

@Entity('solar_panels')
@Index('UQ_solar_panels_brand_model', ['brand', 'model'], { unique: true })
export class SolarPanel {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100 })
  brand: string;

  @Column({ type: 'varchar', length: 100 })
  model: string;

  @Column({ type: 'numeric', precision: 10, scale: 2 })
  wattage: string;

  @Column({
    type: 'varchar',
    length: 30,
    default: SolarPanelStockStatus.AVAILABLE,
  })
  stockStatus: SolarPanelStockStatus;

  @Column({ type: 'numeric', precision: 5, scale: 2, nullable: true })
  efficiency: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  dimensions: string | null;

  @Column({ type: 'numeric', precision: 10, scale: 2, nullable: true })
  weightKg: string | null;

  @Column({ type: 'int', nullable: true })
  warrantyYears: number | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
