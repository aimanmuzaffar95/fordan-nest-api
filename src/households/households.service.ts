import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Not, Repository } from 'typeorm';
import { Customer } from '../customers/entities/customer.entity';
import { UserRole } from '../users/entities/user-role.enum';
import { RuntimeSettingsService } from '../runtime-settings/runtime-settings.service';
import { isFeatureEnabled } from '../feature-flags/feature-flags.config';
import { SystemAuditLogService } from '../system-audit/system-audit-log.service';
import {
  compareAddressKeys,
  normalizeAddressKey,
  type HouseholdMatchStrength,
} from './address-normalize.util';
import { CustomerMergeLog } from './entities/customer-merge-log.entity';

export type DuplicateCandidate = {
  customerId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address: string | null;
  strength: HouseholdMatchStrength | 'email' | 'phone';
  reason: string;
};

/** Tables holding a `customerId` that must follow the survivor on a merge. */
const REPARENT_TABLES: Array<{ table: string; column: string }> = [
  { table: 'jobs', column: 'customerId' },
  { table: 'invoices', column: 'customerId' },
  { table: 'customer_audit_logs', column: 'customerId' },
];

function digitsOnly(value: string | null | undefined): string {
  return (value ?? '').replace(/\D/g, '');
}

@Injectable()
export class HouseholdsService {
  private readonly logger = new Logger(HouseholdsService.name);

  constructor(
    @InjectRepository(Customer)
    private readonly customerRepo: Repository<Customer>,
    @InjectRepository(CustomerMergeLog)
    private readonly mergeLogRepo: Repository<CustomerMergeLog>,
    private readonly dataSource: DataSource,
    private readonly settings: RuntimeSettingsService,
    private readonly systemAudit: SystemAuditLogService,
  ) {}

  private async assertEnabled(role: UserRole): Promise<void> {
    const flags = await this.settings.getFeatureFlags();
    if (!isFeatureEnabled(flags, 'householdMatching', role)) {
      throw new ForbiddenException(
        'Household matching is not enabled for your role',
      );
    }
  }

  /** Recompute and persist a customer's household key. Safe to call anytime. */
  async refreshHouseholdKey(customerId: string): Promise<string | null> {
    const customer = await this.customerRepo.findOne({
      where: { id: customerId },
    });
    if (!customer) return null;
    const key = normalizeAddressKey(customer.address);
    if (key !== customer.householdKey) {
      await this.customerRepo.update({ id: customerId }, { householdKey: key });
    }
    return key;
  }

  /**
   * Possible duplicates of `customerId`, strongest first.
   *
   * Matches on three independent signals — exact email, same phone digits, and
   * household address key — because real duplicates rarely agree on all three
   * (that's what made them duplicates).
   */
  async findDuplicates(
    customerId: string,
    role: UserRole,
  ): Promise<DuplicateCandidate[]> {
    await this.assertEnabled(role);

    const subject = await this.customerRepo.findOne({
      where: { id: customerId },
    });
    if (!subject)
      throw new NotFoundException(`Customer ${customerId} not found`);

    const key = subject.householdKey ?? normalizeAddressKey(subject.address);
    const subjectPhone = digitsOnly(subject.phone);

    // Only consider records that haven't already been merged away.
    const others = await this.customerRepo.find({
      where: { mergedIntoCustomerId: IsNull() },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        secondaryPhone: true,
        address: true,
        householdKey: true,
      },
      take: 5000,
    });

    const candidates: DuplicateCandidate[] = [];

    for (const other of others) {
      if (other.id === customerId) continue;

      const base = {
        customerId: other.id,
        firstName: other.firstName,
        lastName: other.lastName,
        email: other.email,
        phone: other.phone,
        address: other.address,
      };

      if (
        other.email &&
        subject.email &&
        other.email.toLowerCase() === subject.email.toLowerCase()
      ) {
        candidates.push({
          ...base,
          strength: 'email',
          reason: 'Same email address',
        });
        continue;
      }

      const otherPhones = [
        digitsOnly(other.phone),
        digitsOnly(other.secondaryPhone),
      ];
      if (
        subjectPhone.length >= 8 &&
        otherPhones.some((p) => p.length >= 8 && p === subjectPhone)
      ) {
        candidates.push({
          ...base,
          strength: 'phone',
          reason: 'Same phone number',
        });
        continue;
      }

      const otherKey = other.householdKey ?? normalizeAddressKey(other.address);
      const strength = compareAddressKeys(key, otherKey);
      if (strength) {
        candidates.push({
          ...base,
          strength,
          reason:
            strength === 'exact'
              ? 'Identical property address'
              : strength === 'strong'
                ? 'Same street number and street'
                : 'Similar address',
        });
      }
    }

