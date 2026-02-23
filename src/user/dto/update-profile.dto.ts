import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Max, Min, IsObject, IsArray } from 'class-validator';
import { PreparationStage, Difficulty } from '@prisma/client';

export class UpdateProfileDto {
	@IsOptional()
	@IsString()
	fullName?: string;

	@IsOptional()
	@IsString()
	displayName?: string;

	@IsOptional()
	@IsString()
	avatarUrl?: string;

	@IsOptional()
	@IsString()
	country?: string;

	@IsOptional()
	@IsString()
	timezone?: string;

	@IsOptional()
	@IsString()
	targetExamId?: string;

	@IsOptional()
	@IsInt()
	@Min(2020)
	@Max(2100)
	targetExamYear?: number;

	@IsOptional()
	@IsEnum(PreparationStage)
	preparationStage?: PreparationStage;

	@IsOptional()
	@IsString()
	studyGoal?: string;

	@IsOptional()
	@IsArray()
	@IsString({ each: true })
	preferredSubjects?: string[];

	@IsOptional()
	@IsBoolean()
	onboardingCompleted?: boolean;

	@IsOptional()
	@IsInt()
	onboardingStep?: number;

	@IsOptional()
	@IsString()
	initialDiagnosticTestId?: string;

	@IsOptional()
	@IsString()
	preferredLanguage?: string;

	@IsOptional()
	@IsEnum(Difficulty)
	preferredDifficultyBias?: Difficulty;

	@IsOptional()
	@IsInt()
	@Min(0)
	@Max(1440)
	dailyStudyTimeTargetMinutes?: number;

	@IsOptional()
	@IsObject()
	notificationPreferences?: Record<string, any>;
}
