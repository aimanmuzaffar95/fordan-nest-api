import {
  IsBoolean,
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
  /**
   * When a soft-deleted staff member still holds this email / identification
   * number / username, archive those values on the deleted record (suffix
   * them) so this account can take them. Only honoured for deleted records —
   * an active clash still 409s.
   */
  @IsOptional()
  @IsBoolean()
  forceReuseDeleted?: boolean;

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

  // Optional: the service autogenerates an ID number when omitted (the
  // required-ness here previously made that branch unreachable).
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  identificationNumber?: string;

  @IsIn([UserRole.MANAGER, UserRole.INSTALLER, UserRole.EMPLOYEE])
  staffType: UserRole.MANAGER | UserRole.INSTALLER | UserRole.EMPLOYEE;

  @IsOptional()
  @IsUUID()
  staffRoleId?: string;

  @IsOptional()
  @IsUUID()
  employeeRoleId?: string;

  @IsEmail()
  emailAddress: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  username?: string;

  @IsOptional()
  @IsString()
  @MinLength(6)
  @MaxLength(255)
  password?: string;
}
