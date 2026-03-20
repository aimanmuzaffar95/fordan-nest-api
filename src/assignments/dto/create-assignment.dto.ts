import { IsDateString, IsIn, IsUUID } from 'class-validator';

export class CreateAssignmentDto {
  @IsDateString()
  scheduledDate!: string;

  @IsIn(['AM', 'PM'])
  slot!: 'AM' | 'PM';

  @IsUUID()
  teamId!: string;

  @IsUUID()
  staffUserId!: string;
}
