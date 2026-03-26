import { buildEquipmentCatalogName } from '../../equipment-catalog/build-equipment-catalog-name';
import { SolarPanel } from '../entities/solar-panel.entity';
import { SolarPanelStockStatus } from '../entities/solar-panel-stock-status.enum';

export class SolarPanelResponseDto {
  id: string;
  name: string;
  brand: string;
  model: string;
  wattage: number;
  stockStatus: SolarPanelStockStatus;
  efficiency: number | null;
  dimensions: string | null;
  weightKg: number | null;
  warrantyYears: number | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;

  static fromEntity(entity: SolarPanel): SolarPanelResponseDto {
    return {
      id: entity.id,
      name: buildEquipmentCatalogName(entity.brand, entity.model),
      brand: entity.brand,
      model: entity.model,
      wattage: Number(entity.wattage),
      stockStatus: entity.stockStatus,
      efficiency: entity.efficiency === null ? null : Number(entity.efficiency),
      dimensions: entity.dimensions,
      weightKg: entity.weightKg === null ? null : Number(entity.weightKg),
      warrantyYears: entity.warrantyYears,
      notes: entity.notes,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }
}
