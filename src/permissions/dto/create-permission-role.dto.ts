import { IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class CreatePermissionRoleDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  /**
   * `'installer'` roles are held to the installer-family constraints
   * (`job=own`, `schedule=self`, no `invoice:*`); `'office'` roles have no
   * such ceiling and can be assigned to a manager-type staff member.
   */
  @IsIn(['installer', 'office'])
  family: 'installer' | 'office';

  /**
   * Optional starting point — clone another role's grants/scopes instead of
   * starting from a blank slate (every catalog key off).
   */
  @IsOptional()
  @IsUUID()
  cloneFromProfileId?: string;
}
