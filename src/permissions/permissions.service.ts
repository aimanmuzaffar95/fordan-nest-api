import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import { StaffRole } from '../staff/entities/staff-role.entity';
import { SystemAuditLogService } from '../system-audit/system-audit-log.service';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/entities/user-role.enum';
import { CreatePermissionRoleDto } from './dto/create-permission-role.dto';
import { RenamePermissionRoleDto } from './dto/rename-permission-role.dto';
import { UpdatePermissionRoleDto } from './dto/update-permission-role.dto';
import { PermissionRoleGrant } from './entities/permission-role-grant.entity';
import {
  PermissionRoleProfile,
  PermissionRoleProfileFamily,
} from './entities/permission-role-profile.entity';
import { PermissionRoleScope } from './entities/permission-role-scope.entity';
import { PermissionOverride } from './entities/permission-override.entity';
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
  description: string | null;
  family: PermissionRoleProfileFamily | null;
  immutable: boolean;
  deletable: boolean;
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
  description: string | null;
  family: PermissionRoleProfileFamily | null;
  immutable: boolean;
  deletable: boolean;
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
    @InjectRepository(PermissionOverride)
    private readonly overrides: Repository<PermissionOverride>,
    @InjectRepository(StaffRole)
    private readonly staffRoles: Repository<StaffRole>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly audit: SystemAuditLogService,
    private readonly dataSource: DataSource,
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
    return Promise.all(
      rows.map(async (profile) => ({
        ...this.profileBase(profile),
        deletable: await this.isProfileDeletable(profile),
        permissionCount: this.enabledPermissions(profile).length,
        scopes: this.scopeMap(profile),
        updatedAt: profile.updatedAt,
      })),
    );
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

  /**
   * Role authoring: create a new, independently-editable role from scratch
   * (every catalog key off — ServiceTitan's "blank role, ~360 switches"
   * starting point) or from an existing role's grants/scopes via
   * `cloneFromProfileId`. Backed by a new `StaffRole` row so it plugs into
   * the existing assignment mechanism (`User.staffRoleId`) instead of
   * inventing a second one — see `StaffService#resolveStaffRole`, which
   * gates assignment by `family` so an office-family role can only go to a
   * manager-type staff member and vice versa.
   */
  async createRole(
    dto: CreatePermissionRoleDto,
    actorUserId: string,
  ): Promise<ProfileDetail> {
    const name = dto.name.trim();
    await this.ensureStaffRoleNameAvailable(name);

    let sourcePermissions: PermissionKey[] = [];
    let sourceScopes: Partial<
      Record<PermissionScopeResource, PermissionScopeValue>
    > = {};
    if (dto.cloneFromProfileId) {
      const source = await this.findProfileOrThrow(dto.cloneFromProfileId);
      sourcePermissions = this.enabledPermissions(source);
      sourceScopes = this.scopeMap(source);
    }

    // Validate against a not-yet-persisted stand-in *before* creating any
    // rows — a clone from a role whose family doesn't match the new role's
    // chosen family (e.g. cloning an office-family role's invoice
    // permissions into a new installer-family role) is rejected with a
    // clear error, and nothing is left half-created in the DB.
    const pendingProfile = {
      kind: 'staff_role',
      builtinRole: null,
      family: dto.family,
    } as PermissionRoleProfile;
    this.validateProfileRules(pendingProfile, sourcePermissions, sourceScopes);

    const { profile } = await this.dataSource.transaction(async (manager) => {
      const staffRolesRepo = manager.getRepository(StaffRole);
      const profilesRepo = manager.getRepository(PermissionRoleProfile);

      const staffRole = await staffRolesRepo.save(
        staffRolesRepo.create({
          name,
          description: dto.description?.trim() || name,
        }),
      );
      const savedProfile = await profilesRepo.save(
        profilesRepo.create({
          kind: 'staff_role',
          builtinRole: null,
          staffRoleId: staffRole.id,
          name,
          description: dto.description?.trim() || null,
          family: dto.family,
          immutable: false,
        }),
      );
      return { profile: savedProfile };
    });

    await this.replaceGrantsAndScopes(profile, sourcePermissions, sourceScopes);

    await this.audit.record({
      action: 'permission_role_profile.created',
      actorUserId,
      resourceType: 'permission_role_profile',
      resourceId: profile.id,
      metadata: {
        profileName: name,
        family: dto.family,
        clonedFrom: dto.cloneFromProfileId ?? null,
        permissionsGranted: sourcePermissions,
      },
    });

    return this.getProfile(profile.id);
  }

  /** Convenience wrapper: clone an existing role under a new name. */
  async cloneRole(
    sourceProfileId: string,
    name: string,
    actorUserId: string,
    family?: 'installer' | 'office',
  ): Promise<ProfileDetail> {
    const source = await this.findProfileOrThrow(sourceProfileId);
    return this.createRole(
      {
        name,
        description: source.description ?? undefined,
        // `family` is validated strictly at the DTO layer (`IsIn`), so any
        // value reaching here is either 'installer'/'office' or undefined —
        // never a silently-dropped garbage value. Falls back to the source
        // profile's family when the caller doesn't explicitly override it.
        family: (family ??
          source.family ??
          this.defaultFamilyForClone(source)) as 'installer' | 'office',
        cloneFromProfileId: sourceProfileId,
      },
      actorUserId,
    );
  }

  private defaultFamilyForClone(
    source: PermissionRoleProfile,
  ): PermissionRoleProfileFamily {
    return this.isInstallerFamily(source) ? 'installer' : 'office';
  }

  async renameRole(
    id: string,
    dto: RenamePermissionRoleDto,
    actorUserId: string,
  ): Promise<ProfileDetail> {
    const profile = await this.findProfileOrThrow(id);
    this.assertEditable(profile);
    if (profile.kind !== 'staff_role' || !profile.staffRoleId) {
      throw new ForbiddenException(
        'Only admin-authored custom roles can be renamed',
      );
    }
    const updates: Partial<PermissionRoleProfile> = {};
    if (dto.name !== undefined) {
      const trimmed = dto.name.trim();
      await this.ensureStaffRoleNameAvailable(trimmed, profile.staffRoleId);
      updates.name = trimmed;
    }
    if (dto.description !== undefined) {
      updates.description = dto.description.trim() || null;
    }
    if (Object.keys(updates).length === 0) {
      return this.getProfile(profile.id);
    }

    await this.dataSource.transaction(async (manager) => {
      await manager
        .getRepository(PermissionRoleProfile)
        .update(profile.id, updates);
      if (updates.name) {
        await manager
          .getRepository(StaffRole)
          .update(profile.staffRoleId as string, { name: updates.name });
      }
    });

    await this.audit.record({
      action: 'permission_role_profile.renamed',
      actorUserId,
      resourceType: 'permission_role_profile',
      resourceId: profile.id,
      metadata: { ...updates },
    });

    return this.getProfile(profile.id);
  }

  async deleteRole(id: string, actorUserId: string): Promise<{ id: string }> {
    const profile = await this.findProfileOrThrow(id);
    this.assertEditable(profile);
    if (profile.kind !== 'staff_role' || !profile.staffRoleId) {
      throw new ForbiddenException(
        'Only admin-authored custom roles can be deleted',
      );
    }
    if (!(await this.isProfileDeletable(profile))) {
      throw new ConflictException(
        'This role is still assigned to one or more staff members — reassign them before deleting it',
      );
    }

    await this.dataSource.transaction(async (manager) => {
      await manager
        .getRepository(PermissionRoleGrant)
        .delete({ profileId: profile.id });
      await manager
        .getRepository(PermissionRoleScope)
        .delete({ profileId: profile.id });
      await manager.getRepository(PermissionRoleProfile).delete(profile.id);
      await manager
        .getRepository(StaffRole)
        .delete(profile.staffRoleId as string);
    });

    await this.audit.record({
      action: 'permission_role_profile.deleted',
      actorUserId,
      resourceType: 'permission_role_profile',
      resourceId: profile.id,
      metadata: { profileName: profile.name },
    });

    return { id: profile.id };
  }

  private async ensureStaffRoleNameAvailable(
    name: string,
    excludeStaffRoleId?: string,
  ): Promise<void> {
    const query = this.staffRoles
      .createQueryBuilder('role')
      .where('LOWER(role.name) = LOWER(:name)', { name });
    if (excludeStaffRoleId) {
      query.andWhere('role.id != :excludeId', {
        excludeId: excludeStaffRoleId,
      });
    }
    const existing = await query.getOne();
    if (existing) {
      throw new BadRequestException('A role with this name already exists');
    }
  }

  async updateProfile(
    id: string,
    dto: UpdatePermissionRoleDto,
    actorUserId: string,
  ): Promise<ProfileDetail> {
    const profile = await this.findProfileOrThrow(id);
    this.assertEditable(profile);

    if (dto.expectedUpdatedAt) {
      const expected = new Date(dto.expectedUpdatedAt).getTime();
      const actual = profile.updatedAt.getTime();
      if (Number.isNaN(expected) || expected !== actual) {
        throw new ConflictException(
          'This role profile was changed by someone else since you loaded it. Reload and reapply your changes.',
        );
      }
    }

    const previousPermissions = this.enabledPermissions(profile);
    const previousScopes = this.scopeMap(profile);
    const permissions = this.validatePermissionPatch(dto.permissions);
    const scopePatch = this.validateScopePatch(dto.scopes);
    const nextPermissions = permissions ?? previousPermissions;
    const nextScopes = {
      ...previousScopes,
      ...(scopePatch ?? {}),
    };

    this.validateProfileRules(profile, nextPermissions, nextScopes);
    await this.replaceGrantsAndScopes(profile, nextPermissions, nextScopes);

    // Key-level diff so the audit log can answer "which permission changed",
    // not just "permissions changed" — the earlier version only recorded the
    // latter, which made the log useless for investigating a specific grant.
    const prevSet = new Set(previousPermissions);
    const nextSet = new Set(nextPermissions);
    const permissionsGranted = nextPermissions.filter((k) => !prevSet.has(k));
    const permissionsRevoked = previousPermissions.filter(
      (k) => !nextSet.has(k),
    );
    const scopesChanged = Object.keys(scopePatch ?? {}).filter(
      (resource) =>
        previousScopes[resource as PermissionScopeResource] !==
        nextScopes[resource as PermissionScopeResource],
    );

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
        permissionsGranted,
        permissionsRevoked,
        scopesChanged,
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
    const permissions = await this.applyOverrides(
      user.id,
      this.enabledPermissions(profile),
    );
    return {
      userId: user.id,
      role: user.role,
      baseRole: user.role,
      profileId: profile.id,
      profile: this.profileBase(profile),
      permissions,
      scopes: this.scopeMap(profile),
      fixedAdminCapabilities: [],
    };
  }

  /**
   * Per-user override layer (point 5e): overrides always win over the
   * role-profile grant for that key. `enabled: true` adds a permission the
   * role doesn't carry; `enabled: false` revokes one it does.
   */
  private async applyOverrides(
    userId: string,
    basePermissions: PermissionKey[],
  ): Promise<PermissionKey[]> {
    const rows = await this.overrides.find({ where: { userId } });
    if (rows.length === 0) {
      return basePermissions;
    }
    const result = new Set(basePermissions);
    for (const row of rows) {
      if (!isPermissionKey(row.permissionKey)) continue;
      if (row.enabled) {
        result.add(row.permissionKey);
      } else {
        result.delete(row.permissionKey);
      }
    }
    return [...result];
  }

  async listOverrides(
    userId: string,
  ): Promise<{ permissionKey: PermissionKey; enabled: boolean }[]> {
    const rows = await this.overrides.find({ where: { userId } });
    return rows
      .filter((row) => isPermissionKey(row.permissionKey))
      .map((row) => ({
        permissionKey: row.permissionKey,
        enabled: row.enabled,
      }));
  }

  /**
   * Set (or clear, when `enabled === null`) a single per-user override.
   * Delegation permission: only callable from a route gated on
   * `staff:override:manage`, and every change is audited with actor,
   * target, key, and before/after value.
   */
  async setOverride(
    targetUserId: string,
    permissionKey: string,
    enabled: boolean | null,
    actorUserId: string,
  ): Promise<void> {
    if (!isPermissionKey(permissionKey)) {
      throw new BadRequestException('Unknown permission key');
    }
    const target = await this.users.findOne({ where: { id: targetUserId } });
    if (!target) {
      throw new NotFoundException('User not found');
    }
    if (target.role === UserRole.ADMIN) {
      throw new BadRequestException(
        'Admins already hold every permission; overrides do not apply',
      );
    }

    const existing = await this.overrides.findOne({
      where: { userId: targetUserId, permissionKey },
    });
    const previousValue = existing ? existing.enabled : null;

    // Reconciliation rule (documented in docs/API_CONTRACT.md): an override
    // must satisfy the same structural invariants `validateProfileRules`
    // enforces on the role-profile editor — e.g. an installer-family
    // profile cannot receive invoice permissions via the profile editor, so
    // it cannot receive them via a per-user override either. Without this,
    // the override layer would be strictly more powerful than the editor it
    // sits beside, and could put a user in a state the editor explicitly
    // forbids. `enabled: null` (clearing an override) never needs this
    // check — it can only remove a grant, never add one the profile
    // forbids.
    if (enabled !== null) {
      const profile = await this.resolveProfileForUser(target);
      const basePermissions = this.enabledPermissions(profile);
      const projected = new Set(basePermissions);
      if (enabled) {
        projected.add(permissionKey);
      } else {
        projected.delete(permissionKey);
      }
      this.validateProfileRules(profile, [...projected], this.scopeMap(profile));
    }

    if (enabled === null) {
      if (existing) {
        await this.overrides.delete({ id: existing.id });
      }
    } else if (existing) {
      await this.overrides.update({ id: existing.id }, { enabled });
    } else {
      await this.overrides.save(
        this.overrides.create({
          userId: targetUserId,
          permissionKey,
          enabled,
          grantedByUserId: actorUserId,
        }),
      );
    }

    await this.audit.record({
      action: 'permission_override.set',
      actorUserId,
      resourceType: 'user',
      resourceId: targetUserId,
      metadata: {
        permissionKey,
        previousValue,
        newValue: enabled,
      },
    });
  }

  /**
   * Clears all per-user overrides for a user. Mirrors ServiceTitan's "system
   * updates reset individual permissions to match the role" — call this
   * whenever a user's `role`/staffType changes so overrides never silently
   * outlive the profile they were layered on.
   */
  async clearOverridesForUser(
    targetUserId: string,
    actorUserId: string,
  ): Promise<void> {
    const rows = await this.overrides.find({ where: { userId: targetUserId } });
    if (rows.length === 0) return;
    await this.overrides.delete({ userId: targetUserId });
    await this.audit.record({
      action: 'permission_override.cleared_on_role_change',
      actorUserId,
      resourceType: 'user',
      resourceId: targetUserId,
      metadata: { clearedKeys: rows.map((r) => r.permissionKey) },
    });
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
    // EMPLOYEE (non-technical staff) previously had no builtin profile at
    // all, so resolveProfileForUser 404'd for every employee-role user —
    // a whole-role outage once callers (e.g. the web app's route guards)
    // started treating "no profile" as "denied". Every UserRole must have a
    // profile row; there is no such thing as a role with an undefined
    // permission set.
    await this.ensureBuiltinProfile(UserRole.EMPLOYEE, 'Employee', false);

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
    await this.syncMissingDefaultGrants(profile, role);
    return profile;
  }

  private async syncMissingDefaultGrants(
    profile: PermissionRoleProfile,
    role: UserRole,
  ): Promise<void> {
    const expected = new Set(DEFAULT_PERMISSIONS_BY_ROLE[role]);
    const enabled = new Set(this.enabledPermissions(profile));
    const missing = [...expected].filter((key) => !enabled.has(key));
    if (missing.length === 0) {
      return;
    }
    await this.grants.save(
      missing.map((permissionKey) =>
        this.grants.create({
          profileId: profile.id,
          permissionKey,
          enabled: true,
        }),
      ),
    );
  }

  private async ensureStaffRoleProfile(
    role: StaffRole,
  ): Promise<PermissionRoleProfile> {
    let profile = await this.profiles.findOne({
      where: { staffRoleId: role.id },
      relations: { grants: true, scopes: true },
    });
    if (!profile) {
      // This path only runs for a StaffRole that has no profile yet and
      // wasn't created through PermissionsService#createRole (e.g. a
      // pre-existing installer technical role, or one created directly via
      // StaffService#createRole before role authoring existed) — those are
      // always installer-family, matching the original hardcoded behavior.
      // Roles created through #createRole already have their profile (and
      // family) set up before the StaffRole row is visible here.
      profile = await this.profiles.save(
        this.profiles.create({
          kind: 'staff_role',
          builtinRole: null,
          staffRoleId: role.id,
          name: role.name,
          family: 'installer',
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

  /**
   * Family of the permission profile backing a StaffRole — used by
   * `StaffService#resolveStaffRole` to decide whether a manager/installer
   * may be assigned that role. Defaults to `'installer'` for any legacy row
   * that predates the `family` column.
   */
  async getStaffRoleFamily(
    staffRoleId: string,
  ): Promise<PermissionRoleProfileFamily> {
    const profile = await this.profiles.findOne({
      where: { staffRoleId },
    });
    return profile?.family ?? 'installer';
  }

  private async resolveProfileForUser(
    user: User,
  ): Promise<PermissionRoleProfile> {
    // MANAGER users can only ever be assigned an "office"-family staff role
    // (enforced by StaffService#resolveStaffRole at write time — see the
    // comment there); INSTALLER can only be assigned installer-family. This
    // check re-derives the family here too rather than trusting the write
    // path alone, since it's cheap and this is the one place that decides
    // what a user's permissions actually are.
    if (
      (user.role === UserRole.INSTALLER || user.role === UserRole.MANAGER) &&
      user.staffRoleId
    ) {
      const staffRole = await this.staffRoles.findOne({
        where: { id: user.staffRoleId },
      });
      if (staffRole) {
        const profile = await this.ensureStaffRoleProfile(staffRole);
        const expectedFamily =
          user.role === UserRole.MANAGER ? 'office' : 'installer';
        if ((profile.family ?? 'installer') === expectedFamily) {
          return profile;
        }
        // Family mismatch (e.g. a role's family was changed after
        // assignment) — fall through to the builtin default rather than
        // handing back a mis-classified profile.
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

  /**
   * Delete-then-insert across two tables (`PermissionRoleGrant`,
   * `PermissionRoleScope`) — wrapped in a transaction so a failure mid-write
   * (e.g. a DB error on the insert half) cannot leave a role profile with
   * its grants deleted and nothing re-inserted in their place.
   */
  private async replaceGrantsAndScopes(
    profile: PermissionRoleProfile,
    permissions: PermissionKey[],
    scopes: Partial<Record<PermissionScopeResource, PermissionScopeValue>>,
  ): Promise<void> {
    const uniquePermissions = Array.from(new Set(permissions));
    const scopeRowsInput = Object.entries(scopes).filter(
      (entry): entry is [PermissionScopeResource, PermissionScopeValue] =>
        Boolean(entry[1]),
    );

    await this.dataSource.transaction(async (manager) => {
      const grantsRepo = manager.getRepository(PermissionRoleGrant);
      const scopesRepo = manager.getRepository(PermissionRoleScope);

      await grantsRepo.delete({ profileId: profile.id });
      if (uniquePermissions.length > 0) {
        await grantsRepo.save(
          uniquePermissions.map((permissionKey) =>
            grantsRepo.create({
              profileId: profile.id,
              permissionKey,
              enabled: true,
            }),
          ),
        );
      }

      await scopesRepo.delete({ profileId: profile.id });
      const scopeRows = scopeRowsInput.map(([resource, scope]) =>
        scopesRepo.create({
          profileId: profile.id,
          resource,
          scope,
        }),
      );
      if (scopeRows.length > 0) {
        await scopesRepo.save(scopeRows);
      }
    });
  }

  /**
   * `replaceGrantsAndScopes` is delete-then-insert, so a caller sending only
   * the keys it wants to *change* would silently wipe every grant not
   * mentioned in the body. To make that destructive interpretation
   * impossible to trigger by accident, a permissions patch must be the full
   * catalog map (every key in PERMISSION_KEYS present with an explicit
   * boolean) — a partial/delta body is rejected outright rather than
   * silently narrowed.
   */
  private validatePermissionPatch(
    permissions: Record<string, boolean> | undefined,
  ): PermissionKey[] | null {
    if (permissions === undefined) return null;
    const enabled: PermissionKey[] = [];
    const seen = new Set<string>();
    for (const [key, value] of Object.entries(permissions)) {
      if (!isPermissionKey(key)) {
        throw new BadRequestException(`Unknown permission key: ${key}`);
      }
      if (typeof value !== 'boolean') {
        throw new BadRequestException(
          `Permission value must be boolean: ${key}`,
        );
      }
      seen.add(key);
      if (value) enabled.push(key);
    }
    const missing = PERMISSION_KEYS.filter((key) => !seen.has(key));
    if (missing.length > 0) {
      throw new BadRequestException(
        `permissions must include every catalog key (this is a full-replace write, not a delta) — missing: ${missing.join(', ')}`,
      );
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

  /**
   * Was: `kind === 'staff_role'` unconditionally true, which meant every
   * `staff_role`-kind profile — including any future admin-authored custom
   * role, since role authoring had no other place to live — was
   * permanently barred from `invoice:*` keys by `validateProfileRules`
   * below. That was a structural ceiling on the permission model (an
   * inexpressible role), not a real business rule. Now keyed on the
   * explicit `family` column: `staff_role`-kind profiles default to
   * `'installer'` (preserving the original behavior for every
   * pre-existing/legacy technical staff role) but an admin can author a
   * `family: 'office'` role via `createRole`/`cloneRole` that is exempt
   * from the installer-only constraints below.
   */
  private isInstallerFamily(profile: PermissionRoleProfile): boolean {
    if (profile.builtinRole === UserRole.INSTALLER) return true;
    if (profile.builtinRole) return false;
    return (profile.family ?? 'installer') === 'installer';
  }

  private profileBase(profile: PermissionRoleProfile) {
    return {
      id: profile.id,
      kind: profile.kind,
      builtinRole: profile.builtinRole,
      staffRoleId: profile.staffRoleId,
      name: profile.name,
      description: profile.description ?? null,
      family: profile.family ?? null,
      immutable: profile.immutable,
    };
  }

  /**
   * A role is deletable only if it's a non-builtin, admin-authored profile
   * (`kind === 'staff_role'`, never immutable) AND no active user is
   * currently assigned it via `staffRoleId` — deleting out from under an
   * assigned user would silently strip them down to whatever
   * `resolveProfileForUser` falls back to, which is exactly the kind of
   * surprise this method exists to prevent.
   */
  private async isProfileDeletable(
    profile: PermissionRoleProfile,
  ): Promise<boolean> {
    if (profile.kind !== 'staff_role' || !profile.staffRoleId) return false;
    // `User.deletedAt` is a plain column, not a `@DeleteDateColumn`, so
    // TypeORM's default `.count()`/`.find()` do NOT auto-exclude
    // soft-deleted rows the way they would with a real soft-delete column.
    // Without the explicit `deletedAt: IsNull()` filter, a role whose only
    // assignee was later soft-deleted would count as "still assigned"
    // forever, making the role permanently undeletable.
    const assignedCount = await this.users.count({
      where: { staffRoleId: profile.staffRoleId, deletedAt: IsNull() },
    });
    return assignedCount === 0;
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

  private async toProfileDetail(
    profile: PermissionRoleProfile,
  ): Promise<ProfileDetail> {
    const enabled = new Set(this.enabledPermissions(profile));
    return {
      ...this.profileBase(profile),
      deletable: await this.isProfileDeletable(profile),
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
