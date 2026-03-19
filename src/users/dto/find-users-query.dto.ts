import { Transform } from 'class-transformer';
import { ArrayUnique, IsArray, IsIn, IsOptional } from 'class-validator';
import { UserRole } from '../entities/user-role.enum';

export type AssignableUserRole = UserRole.MANAGER | UserRole.INSTALLER;

const ASSIGNABLE_USER_ROLES: AssignableUserRole[] = [
  UserRole.MANAGER,
  UserRole.INSTALLER,
];

const toRoleList = ({ value }: { value: unknown }): string[] | undefined => {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  const rawItems = Array.isArray(value)
    ? value.flatMap((item) => (typeof item === 'string' ? item.split(',') : []))
    : typeof value === 'string'
      ? value.split(',')
      : [];
  const roles = rawItems
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

  return roles.length > 0 ? roles : undefined;
};

export class FindUsersQueryDto {
  @Transform(toRoleList)
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(ASSIGNABLE_USER_ROLES, { each: true })
  roles?: AssignableUserRole[];
}
