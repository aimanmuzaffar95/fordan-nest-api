import { Transform } from 'class-transformer';
import { IsOptional, IsUUID, ValidateIf } from 'class-validator';

export class UpdateJobDto {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value === '') return null;
    return value;
  })
  @ValidateIf((_, value) => value !== null)
  @IsUUID('4')
  managerId?: string | null;
}
