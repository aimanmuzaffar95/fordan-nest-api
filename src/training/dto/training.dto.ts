import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { UserRole } from '../../users/entities/user-role.enum';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class TrainingQuestionInputDto {
  @ApiProperty({ maxLength: 2000 })
  @IsString()
  @Transform(trim)
  @MinLength(1)
  @MaxLength(2000)
  prompt: string;

  @ApiProperty({ type: [String], minItems: 2, maxItems: 6 })
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(6)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(500, { each: true })
  options: string[];

  @ApiProperty({ description: 'Index into `options`.' })
  @IsInt()
  @Min(0)
  correctIndex: number;
}

export class CreateTrainingModuleDto {
  @ApiProperty({ maxLength: 200 })
  @IsString()
  @Transform(trim)
  @MinLength(1)
  @MaxLength(200)
  title: string;

  @ApiPropertyOptional({ nullable: true, maxLength: 10000 })
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  description?: string | null;

  @ApiProperty({ description: 'http(s) URL: YouTube, Vimeo or direct .mp4' })
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(1000)
  videoUrl: string;

  @ApiPropertyOptional({ enum: ['soft', 'strict'], default: 'soft' })
  @IsOptional()
  @IsIn(['soft', 'strict'])
  policy?: 'soft' | 'strict';

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 80 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  passMarkPercent?: number;

  @ApiPropertyOptional({ enum: UserRole, isArray: true })
  @IsOptional()
  @IsArray()
  @IsEnum(UserRole, { each: true })
  roles?: UserRole[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @ApiProperty({ type: [TrainingQuestionInputDto], minItems: 1, maxItems: 20 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => TrainingQuestionInputDto)
  questions: TrainingQuestionInputDto[];
}

export class UpdateTrainingModuleDto extends PartialType(
  CreateTrainingModuleDto,
) {}

export class ListTrainingModulesQueryDto {
  @ApiPropertyOptional({ enum: ['true', 'false'] })
  @IsOptional()
  @IsIn(['true', 'false'])
  active?: 'true' | 'false';
}

export class TrainingProgressQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  userId?: string;
}

export class SubmitTrainingAttemptDto {
  @ApiProperty({
    type: [Number],
    description: 'One option index per question, in sortOrder.',
  })
  @IsArray()
  @ArrayMaxSize(20)
  @IsInt({ each: true })
  @Min(0, { each: true })
  answers: number[];
}
