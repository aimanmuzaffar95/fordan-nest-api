import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { StaffRole } from '../staff/entities/staff-role.entity';
import { SystemAuditLogService } from '../system-audit/system-audit-log.service';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/entities/user-role.enum';
import { UpdatePermissionRoleDto } from './dto/update-permission-role.dto';
import { PermissionRoleGrant } from './entities/permission-role-grant.entity';
import { PermissionRoleProfile } from './entities/permission-role-profile.entity';
import { PermissionRoleScope } from './entities/permission-role-scope.entity';
import {
  DEFAULT_PERMISSIONS_BY_ROLE,
  DEFAULT_SCOPES_BY_ROLE,
  FIXED_ADMIN_CAPABILITIES,
  PERMISSION_CATALOG,
  PERMISSION_KEYS,
  PermissionKey,
  PermissionScopeResource,
  PermissionScopeValue,
  SCOPE_VALUES,
  isPermissionKey,
  isScopeResource,
  isScopeValueAllowed,
} from './permission-catalog';

type RoleProfileKind = 'builtin' | 'staff_role';

type ProfileSummary = {
  id: string;
  kind: RoleProfileKind;
  builtinRole: UserRole | null;
  staffRoleId: string | null;
  name: string;
  immutable: boolean;
  permissionCount: number;
  scopes: Partial<Record<PermissionScopeResource, PermissionScopeValue>>;
  updatedAt: Date;
};

type ProfileDetail = {
  id: string;
  kind: RoleProfileKind;
  builtinRole: UserRole | null;
  staffRoleId: string | null;
  name: string;
  immutable: boolean;
  permissions: { key: PermissionKey; enabled: boolean }[];
  scopes: Partial<Record<PermissionScopeResource, PermissionScopeValue>>;
  createdAt: Date;
  updatedAt: Date;
};

export type EffectivePermissions = {
  userId: string;
  role: UserRole;
  baseRole: UserRole;
  profileId: string;
  profile: {
    id: string;
    kind: RoleProfileKind;
    builtinRole: UserRole | null;
    staffRoleId: string | null;
    name: string;
    immutable: boolean;
  };
  permissions: PermissionKey[];
  scopes: Partial<Record<PermissionScopeResource, PermissionScopeValue>>;
  fixedAdminCapabilities: string[];
};

@Injectable()
export class PermissionsService implements OnModuleInit {
  constructor(
    @InjectRepository(PermissionRoleProfile)
    private readonly profiles: Repository<PermissionRoleProfile>,
    @InjectRepository(PermissionRoleGrant)
    private readonly grants: Repository<PermissionRoleGrant>,
    @InjectRepository(PermissionRoleScope)
    private readonly scopes: Repository<PermissionRoleScope>,
    @InjectRepository(StaffRole)
    private readonly staffRoles: Repository<StaffRole>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly audit: SystemAuditLogService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.ensureDefaultProfiles();
  }

  getCatalog() {
    return {
      permissions: PERMISSION_CATALOG,
      scopes: Object.entries(SCOPE_VALUES).map(([resource, values]) => ({
        resource,
        values,
        defaultByRole: {
          admin:
            DEFAULT_SCOPES_BY_ROLE[UserRole.ADMIN][
              resource as PermissionScopeResource
            ],
          manager:
            DEFAULT_SCOPES_BY_ROLE[UserRole.MANAGER][
              resource as PermissionScopeResource
            ],
          installer:
            DEFAULT_SCOPES_BY_ROLE[UserRole.INSTALLER][
              resource as PermissionScopeResource
            ],
        },
      })),
      fixedAdminCapabilities: [...FIXED_ADMIN_CAPABILITIES],
    };
  }

  async listProfiles(): Promise<ProfileSummary[]> {
    await this.ensureDefaultProfiles();
    const rows = await this.profiles.find({
      relations: { grants: true, scopes: true },
      order: { kind: 'ASC', name: 'ASC' },
    });
    return rows.map((profile) => ({
      ...this.profileBase(profile),
      permissionCount: this.enabledPermissions(profile).length,
      scopes: this.scopeMap(profile),
      updatedAt: profile.updatedAt,
    }));
  }

  async getProfile(id: string): Promise<ProfileDetail> {
    await this.ensureDefaultProfiles();
    const profile = await this.findProfileOrThrow(id);
    return this.toProfileDetail(profile);
  }

