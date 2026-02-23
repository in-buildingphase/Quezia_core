import {
    IsString,
    IsNotEmpty,
    IsEnum,
    IsNumber,
    IsOptional,
    IsObject,
    IsInt,
    Min,
    IsPositive,
} from 'class-validator';
import { Difficulty, QuestionType } from '@prisma/client';
import { Type } from 'class-transformer';

/**
 * DTO for registering a canonical Question in the Question Registry.
 * This is the "source of truth" record for a question before it is
 * ever snapshotted into a Test.
 */
export class CreateQuestionDto {
    /** Logical identifier — stable across versions (e.g. "PHYS-KINEMATICS-001") */
    @IsString()
    @IsNotEmpty()
    questionId: string;

    /** Version counter starting at 1 */
    @IsInt()
    @IsPositive()
    @Type(() => Number)
    version: number;

    @IsString()
    @IsNotEmpty()
    subject: string;

    @IsString()
    @IsNotEmpty()
    topic: string;

    @IsString()
    @IsNotEmpty()
    subtopic: string;

    @IsEnum(Difficulty)
    difficulty: Difficulty;

    @IsEnum(QuestionType)
    questionType: QuestionType;

    /**
     * MCQ: { question: string, options: [{key, text}] }
     * NUMERIC: { question: string }
     */
    @IsObject()
    @IsNotEmpty()
    contentPayload: Record<string, any>;

    /** For MCQ: option key (A/B/C/D). For NUMERIC: numeric string. */
    @IsString()
    @IsNotEmpty()
    correctAnswer: string;

    /** Required for both MCQ and NUMERIC */
    @IsString()
    @IsNotEmpty()
    explanation: string;

    /** Marks awarded for a correct answer */
    @IsNumber()
    @IsPositive()
    @Type(() => Number)
    marks: number;

    /** Default time in seconds expected to solve this question */
    @IsInt()
    @IsOptional()
    @Min(1)
    @Type(() => Number)
    defaultTimeSeconds?: number;

    /** Required for NUMERIC questions. Use 0 for exact match. */
    @IsNumber()
    @IsOptional()
    @Min(0)
    @Type(() => Number)
    numericTolerance?: number;
}
