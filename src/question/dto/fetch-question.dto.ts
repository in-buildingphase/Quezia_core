import { Difficulty, QuestionType } from '@prisma/client';

/**
 * Internal parameters used by TestGenerationService when requesting
 * questions. QuestionFetcherService converts these into the request body
 * expected by the JEE AI Service (POST /ai/generate).
 */
export interface QuestionFetchParams {
  /**
   * The ID of the requesting user (learner or admin).
   * Sent as `user_id` to the AI service for logging and echo-back matching.
   * Falls back to examId if userId is unavailable (e.g. SYSTEM-origin threads).
   */
  userId: string;

  /** Subject name (e.g. "Physics"). Sent as `subjects: [subject]`. */
  subject: string;

  /** Optional topic filter (informational; not sent to AI). */
  topic?: string;

  /** Optional subtopic filter (informational; not sent to AI). */
  subtopic?: string;

  /** Required difficulty level. Lowercased before sending: EASY→easy, MIXED→mixed. */
  difficulty: Difficulty;

  /** Optional question type filter (not sent to AI). */
  questionType?: QuestionType;

  /** How many questions to return (before deduplication filter). */
  count: number;

  /**
   * Optional natural-language prompt override.
   * When provided, sent as `prompt` in the AI request body.
   */
  prompt?: string;

  /** Question IDs already used in this test — filtered out client-side after fetching. */
  excludeQuestionIds?: string[];
}

/**
 * Shape of a single question as returned by QuestionFetcherService.
 *
 * The AI service returns difficulty as lowercase (easy/medium/hard) and
 * questionType as "MCQ" or "numerical". QuestionFetcherService normalises
 * both to the Prisma enum values (EASY/MEDIUM/HARD and MCQ/NUMERIC) before
 * returning this DTO.
 */
export interface ExternalQuestionDto {
  questionId: string;
  subject: string;
  topic: string;
  subtopic: string;
  difficulty: Difficulty;
  questionType: QuestionType;
  contentPayload: {
    question: string;
    options?: Array<{ key: string; text: string }>;
  };
  correctAnswer: string;
  explanation?: string;
  marks: number;
  defaultTimeSeconds: number | null;
  numericTolerance: null; // AI service does not return this — always null
}
