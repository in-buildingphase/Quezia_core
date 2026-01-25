import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class UpdateContextDto {
	@IsOptional()
	@IsUUID()
	activeExamId?: string;

	@IsOptional()
	@IsInt()
	@Min(1900)
	@Max(3000)
	activeExamYear?: number;
}
