import { BadRequestException } from '@nestjs/common';
import { UserRole } from '../users/entities/user-role.enum';
import {
  defaultFeatureFlags,
  isFeatureEnabled,
  mergeFeatureFlags,
  mergeFeatureFlagsPatch,
  resolveFeatureFlagsForRole,
  validateFeatureFlags,
} from './feature-flags.config';

describe('feature flags config', () => {
  it('defaults the Phase 0 enablers on and later phases off', () => {
    const flags = defaultFeatureFlags();
    expect(flags.taskEngine.enabled).toBe(true);
    expect(flags.pipelineStageTemplates.enabled).toBe(true);
    expect(flags.leadAttribution.enabled).toBe(true);
    expect(flags.customerPortal.enabled).toBe(false);
    expect(flags.projectSplit.enabled).toBe(false);
  });

  it('falls back to defaults for junk stored values', () => {
    expect(mergeFeatureFlags(null)).toEqual(defaultFeatureFlags());
    expect(mergeFeatureFlags('nope')).toEqual(defaultFeatureFlags());
    expect(mergeFeatureFlags([])).toEqual(defaultFeatureFlags());
  });

  it('accepts a bare boolean as shorthand for an all-roles flag', () => {
    const flags = mergeFeatureFlags({ customerPortal: true });
    expect(flags.customerPortal).toEqual({ enabled: true, roles: [] });
  });

  it('drops unknown roles when merging stored state', () => {
    const flags = mergeFeatureFlags({
      commission: { enabled: true, roles: ['admin', 'wizard'] },
    });
    expect(flags.commission.roles).toEqual([UserRole.ADMIN]);
  });

  it('patches only the supplied keys', () => {
    const current = defaultFeatureFlags();
    const next = mergeFeatureFlagsPatch(current, {
      taskEngine: { enabled: false, roles: [] },
    });
    expect(next.taskEngine.enabled).toBe(false);
    expect(next.leadAttribution).toEqual(current.leadAttribution);
  });

  it('rejects unknown flag keys in a patch', () => {
    expect(() =>
      mergeFeatureFlagsPatch(defaultFeatureFlags(), { timeTravel: true }),
    ).toThrow(BadRequestException);
  });

  it('rejects a non-object patch', () => {
    expect(() => mergeFeatureFlagsPatch(defaultFeatureFlags(), [])).toThrow(
      BadRequestException,
    );
  });

  it('validates role lists', () => {
    const flags = defaultFeatureFlags();
    flags.commission = {
      enabled: true,
      roles: ['nope' as unknown as UserRole],
    };
    expect(() => validateFeatureFlags(flags)).toThrow(BadRequestException);
  });

  describe('role resolution', () => {
    it('treats an empty role list as every role', () => {
      const flags = mergeFeatureFlags({
        commission: { enabled: true, roles: [] },
      });
      expect(isFeatureEnabled(flags, 'commission', UserRole.INSTALLER)).toBe(
        true,
      );
      expect(isFeatureEnabled(flags, 'commission')).toBe(true);
    });

    it('limits a flag to its listed roles', () => {
      const flags = mergeFeatureFlags({
        commission: { enabled: true, roles: [UserRole.ADMIN] },
      });
      expect(isFeatureEnabled(flags, 'commission', UserRole.ADMIN)).toBe(true);
      expect(isFeatureEnabled(flags, 'commission', UserRole.MANAGER)).toBe(
        false,
      );
      // A role-scoped flag must not leak to callers with no role context.
      expect(isFeatureEnabled(flags, 'commission')).toBe(false);
    });

    it('keeps a disabled flag off regardless of role list', () => {
      const flags = mergeFeatureFlags({
        commission: { enabled: false, roles: [UserRole.ADMIN] },
      });
      expect(isFeatureEnabled(flags, 'commission', UserRole.ADMIN)).toBe(false);
    });

    it('resolves a flat map for a role', () => {
      const flags = mergeFeatureFlags({
        taskEngine: { enabled: true, roles: [UserRole.ADMIN] },
      });
      const forManager = resolveFeatureFlagsForRole(flags, UserRole.MANAGER);
      expect(forManager.taskEngine).toBe(false);
      expect(forManager.leadAttribution).toBe(true);
    });
  });
});
