import { IsString, MaxLength, MinLength } from 'class-validator';

export class CreateStaffRoleDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  description: string;
}
