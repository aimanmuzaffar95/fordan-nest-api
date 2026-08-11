import { IsISO8601, IsObject, IsOptional } from 'class-validator';

export class UpdatePermissionRoleDto {
  @IsObject()
  @IsOptional()
  permissions?: Record<string, boolean>;

  @IsObject()
  @IsOptional()
  scopes?: Record<string, string>;

  /**
   * Optimistic-concurrency token. Send back the `updatedAt` value from the
   * profile you loaded (GET /permissions/roles/:id). If another admin saved
   * a change in between, the write is rejected with 409 instead of silently
   * clobbering their edit. Optional for backward compatibility with older
   * clients, but new clients should always send it.
   */
  @IsISO8601()
  @IsOptional()
  expectedUpdatedAt?: string;
}
