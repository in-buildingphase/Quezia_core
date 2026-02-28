import { Injectable } from '@nestjs/common';

/**
 * QuestionSelectionService — LOCAL FALLBACK (currently disabled)
 * ─────────────────────────────────────────────────────────────
 * This service previously handled question selection directly from the
 * local Postgres database when the external Question Service was not
 * configured.
 *
 * It has been intentionally disabled now that the external Question
 * Service is the sole source of questions in production.
 *
 * TODO: If the Question Service goes down and we need a fallback,
 * re-implement selectQuestions() here using QuestionRepository to
 * pull eligible questions from the local DB and wire it back into
 * TestGenerationService as a secondary path.
 */
@Injectable()
export class QuestionSelectionService {}
