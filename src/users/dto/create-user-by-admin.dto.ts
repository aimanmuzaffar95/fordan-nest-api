import { IsEmail, IsIn, IsString, MinLength } from 'class-validator';
import { UserRole } from '../entities/user-role.enum';

export class CreateUserByAdminDto {
  @IsString()
  @MinLength(1)
  firstName: string;

  @IsString()
  @MinLength(1)
  lastName: string;

  @IsEmail()
  emailAddress: string;

  @IsString()
  @MinLength(1)
  phoneNumber: string;

  @IsString()
  @MinLength(1)
  username: string;

  @IsString()
  @MinLength(6)
  password: string;

  @IsIn([UserRole.MANAGER, UserRole.INSTALLER])
  role: UserRole;
}
