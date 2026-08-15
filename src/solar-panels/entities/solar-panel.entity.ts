import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  ValueTransformer,
} from 'typeorm';
import { SolarPanelStockStatus } from './solar-panel-stock-status.enum';

/** Postgres/MariaDB `numeric` columns come back as strings — coerce to a JS number for geometry math. */
const nullableNumericTransformer: ValueTransformer = {
  to: (value?: number | null) => value ?? null,
  from: (value?: string | null) =>
    value === null || value === undefined ? null : Number(value),
};

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

  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 })
  defaultUnitPrice: string;

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

  /** Physical panel width/height in millimetres, for the Solar Design Studio (P1). Free-text `dimensions` stays for display. */
  @Column({
    type: 'numeric',
    precision: 8,
    scale: 1,
    nullable: true,
    transformer: nullableNumericTransformer,
  })
  widthMm: number | null;

  @Column({
    type: 'numeric',
    precision: 8,
    scale: 1,
    nullable: true,
    transformer: nullableNumericTransformer,
  })
  heightMm: number | null;

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
