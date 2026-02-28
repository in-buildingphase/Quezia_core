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
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Difficulty, QuestionType } from '@prisma/client';
import { Type } from 'class-transformer';

/**
 * Represents a single validated question payload coming from an external
 * source (e.g. AI generation service) to be injected into a DRAFT test.
 *
 * This service does NOT generate content — it validates and snapshots it.
 */
export class InjectedQuestionItemDto {
  /** Logical question identifier — must be globally unique */
  @IsString()
  @IsNotEmpty()
  questionId: string;

  @IsEnum(QuestionType)
  questionType: QuestionType;

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

  /**
   * Content payload.
   * MCQ:    { question: string, options: [{key: string, text: string}] }
   * NUMERIC: { question: string }
   */
  @IsObject()
  @IsNotEmpty()
  contentPayload: Record<string, any>;

  /** MCQ: option key (A–F). NUMERIC: numeric string. */
  @IsString()
  @IsNotEmpty()
  correctAnswer: string;

  /** Required for both MCQ and NUMERIC. */
  @IsString()
  @IsNotEmpty()
  explanation: string;

  /** Marks for a correct answer — must match section marksPerQuestion if defined. */
  @IsNumber()
  @IsPositive()
  @Type(() => Number)
  marks: number;

  /** Expected time in seconds to answer this question. */
  @IsInt()
  @IsOptional()
  @Min(1)
  @Type(() => Number)
  defaultTimeSeconds?: number;

  /** Required and must be >= 0 for NUMERIC. null/undefined for MCQ. */
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Type(() => Number)
  numericTolerance?: number;

  /**
   * Per-question negative marking override.
   * If omitted the test-level rule from ruleSnapshot applies.
   */
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Type(() => Number)
  negativeMarkValue?: number;
}

/**
 * Payload for POST /tests/:testId/questions
 * Injects one or more validated questions into a DRAFT test's specific section.
 */
export class InjectQuestionsDto {
  /**
   * The sectionId from the test's sectionSnapshot this batch of questions
   * belongs to (must match the section's expected subject).
   */
  @IsString()
  @IsNotEmpty()
  sectionId: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InjectedQuestionItemDto)
  questions: InjectedQuestionItemDto[];
}
