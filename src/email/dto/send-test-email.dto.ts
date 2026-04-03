import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class SendTestEmailDto {
  @ApiProperty({ example: 'you@example.com' })
  @IsEmail()
  to: string;

  @ApiProperty({ example: 'Test email from Fordan CRM' })
  @IsString()
  @MinLength(1)
  subject: string;

  @ApiPropertyOptional({ example: '<p>Hello, this is a test.</p>' })
  @IsOptional()
  @IsString()
  html?: string;

  @ApiPropertyOptional({ example: 'Hello, this is a test.' })
  @IsOptional()
  @IsString()
  text?: string;
}