  async resetProfile(id: string, actorUserId: string): Promise<ProfileDetail> {
    const profile = await this.findProfileOrThrow(id);
    this.assertEditable(profile);
    const role = this.defaultRoleForProfile(profile);
    await this.replaceGrantsAndScopes(
      profile,
      DEFAULT_PERMISSIONS_BY_ROLE[role],
      DEFAULT_SCOPES_BY_ROLE[role],
    );
    await this.audit.record({
      action: 'permission_role_profile.reset',
      actorUserId,
      resourceType: 'permission_role_profile',
      resourceId: profile.id,
      metadata: {
        role,
        profileName: profile.name,
      },
    });
    return this.getProfile(profile.id);
  }

  async updateProfile(
    id: string,
    dto: UpdatePermissionRoleDto,
    actorUserId: string,
  ): Promise<ProfileDetail> {
    const profile = await this.findProfileOrThrow(id);
    this.assertEditable(profile);

    const permissions = this.validatePermissionPatch(dto.permissions);
    const scopePatch = this.validateScopePatch(dto.scopes);
    const nextPermissions = permissions ?? this.enabledPermissions(profile);
    const nextScopes = {
      ...this.scopeMap(profile),
      ...(scopePatch ?? {}),
    };

    this.validateProfileRules(profile, nextPermissions, nextScopes);
    await this.replaceGrantsAndScopes(profile, nextPermissions, nextScopes);

    await this.audit.record({
      action: 'permission_role_profile.updated',
      actorUserId,
      resourceType: 'permission_role_profile',
      resourceId: profile.id,
      metadata: {
        profileName: profile.name,
        changedFields: [
          ...(permissions ? ['permissions'] : []),
          ...(scopePatch ? ['scopes'] : []),
        ],
      },
    });

    return this.getProfile(profile.id);
  }

  async getEffectiveForUser(userId: string): Promise<EffectivePermissions> {
    await this.ensureDefaultProfiles();
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.role === UserRole.ADMIN) {
      return {
        userId: user.id,
        role: user.role,
        baseRole: user.role,
        profileId: 'admin',
        profile: {
          id: 'admin',
          kind: 'builtin',
          builtinRole: UserRole.ADMIN,
          staffRoleId: null,
          name: 'Admin',
          immutable: true,
        },
        permissions: [...PERMISSION_KEYS],
        scopes: DEFAULT_SCOPES_BY_ROLE[UserRole.ADMIN],
        fixedAdminCapabilities: [...FIXED_ADMIN_CAPABILITIES],
      };
    }

