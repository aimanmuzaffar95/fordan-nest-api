import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  OrganizationProfile,
  ORGANIZATION_PROFILE_SINGLETON_ID,
} from './organization-profile.entity';
import { UpdateOrganizationProfileDto } from './dto/update-organization-profile.dto';
import { SystemAuditLogService } from '../system-audit/system-audit-log.service';
import { SYSTEM_AUDIT_ACTION } from '../system-audit/system-audit-action.constants';

export type OrganizationProfilePayload = {
  id: string;
  legalName: string | null;
  tradingName: string | null;
  registeredAddressLine1: string | null;
  registeredAddressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
  billingSameAsRegistered: boolean;
  billingAddressLine1: string | null;
  billingAddressLine2: string | null;
  billingCity: string | null;
  billingState: string | null;
  billingPostalCode: string | null;
  billingCountry: string | null;
  taxIdPrimary: string | null;
  taxIdSecondary: string | null;
  defaultCurrency: string;
  defaultTimezone: string;
  documentsContactName: string | null;
  documentsContactEmail: string | null;
  documentsContactPhone: string | null;
  updatedAt: string;
};

const PROFILE_KEYS: (keyof OrganizationProfilePayload)[] = [
  'legalName',
  'tradingName',
  'registeredAddressLine1',
  'registeredAddressLine2',
  'city',
  'state',
  'postalCode',
  'country',
  'billingSameAsRegistered',
  'billingAddressLine1',
  'billingAddressLine2',
  'billingCity',
  'billingState',
  'billingPostalCode',
  'billingCountry',
  'taxIdPrimary',
  'taxIdSecondary',
  'defaultCurrency',
  'defaultTimezone',
  'documentsContactName',
  'documentsContactEmail',
  'documentsContactPhone',
];

function trimOrNull(v: string | undefined): string | null {
  if (v === undefined) return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

@Injectable()
export class OrganizationProfileService {
  constructor(
    @InjectRepository(OrganizationProfile)
    private readonly repo: Repository<OrganizationProfile>,
    private readonly audit: SystemAuditLogService,
  ) {}

  private toPayload(row: OrganizationProfile): OrganizationProfilePayload {
    return {
      id: row.id,
      legalName: row.legalName,
      tradingName: row.tradingName,
      registeredAddressLine1: row.registeredAddressLine1,
      registeredAddressLine2: row.registeredAddressLine2,
      city: row.city,
      state: row.state,
      postalCode: row.postalCode,
      country: row.country,
      billingSameAsRegistered: row.billingSameAsRegistered,
      billingAddressLine1: row.billingAddressLine1,
      billingAddressLine2: row.billingAddressLine2,
      billingCity: row.billingCity,
      billingState: row.billingState,
      billingPostalCode: row.billingPostalCode,
      billingCountry: row.billingCountry,
      taxIdPrimary: row.taxIdPrimary,
      taxIdSecondary: row.taxIdSecondary,
      defaultCurrency: row.defaultCurrency,
      defaultTimezone: row.defaultTimezone,
      documentsContactName: row.documentsContactName,
      documentsContactEmail: row.documentsContactEmail,
      documentsContactPhone: row.documentsContactPhone,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async getProfile(): Promise<OrganizationProfilePayload> {
    const row = await this.getOrCreate();
    return this.toPayload(row);
  }

  async updateProfile(
    dto: UpdateOrganizationProfileDto,
    updatedByUserId: string,
  ): Promise<OrganizationProfilePayload> {
    if (Object.keys(dto).length === 0) {
      throw new BadRequestException('At least one field is required');
    }

    const before = await this.getOrCreate();
    const beforePayload = this.toPayload(before);

    const row = before;
    if (dto.legalName !== undefined) row.legalName = trimOrNull(dto.legalName);
    if (dto.tradingName !== undefined) row.tradingName = trimOrNull(dto.tradingName);
    if (dto.registeredAddressLine1 !== undefined) {
      row.registeredAddressLine1 = trimOrNull(dto.registeredAddressLine1);
    }
    if (dto.registeredAddressLine2 !== undefined) {
      row.registeredAddressLine2 = trimOrNull(dto.registeredAddressLine2);
    }
    if (dto.city !== undefined) row.city = trimOrNull(dto.city);
    if (dto.state !== undefined) row.state = trimOrNull(dto.state);
    if (dto.postalCode !== undefined) row.postalCode = trimOrNull(dto.postalCode);
    if (dto.country !== undefined) row.country = trimOrNull(dto.country);
    if (dto.billingSameAsRegistered !== undefined) {
      row.billingSameAsRegistered = dto.billingSameAsRegistered;
    }
    if (dto.billingAddressLine1 !== undefined) {
      row.billingAddressLine1 = trimOrNull(dto.billingAddressLine1);
    }
    if (dto.billingAddressLine2 !== undefined) {
      row.billingAddressLine2 = trimOrNull(dto.billingAddressLine2);
    }
    if (dto.billingCity !== undefined) row.billingCity = trimOrNull(dto.billingCity);
    if (dto.billingState !== undefined) row.billingState = trimOrNull(dto.billingState);
    if (dto.billingPostalCode !== undefined) {
      row.billingPostalCode = trimOrNull(dto.billingPostalCode);
    }
    if (dto.billingCountry !== undefined) {
      row.billingCountry = trimOrNull(dto.billingCountry);
    }
    if (dto.taxIdPrimary !== undefined) row.taxIdPrimary = trimOrNull(dto.taxIdPrimary);
    if (dto.taxIdSecondary !== undefined) {
      row.taxIdSecondary = trimOrNull(dto.taxIdSecondary);
    }
    if (dto.defaultCurrency !== undefined) {
      row.defaultCurrency = dto.defaultCurrency.trim().toUpperCase();
    }
    if (dto.defaultTimezone !== undefined) {
      row.defaultTimezone = dto.defaultTimezone.trim();
    }
    if (dto.documentsContactName !== undefined) {
      row.documentsContactName = trimOrNull(dto.documentsContactName);
    }
    if (dto.documentsContactEmail !== undefined) {
      row.documentsContactEmail = trimOrNull(dto.documentsContactEmail);
    }
    if (dto.documentsContactPhone !== undefined) {
      row.documentsContactPhone = trimOrNull(dto.documentsContactPhone);
    }

    row.updatedByUserId = updatedByUserId;
    const saved = await this.repo.save(row);
    const afterPayload = this.toPayload(saved);

    const changedFields = PROFILE_KEYS.filter(
      (k) => beforePayload[k] !== afterPayload[k],
    );

    if (changedFields.length > 0) {
      await this.audit.record({
        action: SYSTEM_AUDIT_ACTION.ORG_PROFILE_UPDATED,
        actorUserId: updatedByUserId,
        resourceType: 'organization_profile',
        resourceId: ORGANIZATION_PROFILE_SINGLETON_ID,
        metadata: { changedFields },
      });
    }

    return afterPayload;
  }

  private async getOrCreate(): Promise<OrganizationProfile> {
    let row = await this.repo.findOne({
      where: { id: ORGANIZATION_PROFILE_SINGLETON_ID },
    });
    if (!row) {
      row = this.repo.create({
        id: ORGANIZATION_PROFILE_SINGLETON_ID,
        billingSameAsRegistered: true,
        defaultCurrency: 'AUD',
        defaultTimezone: 'Australia/Sydney',
      });
      row = await this.repo.save(row);
    }
    return row;
  }
}
