import { IsString, MaxLength, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  currentPassword: string;

  @IsString()
  @MinLength(6)
  @MaxLength(255)
  newPassword: string;
}
