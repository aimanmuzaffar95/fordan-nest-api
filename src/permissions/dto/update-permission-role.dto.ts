import { IsObject, IsOptional } from 'class-validator';

export class UpdatePermissionRoleDto {
  @IsObject()
  @IsOptional()
  permissions?: Record<string, boolean>;

  @IsObject()
  @IsOptional()
  scopes?: Record<string, string>;
}
