import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsInt,
  IsNumber,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { JobProposalEquipmentType } from '../job-proposal-equipment-type.enum';

export class UpdateJobProposalConfigItemDto {
  @IsEnum(JobProposalEquipmentType)
  equipmentType!: JobProposalEquipmentType;

  @IsUUID()
  equipmentId!: string;

  @IsInt()
  @Min(1)
  quantity!: number;

  @IsNumber()
  @Min(0)
  proposalUnitPrice!: number;
}

export class UpdateJobProposalConfigDto {
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique(
    (item: UpdateJobProposalConfigItemDto) =>
      `${item.equipmentType}:${item.equipmentId}`,
  )
  @ValidateNested({ each: true })
  @Type(() => UpdateJobProposalConfigItemDto)
  items!: UpdateJobProposalConfigItemDto[];
}
