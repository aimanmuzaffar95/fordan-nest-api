import { Customer } from '../entities/customer.entity';

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
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }
}
