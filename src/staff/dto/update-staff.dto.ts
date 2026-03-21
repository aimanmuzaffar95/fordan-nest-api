import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { UserRole } from '../../users/entities/user-role.enum';

export class UpdateStaffDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  lastName?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  phoneNumber?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  address?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  identificationNumber?: string;

  @IsOptional()
  @IsIn([UserRole.MANAGER, UserRole.INSTALLER])
  staffType?: UserRole.MANAGER | UserRole.INSTALLER;

  @IsOptional()
  @IsUUID()
  staffRoleId?: string | null;

  @IsOptional()
  @IsEmail()
  emailAddress?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  username?: string;
}
