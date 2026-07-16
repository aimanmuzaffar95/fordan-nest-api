import {
  IsBoolean,
  IsEmail,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class UpsertEmployeeFormDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstName: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  surname: string;

  @IsOptional()
  @IsISO8601(
    { strict: false },
    { message: 'dateOfBirth must be a valid date (YYYY-MM-DD)' },
  )
  @MaxLength(20)
  dateOfBirth?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  driversLicenseNo?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(30)
  phoneMobile: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phoneHome?: string;

  @IsEmail()
  @MaxLength(255)
  email: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  homeAddress?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  suburb?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  state?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  postcode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  accountName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  bsb?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  accountNo?: string;

  @IsBoolean()
  hasSuperannuation: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  superFundName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  superMemberNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  emergencyContactName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  emergencyContactRelationship?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  emergencyContactPhoneMobile?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  emergencyContactPhoneHome?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  emergencyContactAddress?: string;
}
