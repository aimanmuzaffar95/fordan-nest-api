import { Customer } from '../entities/customer.entity';

export class CustomerResponseDto {
  id: string;
  firstName: string;
  lastName: string;
  address: string | null;
  phone: string;
  email: string;
  createdAt: Date;
  updatedAt: Date;

  static fromEntity(entity: Customer): CustomerResponseDto {
    return {
      id: entity.id,
      firstName: entity.firstName,
      lastName: entity.lastName,
      address: entity.address,
      phone: entity.phone,
      email: entity.email,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }
}
