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

export class CreateStaffDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstName: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  lastName: string;

  @IsString()
  @MinLength(1)
  @MaxLength(30)
  phoneNumber: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  address: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  identificationNumber: string;

  @IsIn([UserRole.MANAGER, UserRole.INSTALLER])
  staffType: UserRole.MANAGER | UserRole.INSTALLER;

  @IsOptional()
  @IsUUID()
  staffRoleId?: string;

  @IsEmail()
  emailAddress: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  username: string;

  @IsString()
  @MinLength(6)
  @MaxLength(255)
  password: string;
}
