import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  Max,
} from 'class-validator';

export class CompletePublicSignatureDto {
  @ApiProperty({
    description:
      'PNG image of the signature (base64, with or without data URL prefix).',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(900000)
  signaturePngBase64: string;

  @ApiProperty({ description: 'Must be true to record intent to sign.' })
  @IsBoolean()
  consentAccepted: boolean;

  @ApiProperty({
    description: 'Must match the consent version returned by the session GET.',
    example: '1',
  })
  @IsString()
  @IsNotEmpty()
  consentVersion: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  geoLatitude?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  geoLongitude?: number;
}
