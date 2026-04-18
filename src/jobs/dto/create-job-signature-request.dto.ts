import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

export class CreateJobSignatureRequestDto {
  @ApiPropertyOptional({
    description:
      'When true (default), email the customer a signing link. Requires SMTP. Signing links use Settings / ESIGN_PUBLIC_BASE_URL / Origin (localhost) / X-Public-Web-Base-Url.',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  sendEmail?: boolean;
}
