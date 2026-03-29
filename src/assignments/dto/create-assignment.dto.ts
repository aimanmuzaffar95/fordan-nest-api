import { IsDateString, IsIn, IsOptional, IsUUID } from 'class-validator';

export class CreateAssignmentDto {
  @IsDateString()
  scheduledDate!: string;

  @IsIn(['AM', 'PM'])
  slot!: 'AM' | 'PM';

  @IsOptional()
  @IsUUID()
  teamId?: string;

  @IsUUID()
  staffUserId!: string;
}
