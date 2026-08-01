import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class PatchSessionDto {
  @IsString()
  @IsOptional()
  @MinLength(1)
  @MaxLength(500)
  correctionNote?: string;
}
