import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
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

  @ValidateIf(
    (item: UpdateJobProposalConfigItemDto) =>
      item.equipmentType === JobProposalEquipmentType.MISC,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  subtitle?: string;
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
