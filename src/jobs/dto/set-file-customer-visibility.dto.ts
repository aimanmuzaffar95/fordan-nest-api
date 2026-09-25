import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class SetFileCustomerVisibilityDto {
  @ApiProperty({ description: 'Show this file on the customer portal.' })
  @IsBoolean()
  customerVisible!: boolean;
}
