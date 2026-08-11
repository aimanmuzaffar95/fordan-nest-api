import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class ClonePermissionRoleDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name: string;

  /**
   * Optional: override the cloned role's family instead of inheriting the
   * source role's. Previously this field did not exist on the DTO at all —
   * the handler used an inline `{ name: string }` type, so ValidationPipe
   * never validated the request body (an inline type literal carries no
   * class-validator metadata) and any `family` a caller sent was silently
   * discarded rather than applied or rejected. Now an invalid value is a
   * `400`, matching `CreatePermissionRoleDto`'s validation, and a valid one
   * is actually honoured by the service instead of always being
   * re-derived from the source profile.
   */
  @IsOptional()
  @IsIn(['installer', 'office'])
  family?: 'installer' | 'office';
}
