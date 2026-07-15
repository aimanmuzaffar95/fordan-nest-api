import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty({ message: 'Current password is required' })
  @MaxLength(255)
  currentPassword: string;

  @IsString()
  @IsNotEmpty({ message: 'New password is required' })
  @MinLength(6, {
    message: 'New password must be at least 6 characters long',
  })
  @MaxLength(255)
  newPassword: string;
}
