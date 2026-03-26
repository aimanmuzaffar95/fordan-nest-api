import { CatalogStockStatus } from '../../equipment-catalog/catalog-stock-status.type';
import { JobProposalEquipmentType } from '../job-proposal-equipment-type.enum';

export class JobProposalConfigItemResponseDto {
  id: string;
  equipmentType: JobProposalEquipmentType;
  equipmentId: string;
  name: string;
  subtitle: string;
  quantity: number;
  defaultUnitPrice: number;
  proposalUnitPrice: number;
  lineTotal: number;
  stockStatus: CatalogStockStatus | null;
  wattage: number | null;
  inverterCapacityKw: number | null;
  batteryCapacityKwh: number | null;
  efficiency: number | null;
}

export class JobProposalConfigResponseDto {
  jobId: string;
  items: JobProposalConfigItemResponseDto[];
  totalProposalAmount: number;
}