    const order: Record<DuplicateCandidate['strength'], number> = {
      email: 0,
      exact: 1,
      phone: 2,
      strong: 3,
      weak: 4,
    };
    return candidates.sort((a, b) => order[a.strength] - order[b.strength]);
  }

  /** Everyone at the same normalised address (the household view). */
  async householdMembers(
    customerId: string,
    role: UserRole,
  ): Promise<DuplicateCandidate[]> {
    await this.assertEnabled(role);
    const subject = await this.customerRepo.findOne({
      where: { id: customerId },
    });
    if (!subject)
      throw new NotFoundException(`Customer ${customerId} not found`);
    const key = subject.householdKey ?? normalizeAddressKey(subject.address);
    if (!key) return [];

    const members = await this.customerRepo.find({
      where: { householdKey: key, mergedIntoCustomerId: IsNull() },
    });
    return members
      .filter((m) => m.id !== customerId)
      .map((m) => ({
        customerId: m.id,
        firstName: m.firstName,
        lastName: m.lastName,
        email: m.email,
        phone: m.phone,
        address: m.address,
        strength: 'exact' as const,
        reason: 'Same household address',
      }));
  }

  /**
   * Merge `mergedCustomerId` into `survivorCustomerId`.
   *
   * Admin-only and transactional. The losing record is soft-retired rather
   * than deleted: its id is referenced by audit logs and possibly by external
   * systems, and a merge must stay reversible by hand.
   */
  async merge(params: {
    survivorCustomerId: string;
    mergedCustomerId: string;
    reason?: string | null;
    actorUserId: string;
    role: UserRole;
  }): Promise<{
    survivorCustomerId: string;
    mergedCustomerId: string;
    movedCounts: Record<string, number>;
    filledFields: string[];
  }> {
    await this.assertEnabled(params.role);
    if (params.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Only admins can merge customers');
    }
    if (params.survivorCustomerId === params.mergedCustomerId) {
      throw new BadRequestException('A customer cannot be merged into itself');
    }

    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(Customer);
      const survivor = await repo.findOne({
        where: { id: params.survivorCustomerId },
      });
      const merged = await repo.findOne({
        where: { id: params.mergedCustomerId },
      });
      if (!survivor) {
        throw new NotFoundException(
          `Customer ${params.survivorCustomerId} not found`,
        );
      }
      if (!merged) {
        throw new NotFoundException(
          `Customer ${params.mergedCustomerId} not found`,
        );
      }
      if (merged.mergedIntoCustomerId) {
        throw new BadRequestException(
          'That customer has already been merged into another record',
        );
      }
      if (survivor.mergedIntoCustomerId) {
        throw new BadRequestException(
          'The survivor has itself been merged away; merge into the surviving record instead',
        );
      }

      const snapshot: Record<string, unknown> = { ...merged };

      // Reparent child rows by raw UPDATE: TypeORM cascades would need every
      // entity loaded, and these tables are append-heavy.
      const movedCounts: Record<string, number> = {};
      for (const { table, column } of REPARENT_TABLES) {
        const hasTable = await manager.queryRunner?.hasTable(table);
        if (hasTable === false) continue;
        const quote = (name: string) =>
          manager.connection.options.type === 'postgres'
            ? `"${name}"`
            : `\`${name}\``;
        const result: unknown = await manager.query(
          `UPDATE ${quote(table)} SET ${quote(column)} = ${
            manager.connection.options.type === 'postgres' ? '$1' : '?'
          } WHERE ${quote(column)} = ${
            manager.connection.options.type === 'postgres' ? '$2' : '?'
          }`,
          [params.survivorCustomerId, params.mergedCustomerId],
        );
        movedCounts[table] = extractAffected(result);
      }

      // Fill blanks on the survivor from the merged record — never overwrite.
      const fillable: Array<keyof Customer> = [
        'address',
        'lat',
        'lng',
        'secondaryPhone',
        'acquisitionSource',
        'acquisitionSourceOther',
        'leadSource',
        'leadMedium',
        'leadCampaign',
        'leadFormSlug',
        'leadPageReferrer',
        'leadSelfReportedSource',
        'leadOwnerUserId',
        'qualificationScore',
        'qualificationAnswers',
      ];
      const filledFields: string[] = [];
      for (const field of fillable) {
        const current = survivor[field];
        const incoming = merged[field];
        if (
          (current === null || current === undefined || current === '') &&
          incoming !== null &&
          incoming !== undefined &&
          incoming !== ''
        ) {
          (survivor as unknown as Record<string, unknown>)[field] = incoming;
          filledFields.push(String(field));
        }
      }

      // Keep the earliest capture date — the household's true first touch.
      if (
        merged.leadCapturedAt &&
        (!survivor.leadCapturedAt ||
          merged.leadCapturedAt < survivor.leadCapturedAt)
      ) {
        survivor.leadCapturedAt = merged.leadCapturedAt;
        filledFields.push('leadCapturedAt');
      }

      survivor.leadOwnershipHistory = [
        ...(survivor.leadOwnershipHistory ?? []),
        ...(merged.leadOwnershipHistory ?? []),
      ].sort((a, b) => a.assignedAt.localeCompare(b.assignedAt));

      survivor.householdKey = normalizeAddressKey(survivor.address);
      await repo.save(survivor);

      // Retire the loser. Its unique email must be freed so the address can be
      // re-used, so it is suffixed rather than cleared (the column is NOT NULL).
      merged.mergedIntoCustomerId = survivor.id;
      merged.mergedAt = new Date();
      merged.email = `merged+${merged.id}@invalid.local`;
      await repo.save(merged);

      await manager.getRepository(CustomerMergeLog).save(
        manager.getRepository(CustomerMergeLog).create({
          survivorCustomerId: survivor.id,
          mergedCustomerId: params.mergedCustomerId,
          performedByUserId: params.actorUserId,
          reason: params.reason ?? null,
          mergedSnapshot: snapshot,
          movedCounts,
          filledFields,
        }),
      );

      this.logger.log(
        `Merged customer ${params.mergedCustomerId} into ${survivor.id}`,
      );

      return {
        survivorCustomerId: survivor.id,
        mergedCustomerId: params.mergedCustomerId,
        movedCounts,
        filledFields,
      };
    });
  }

  async mergeHistory(customerId: string, role: UserRole) {
    await this.assertEnabled(role);
    return this.mergeLogRepo.find({
      where: [
        { survivorCustomerId: customerId },
        { mergedCustomerId: customerId },
      ],
      order: { createdAt: 'DESC' },
      take: 50,
    });
  }

  /** Backfill household keys for records that don't have one yet. */
  async backfillHouseholdKeys(limit = 1000): Promise<{ updated: number }> {
    const rows = await this.customerRepo.find({
      where: { householdKey: IsNull(), address: Not(IsNull()) },
      select: { id: true, address: true },
      take: limit,
    });
    let updated = 0;
    for (const row of rows) {
      const key = normalizeAddressKey(row.address);
      if (!key) continue;
      await this.customerRepo.update({ id: row.id }, { householdKey: key });
      updated += 1;
    }
    if (updated > 0) {
      await this.systemAudit.record({
        action: 'HOUSEHOLD_KEYS_BACKFILLED',
        actorUserId: null,
        resourceType: 'customers',
        resourceId: null,
        metadata: { updated },
      });
    }
    return { updated };
  }
}

/** Driver-specific affected-row count from a raw UPDATE. */
function extractAffected(result: unknown): number {
  if (Array.isArray(result)) {
    // MySQL/MariaDB return [rows, fieldsWithAffectedRows]; Postgres returns
    // [rows, rowCount].
    const second: unknown = result[1];
    if (typeof second === 'number') return second;
    if (second && typeof second === 'object') {
      const meta = second as { affectedRows?: number };
      if (typeof meta.affectedRows === 'number') return meta.affectedRows;
    }
    return 0;
  }
  if (result && typeof result === 'object') {
    const r = result as { affectedRows?: number; rowCount?: number };
    return r.affectedRows ?? r.rowCount ?? 0;
  }
  return 0;
}
