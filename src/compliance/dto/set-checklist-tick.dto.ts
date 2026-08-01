import { IsBoolean } from 'class-validator';

export class SetChecklistTickDto {
  @IsBoolean()
  done: boolean;
}
