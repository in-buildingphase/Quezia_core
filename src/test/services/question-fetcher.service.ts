import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { Difficulty, QuestionType } from '@prisma/client';
import {
  QuestionFetchParams,
  ExternalQuestionDto,
} from '../../question/dto/fetch-question.dto';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * QuestionFetcherService
 * ─────────────────────
 * HTTP client for the JEE AI Service.
 *
 * Endpoint: POST /ai/generate
 * Docs: https://jee-ai-service.onrender.com
 *
 * Configure via environment variable:
 *   QUESTION_SERVICE_URL=https://jee-ai-service.onrender.com
 *
 * This is the sole question source for test generation. If the env var is
 * not set, fetchQuestions() throws ServiceUnavailableException immediately.
 */
@Injectable()
export class QuestionFetcherService {
  private readonly logger = new Logger(QuestionFetcherService.name);
  private readonly baseUrl: string | undefined;

  constructor(
    private readonly httpService: HttpService,
    private readonly prisma: PrismaService,
  ) {
    this.baseUrl = process.env.QUESTION_SERVICE_URL?.replace(/\/$/, '');
    if (this.baseUrl) {
      this.logger.log(`JEE AI Service configured at: ${this.baseUrl}`);
    } else {
      this.logger.error(
        'QUESTION_SERVICE_URL is not set — test generation will be unavailable.',
      );
    }
  }

  async fetchQuestions(
    params: QuestionFetchParams,
  ): Promise<ExternalQuestionDto[]> {
    if (!this.baseUrl) {
      throw new ServiceUnavailableException(
        'External Question Service is not configured (QUESTION_SERVICE_URL missing)',
      );
    }

    // Request enough questions to cover the target count even after
    // client-side deduplication, capped at the AI service maximum of 200.
    const requestedCount = Math.min(
      params.count + (params.excludeQuestionIds?.length ?? 0),
      200,
    );

    // Build request body according to the calling mode:
    //
    // Option A — natural language (prompt provided):
    //   Send ONLY user_id + prompt. The AI service parses the prompt and
    //   decides subjects, difficulty, question count, and format entirely.
    //   Do NOT send questionCount / subject / difficulty alongside the prompt
    //   or those structured fields will override the prompt's intent.
    //
    // Option B — structured (no prompt):
    //   Send explicit subject / difficulty / questionCount so the AI returns
    //   exactly what the caller requested.
    let body: Record<string, unknown>;
    if (params.prompt) {
      body = {
        user_id: params.userId,
        prompt: params.prompt,
      };
    } else {
      body = {
        user_id: params.userId,
        subject: params.subject.toLowerCase(),
        difficulty: params.difficulty.toLowerCase(), // MIXED→mixed, EASY→easy, etc.
        questionCount: requestedCount,
      };
    }

    const url = `${this.baseUrl}/ai/generate`;
    this.logger.debug(`POST ${url} — body: ${JSON.stringify(body)}`);

    try {
      const response = await firstValueFrom(
        this.httpService.post<unknown>(url, body, {
          headers: { 'Content-Type': 'application/json' },
          // Render free-tier cold starts can take 30–60 s
          timeout: 60_000,
        }),
      );

      const data = response.data as any;

      // Guard against unexpected response shapes (e.g. AI error objects)
      if (!Array.isArray(data?.test_questions)) {
        this.logger.error(
          `AI service returned unexpected shape: ${JSON.stringify(data)}`,
        );
        throw new ServiceUnavailableException(
          'AI service returned an unexpected response shape.',
        );
      }

      // Map AI response → ExternalQuestionDto (normalise casing to Prisma enum values)
      const questions: ExternalQuestionDto[] = data.test_questions.map(
        (q: any): ExternalQuestionDto => ({
          questionId: q.questionId,
          subject: q.subject,
          topic: q.topic ?? '',
          subtopic: '', // AI service does not return subtopic
          difficulty: (q.difficulty as string).toUpperCase() as Difficulty,
          questionType:
            ['numerical', 'numeric'].includes(q.questionType?.toLowerCase())
              ? QuestionType.NUMERIC
              : QuestionType.MCQ,
          contentPayload: q.contentPayload,
          correctAnswer: q.correctAnswer,
          explanation: q.explanation,
          marks: q.marks,
          defaultTimeSeconds: q.timeLimit ?? null,
          numericTolerance: null, // AI service does not return this
        }),
      );

      this.logger.debug(
        `Received ${questions.length} questions from AI service (requested ${requestedCount})`,
      );

      // Client-side deduplication: exclude question IDs already used in this test
      const exclude = new Set(params.excludeQuestionIds ?? []);
      const filtered = questions.filter((q) => !exclude.has(q.questionId));

      this.logger.debug(
        `After deduplication: ${filtered.length} questions (excluded ${questions.length - filtered.length})`,
      );

      return filtered;
    } catch (error: any) {
      // Re-throw ServiceUnavailableException as-is
      if (error instanceof ServiceUnavailableException) throw error;

      this.logger.error(
        `Failed to fetch questions from AI service: ${error?.message}`,
      );
      throw new ServiceUnavailableException(
        'Question Service is currently unavailable. Please try again later.',
      );
    }
  }

  async analyzePerformance(attemptId: string): Promise<void> {
    if (!this.baseUrl) {
      this.logger.warn('External Question Service is not configured. Skipping analysis.');
      return;
    }

    try {
      const attempt = await this.prisma.testAttempt.findUnique({
        where: { id: attemptId },
        include: {
          test: { select: { examId: true } },
          questions: {
            include: { testQuestion: true },
          },
        },
      });

      if (!attempt) {
        this.logger.error(`Attempt ${attemptId} not found for analysis.`);
        return;
      }

      const body = {
        user_id: attempt.userId,
        raw_attempt_data: {
          attempts: attempt.questions.map((aq) => ({
            question_id: aq.testQuestion.questionId,
            subject: aq.testQuestion.subject,
            topic: aq.testQuestion.topic,
            difficulty: aq.testQuestion.difficulty.toLowerCase(),
            is_correct: aq.isCorrect ?? false,
            time_taken_seconds: aq.timeSpentSeconds ?? 0,
            question_type: aq.testQuestion.questionType.toLowerCase(),
          })),
        },
      };

      const url = `${this.baseUrl}/ai/analyze`;
      this.logger.debug(`POST ${url} — generating analysis for attempt ${attemptId}`);

      const response = await firstValueFrom(
        this.httpService.post<any>(url, body, {
          headers: { 'Content-Type': 'application/json' },
          timeout: 60_000,
        }),
      );

      await this.prisma.insightLog.create({
        data: {
          userId: attempt.userId,
          examId: attempt.test.examId,
          insightPayload: response.data,
        },
      });

      this.logger.log(`Successfully saved AI insights for attempt ${attemptId}`);
    } catch (error: any) {
      this.logger.error(`Failed to analyze performance from AI service: ${error?.message}`);
    }
  }
}
