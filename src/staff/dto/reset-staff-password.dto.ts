import { IsString, MaxLength, MinLength } from 'class-validator';

export class ResetStaffPasswordDto {
  @IsString()
  @MinLength(8)
  @MaxLength(255)
  temporaryPassword: string;
}
