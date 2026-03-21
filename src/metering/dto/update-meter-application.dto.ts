import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateMeterApplicationDto {
  @IsIn(['pending', 'approved', 'rejected'])
  status!: 'pending' | 'approved' | 'rejected';

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  rejectionReason?: string | null;
}