    const profile = await this.resolveProfileForUser(user);
    return {
      userId: user.id,
      role: user.role,
      baseRole: user.role,
      profileId: profile.id,
      profile: this.profileBase(profile),
      permissions: this.enabledPermissions(profile),
      scopes: this.scopeMap(profile),
      fixedAdminCapabilities: [],
    };
  }

  hasPermission(
    effective: EffectivePermissions,
    permission: PermissionKey,
  ): boolean {
    return effective.permissions.includes(permission);
  }

  assertPermission(
    effective: EffectivePermissions,
    permission: PermissionKey,
  ): void {
    if (!this.hasPermission(effective, permission)) {
      throw new ForbiddenException('Missing required permission');
    }
  }

  private async ensureDefaultProfiles(): Promise<void> {
    await this.ensureBuiltinProfile(UserRole.ADMIN, 'Admin', true);
    await this.ensureBuiltinProfile(UserRole.MANAGER, 'Manager', false);
    await this.ensureBuiltinProfile(UserRole.INSTALLER, 'Installer', false);

    const roles = await this.staffRoles.find({ order: { name: 'ASC' } });
    for (const role of roles) {
      await this.ensureStaffRoleProfile(role);
    }
  }

  private async ensureBuiltinProfile(
    role: UserRole,
    name: string,
    immutable: boolean,
  ): Promise<PermissionRoleProfile> {
    let profile = await this.profiles.findOne({
      where: { builtinRole: role },
      relations: { grants: true, scopes: true },
    });
    if (!profile) {
      profile = await this.profiles.save(
        this.profiles.create({
          kind: 'builtin',
          builtinRole: role,
          staffRoleId: null,
          name,
          immutable,
        }),
      );
      await this.replaceGrantsAndScopes(
        profile,
        DEFAULT_PERMISSIONS_BY_ROLE[role],
        DEFAULT_SCOPES_BY_ROLE[role],
      );
      return this.findProfileOrThrow(profile.id);
    }

    const updates: Partial<PermissionRoleProfile> = {};
    if (profile.name !== name) updates.name = name;
    if (profile.immutable !== immutable) updates.immutable = immutable;
    if (Object.keys(updates).length > 0) {
      await this.profiles.update(profile.id, updates);
    }
    return profile;
  }

  private async ensureStaffRoleProfile(
    role: StaffRole,
  ): Promise<PermissionRoleProfile> {
    let profile = await this.profiles.findOne({
      where: { staffRoleId: role.id },
      relations: { grants: true, scopes: true },
    });
    if (!profile) {
      profile = await this.profiles.save(
        this.profiles.create({
          kind: 'staff_role',
          builtinRole: null,
          staffRoleId: role.id,
          name: role.name,
          immutable: false,
        }),
      );
      await this.replaceGrantsAndScopes(
        profile,
        DEFAULT_PERMISSIONS_BY_ROLE[UserRole.INSTALLER],
        DEFAULT_SCOPES_BY_ROLE[UserRole.INSTALLER],
      );
      return this.findProfileOrThrow(profile.id);
    }
    if (profile.name !== role.name) {
      await this.profiles.update(profile.id, { name: role.name });
    }
    return profile;
  }

  private async resolveProfileForUser(
    user: User,
  ): Promise<PermissionRoleProfile> {
    if (user.role === UserRole.INSTALLER && user.staffRoleId) {
      const staffRole = await this.staffRoles.findOne({
        where: { id: user.staffRoleId },
      });
      if (staffRole) {
        return this.ensureStaffRoleProfile(staffRole);
      }
    }
    const profile = await this.profiles.findOne({
      where: { builtinRole: user.role },
      relations: { grants: true, scopes: true },
    });
    if (!profile) {
      throw new NotFoundException('Permission profile not found');
    }
    return profile;
  }

  private async findProfileOrThrow(id: string): Promise<PermissionRoleProfile> {
    const profile = await this.profiles.findOne({
      where: { id },
      relations: { grants: true, scopes: true },
    });
    if (!profile) {
      throw new NotFoundException('Permission profile not found');
    }
    return profile;
  }

  private async replaceGrantsAndScopes(
    profile: PermissionRoleProfile,
    permissions: PermissionKey[],
    scopes: Partial<Record<PermissionScopeResource, PermissionScopeValue>>,
  ): Promise<void> {
    const uniquePermissions = Array.from(new Set(permissions));
    await this.grants.delete({ profileId: profile.id });
    if (uniquePermissions.length > 0) {
      await this.grants.save(
        uniquePermissions.map((permissionKey) =>
          this.grants.create({
            profileId: profile.id,
            permissionKey,
            enabled: true,
          }),
        ),
      );
    }

    await this.scopes.delete({ profileId: profile.id });
    const scopeRows = Object.entries(scopes)
      .filter(
        (entry): entry is [PermissionScopeResource, PermissionScopeValue] =>
          Boolean(entry[1]),
      )
      .map(([resource, scope]) =>
        this.scopes.create({
          profileId: profile.id,
          resource,
          scope,
        }),
      );
    if (scopeRows.length > 0) {
      await this.scopes.save(scopeRows);
    }
  }

  private validatePermissionPatch(
    permissions: Record<string, boolean> | undefined,
  ): PermissionKey[] | null {
    if (permissions === undefined) return null;
    const enabled: PermissionKey[] = [];
    for (const [key, value] of Object.entries(permissions)) {
      if (!isPermissionKey(key)) {
        throw new BadRequestException(`Unknown permission key: ${key}`);
      }
      if (typeof value !== 'boolean') {
        throw new BadRequestException(
          `Permission value must be boolean: ${key}`,
        );
      }
      if (value) enabled.push(key);
    }
    return enabled;
  }

  private validateScopePatch(
    scopes: Record<string, string> | undefined,
  ): Partial<Record<PermissionScopeResource, PermissionScopeValue>> | null {
    if (scopes === undefined) return null;
    const result: Partial<
      Record<PermissionScopeResource, PermissionScopeValue>
    > = {};
    for (const [resource, scope] of Object.entries(scopes)) {
      if (!isScopeResource(resource)) {
        throw new BadRequestException(`Unknown scope resource: ${resource}`);
      }
      if (!isScopeValueAllowed(resource, scope)) {
        throw new BadRequestException(
          `Invalid scope value for ${resource}: ${scope}`,
        );
      }
      result[resource] = scope;
    }
    return result;
  }

  private validateProfileRules(
    profile: PermissionRoleProfile,
    permissions: PermissionKey[],
    scopes: Partial<Record<PermissionScopeResource, PermissionScopeValue>>,
  ): void {
    if (this.isInstallerFamily(profile)) {
      if (scopes.job && scopes.job !== 'own') {
        throw new BadRequestException(
          'Installer-family profiles must use job scope "own"',
        );
      }
      if (scopes.schedule && scopes.schedule !== 'self') {
        throw new BadRequestException(
          'Installer-family profiles must use schedule scope "self"',
        );
      }
      if (permissions.some((key) => key.startsWith('invoice:'))) {
        throw new BadRequestException(
          'Installer-family profiles cannot receive invoice permissions in v1',
        );
      }
    }

    if (
      permissions.includes('customer:job:create') &&
      (!permissions.includes('customer:view') ||
        !permissions.includes('job:create'))
    ) {
      throw new BadRequestException(
        'Creating customer jobs requires customer:view and job:create',
      );
    }
    if (
      permissions.includes('assignment:manage') &&
      !permissions.includes('assignment:view')
    ) {
      throw new BadRequestException(
        'assignment:manage requires assignment:view',
      );
    }
    if (
      permissions.includes('assignment:lock') &&
      !permissions.includes('assignment:manage')
    ) {
      throw new BadRequestException(
        'assignment:lock requires assignment:manage',
      );
    }
    if (
      permissions.some((key) =>
        [
          'invoice:record_payment',
          'invoice:cancel',
          'invoice:notes',
          'invoice:send',
          'invoice:remind_overdue',
        ].includes(key),
      ) &&
      !permissions.includes('invoice:view')
    ) {
      throw new BadRequestException('Invoice actions require invoice:view');
    }
  }

  private assertEditable(profile: PermissionRoleProfile): void {
    if (profile.immutable || profile.builtinRole === UserRole.ADMIN) {
      throw new ForbiddenException('Admin permission profile is immutable');
    }
  }

  private defaultRoleForProfile(profile: PermissionRoleProfile): UserRole {
    if (profile.builtinRole) return profile.builtinRole;
    return UserRole.INSTALLER;
  }

  private isInstallerFamily(profile: PermissionRoleProfile): boolean {
    return (
      profile.kind === 'staff_role' ||
      profile.builtinRole === UserRole.INSTALLER
    );
  }

  private profileBase(profile: PermissionRoleProfile) {
    return {
      id: profile.id,
      kind: profile.kind,
      builtinRole: profile.builtinRole,
      staffRoleId: profile.staffRoleId,
      name: profile.name,
      immutable: profile.immutable,
    };
  }

  private enabledPermissions(profile: PermissionRoleProfile): PermissionKey[] {
    if (profile.builtinRole === UserRole.ADMIN) {
      return [...PERMISSION_KEYS];
    }
    return (profile.grants ?? [])
      .filter((grant) => grant.enabled && isPermissionKey(grant.permissionKey))
      .map((grant) => grant.permissionKey);
  }

  private scopeMap(
    profile: PermissionRoleProfile,
  ): Partial<Record<PermissionScopeResource, PermissionScopeValue>> {
    if (profile.builtinRole === UserRole.ADMIN) {
      return DEFAULT_SCOPES_BY_ROLE[UserRole.ADMIN];
    }
    const out: Partial<Record<PermissionScopeResource, PermissionScopeValue>> =
      {};
    for (const scope of profile.scopes ?? []) {
      if (isScopeResource(scope.resource)) {
        out[scope.resource] = scope.scope;
      }
    }
    return out;
  }

  private toProfileDetail(profile: PermissionRoleProfile): ProfileDetail {
    const enabled = new Set(this.enabledPermissions(profile));
    return {
      ...this.profileBase(profile),
      permissions: PERMISSION_KEYS.map((key) => ({
        key,
        enabled: enabled.has(key),
      })),
      scopes: this.scopeMap(profile),
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
    };
  }
}
