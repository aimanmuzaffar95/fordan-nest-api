import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

export class CreateJobSignatureRequestDto {
  @ApiPropertyOptional({
    description:
      'When true (default), email the customer a signing link. Requires SMTP and `ESIGN_PUBLIC_BASE_URL`.',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  sendEmail?: boolean;
}
