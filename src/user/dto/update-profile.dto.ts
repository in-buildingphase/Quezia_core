import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class UpdateContextDto {
	@IsOptional()
	@IsString()
	targetExamId?: string;

	@IsOptional()
	@IsInt()
	@Min(1900)
	@Max(3000)
	targetExamYear?: number;
}
