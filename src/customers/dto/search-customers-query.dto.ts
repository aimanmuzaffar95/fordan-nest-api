import { Transform, Type } from 'class-transformer';
import { IsInt, IsString, Max, Min, MinLength } from 'class-validator';

export class SearchCustomersQueryDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  q: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'undefined' ? 1 : Number(value),
  )
  page: number = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'undefined' ? 20 : Number(value),
  )
  limit: number = 20;
}
