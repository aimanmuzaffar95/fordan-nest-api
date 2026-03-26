import { buildEquipmentCatalogName } from '../../equipment-catalog/build-equipment-catalog-name';
import { Battery } from '../entities/battery.entity';
import { BatteryStockStatus } from '../entities/battery-stock-status.enum';

export class BatteryResponseDto {
  id: string;
  name: string;
  brand: string;
  model: string;
  capacityKwh: number;
  stockStatus: BatteryStockStatus;
  voltage: number | null;
  chemistry: string | null;
  cycleLife: number | null;
  warrantyYears: number | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;

  static fromEntity(entity: Battery): BatteryResponseDto {
    return {
      id: entity.id,
      name: buildEquipmentCatalogName(entity.brand, entity.model),
      brand: entity.brand,
      model: entity.model,
      capacityKwh: Number(entity.capacityKwh),
      stockStatus: entity.stockStatus,
      voltage: entity.voltage === null ? null : Number(entity.voltage),
      chemistry: entity.chemistry,
      cycleLife: entity.cycleLife,
      warrantyYears: entity.warrantyYears,
      notes: entity.notes,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }
}
