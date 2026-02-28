import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class UpdateContextDto {
  @IsOptional()
  @IsString()
  targetExamId?: string;

  @IsOptional()
  @IsInt()
  @Min(2020)
  @Max(2100)
  targetExamYear?: number;
}
