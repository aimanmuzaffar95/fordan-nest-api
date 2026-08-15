import { Customer, type LeadOwnershipEntry } from '../entities/customer.entity';

export class CustomerResponseDto {
  id: string;
  firstName: string;
  lastName: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  phone: string;
  secondaryPhone: string | null;
  email: string;
  acquisitionSource: string | null;
  acquisitionSourceOther: string | null;
  leadSource: string | null;
  leadMedium: string | null;
  leadCampaign: string | null;
  leadFormSlug: string | null;
  leadPageReferrer: string | null;
  leadSelfReportedSource: string | null;
  leadCapturedAt: Date | null;
  leadOwnerUserId: string | null;
  leadOwnershipHistory: LeadOwnershipEntry[];
  importTariffPerKwh: number | null;
  feedInTariffPerKwh: number | null;
  dailySupplyCharge: number | null;
  averageMonthlyBill: number | null;
  createdAt: Date;
  updatedAt: Date;

  private static parseNullableDecimal(value: unknown): number | null {
    if (value === null || typeof value === 'undefined') {
      return null;
    }

    let numberValue: number;
    if (typeof value === 'number') {
      numberValue = value;
    } else if (typeof value === 'string') {
      numberValue = Number.parseFloat(value);
    } else {
      return null;
    }

    return Number.isFinite(numberValue) ? numberValue : null;
  }

  static fromEntity(entity: Customer): CustomerResponseDto {
    return {
      id: entity.id,
      firstName: entity.firstName,
      lastName: entity.lastName,
      address: entity.address,
      lat: CustomerResponseDto.parseNullableDecimal(entity.lat),
      lng: CustomerResponseDto.parseNullableDecimal(entity.lng),
      phone: entity.phone,
      secondaryPhone: entity.secondaryPhone,
      email: entity.email,
      acquisitionSource: entity.acquisitionSource,
      acquisitionSourceOther: entity.acquisitionSourceOther,
      leadSource: entity.leadSource ?? null,
      leadMedium: entity.leadMedium ?? null,
      leadCampaign: entity.leadCampaign ?? null,
      leadFormSlug: entity.leadFormSlug ?? null,
      leadPageReferrer: entity.leadPageReferrer ?? null,
      leadSelfReportedSource: entity.leadSelfReportedSource ?? null,
      leadCapturedAt: entity.leadCapturedAt ?? null,
      leadOwnerUserId: entity.leadOwnerUserId ?? null,
      leadOwnershipHistory: entity.leadOwnershipHistory ?? [],
      importTariffPerKwh: CustomerResponseDto.parseNullableDecimal(
        entity.importTariffPerKwh,
      ),
      feedInTariffPerKwh: CustomerResponseDto.parseNullableDecimal(
        entity.feedInTariffPerKwh,
      ),
      dailySupplyCharge: CustomerResponseDto.parseNullableDecimal(
        entity.dailySupplyCharge,
      ),
      averageMonthlyBill: CustomerResponseDto.parseNullableDecimal(
        entity.averageMonthlyBill,
      ),
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }
}
