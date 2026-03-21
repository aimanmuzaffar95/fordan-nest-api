import { IsBoolean } from 'class-validator';

export class UpdateCalendarScopeEnforcedDto {
  @IsBoolean()
  calendarScopeEnforced!: boolean;
}

