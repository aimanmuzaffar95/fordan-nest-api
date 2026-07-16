import { IsString, MinLength } from 'class-validator';

export class McpLoginDto {
  @IsString()
  @MinLength(16)
  key: string;
}
