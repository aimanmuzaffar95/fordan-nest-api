import { buildEquipmentCatalogName } from '../../equipment-catalog/build-equipment-catalog-name';
import { Inverter } from '../entities/inverter.entity';
import { InverterStockStatus } from '../entities/inverter-stock-status.enum';

export class InverterResponseDto {
  id: string;
  name: string;
  brand: string;
  model: string;
  capacityKw: number;
  defaultUnitPrice: number;
  stockStatus: InverterStockStatus;
  inverterType: string | null;
  phases: string | null;
  efficiency: number | null;
  warrantyYears: number | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;

  static fromEntity(entity: Inverter): InverterResponseDto {
    return {
      id: entity.id,
      name: buildEquipmentCatalogName(entity.brand, entity.model),
      brand: entity.brand,
      model: entity.model,
      capacityKw: Number(entity.capacityKw),
      defaultUnitPrice: Number(entity.defaultUnitPrice),
      stockStatus: entity.stockStatus,
      inverterType: entity.inverterType,
      phases: entity.phases,
      efficiency: entity.efficiency === null ? null : Number(entity.efficiency),
      warrantyYears: entity.warrantyYears,
      notes: entity.notes,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }
}
