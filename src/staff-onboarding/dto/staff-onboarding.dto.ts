import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { UserRole } from '../../users/entities/user-role.enum';
import { INVITABLE_ROLES } from '../staff-onboarding.service';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateOnboardingInviteDto {
  @ApiPropertyOptional({
    description:
      'Existing staff member to invite. Supply this, or an email plus role for a new hire.',
  })
  @IsOptional()
  @IsUUID()
  userId?: string;

  @ApiPropertyOptional({ description: 'Required when inviting someone new.' })
  @IsOptional()
  @Transform(trim)
  @IsEmail()
  @MaxLength(255)
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  firstName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  lastName?: string;

  @ApiPropertyOptional({
    enum: INVITABLE_ROLES,
    description:
      'Role the new account receives. Fixed at invite time and never read from the submission, so admin can never be granted this way.',
  })
  @IsOptional()
  @IsIn(INVITABLE_ROLES)
  role?: UserRole;

  @ApiPropertyOptional({
    description: 'Required when inviting a new non-technical (employee) hire.',
  })
  @IsOptional()
  @IsUUID()
  employeeRoleId?: string;

  @ApiPropertyOptional({
    description: 'Required when inviting a new installer; managers must not have one.',
  })
  @IsOptional()
  @IsUUID()
  staffRoleId?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 60, default: 14 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(60)
  ttlDays?: number;
}
