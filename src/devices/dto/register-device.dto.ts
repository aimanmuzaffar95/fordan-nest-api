import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';

export class RegisterDeviceDto {
  @IsIn(['ios', 'android', 'web'])
  platform: 'ios' | 'android' | 'web';

  @IsString()
  @MinLength(8)
  @MaxLength(512)
  pushToken: string;
}
