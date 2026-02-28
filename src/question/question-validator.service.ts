import { Injectable, BadRequestException } from '@nestjs/common';
import { QuestionType, Difficulty } from '@prisma/client';

// ─────────────────────────────────────────────────────────────────────────────
// Interfaces used internally for typed validation
// ─────────────────────────────────────────────────────────────────────────────
export interface McqOption {
  key: string; // e.g. "A", "B", "C", "D"
  text: string; // display text
}

export interface McqContentPayload {
  question: string;
  options: McqOption[];
}

export interface NumericContentPayload {
  question: string;
  options?: never; // must be absent
}

export interface QuestionPayload {
  questionId: string;
  questionType: QuestionType;
  subject: string;
  topic: string;
  subtopic: string;
  difficulty: Difficulty;
  marks: number | string;
  defaultTimeSeconds?: number;
  correctAnswer: string;
  explanation: string;
  numericTolerance?: number | string | null;
  contentPayload: McqContentPayload | NumericContentPayload;
}

// Valid single-char capital option keys
const VALID_OPTION_KEYS = ['A', 'B', 'C', 'D', 'E', 'F'];

@Injectable()
export class QuestionValidatorService {
  // ─────────────────────────────────────────────────────────────────────────
  // ENTRY POINT: full structural + content + metadata validation
  // ─────────────────────────────────────────────────────────────────────────
  validateFull(question: QuestionPayload): void {
    this.validateIdentity(question);
    this.validateMetadata(question);
    this.validateContent(question);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 1. IDENTITY + INTEGRITY
  // ─────────────────────────────────────────────────────────────────────────
  validateIdentity(question: QuestionPayload): void {
    if (
      !question.questionId ||
      typeof question.questionId !== 'string' ||
      question.questionId.trim() === ''
    ) {
      throw new BadRequestException(
        'Question must have a valid non-empty questionId',
      );
    }

    if (!Object.values(QuestionType).includes(question.questionType)) {
      throw new BadRequestException(
        `Invalid questionType "${question.questionType}". Allowed: ${Object.values(QuestionType).join(', ')}`,
      );
    }

    if (!Object.values(Difficulty).includes(question.difficulty)) {
      throw new BadRequestException(
        `Invalid difficulty "${question.difficulty}". Allowed: ${Object.values(Difficulty).join(', ')}`,
      );
    }

    const marks = this.safeParseDecimal(question.marks, 'marks');
    if (marks <= 0) {
      throw new BadRequestException('marks must be a positive number');
    }

    if (
      question.defaultTimeSeconds !== undefined &&
      (typeof question.defaultTimeSeconds !== 'number' ||
        question.defaultTimeSeconds <= 0)
    ) {
      throw new BadRequestException(
        'defaultTimeSeconds must be a positive integer',
      );
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 2. METADATA CONSISTENCY
  // ─────────────────────────────────────────────────────────────────────────
  validateMetadata(question: QuestionPayload): void {
    if (
      !question.subject ||
      typeof question.subject !== 'string' ||
      question.subject.trim() === ''
    ) {
      throw new BadRequestException('Question must have a non-empty subject');
    }
    if (
      !question.topic ||
      typeof question.topic !== 'string' ||
      question.topic.trim() === ''
    ) {
      throw new BadRequestException('Question must have a non-empty topic');
    }
    if (
      !question.subtopic ||
      typeof question.subtopic !== 'string' ||
      question.subtopic.trim() === ''
    ) {
      throw new BadRequestException('Question must have a non-empty subtopic');
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 3. CONTENT VALIDATION — dispatches per question type
  // ─────────────────────────────────────────────────────────────────────────
  validateContent(question: QuestionPayload): void {
    if (question.questionType === QuestionType.MCQ) {
      this.validateMcq(question);
    } else if (question.questionType === QuestionType.NUMERIC) {
      this.validateNumeric(question);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 3a. MCQ VALIDATION
  // Rules:
  //  - contentPayload.question must be a non-empty string
  //  - Must contain 2–6 options
  //  - Each option must have a unique key from [A,B,C,D,E,F]
  //  - Each option must have a non-empty text value
  //  - correctAnswer must match one of the option keys
  //  - explanation must be a non-empty string
  // ─────────────────────────────────────────────────────────────────────────
  private validateMcq(question: QuestionPayload): void {
    const payload = question.contentPayload as McqContentPayload;

    if (
      !payload ||
      !payload.question ||
      typeof payload.question !== 'string' ||
      payload.question.trim() === ''
    ) {
      throw new BadRequestException(
        'MCQ contentPayload.question must be a non-empty string',
      );
    }

    if (!Array.isArray(payload.options)) {
      throw new BadRequestException(
        'MCQ contentPayload.options must be an array',
      );
    }

    const optCount = payload.options.length;
    if (optCount < 2 || optCount > 6) {
      throw new BadRequestException(
        `MCQ must have between 2 and 6 options. Got: ${optCount}`,
      );
    }

    const seenKeys = new Set<string>();
    for (let i = 0; i < payload.options.length; i++) {
      const opt = payload.options[i];

      if (!opt || typeof opt !== 'object') {
        throw new BadRequestException(
          `Option at index ${i} must be an object with {key, text}`,
        );
      }
      if (!opt.key || !VALID_OPTION_KEYS.includes(opt.key.toUpperCase())) {
        throw new BadRequestException(
          `Option at index ${i} has an invalid key "${opt.key}". Allowed: A–F`,
        );
      }
      const normalizedKey = opt.key.toUpperCase();
      if (seenKeys.has(normalizedKey)) {
        throw new BadRequestException(
          `Duplicate option key "${normalizedKey}" found`,
        );
      }
      seenKeys.add(normalizedKey);

      if (!opt.text || typeof opt.text !== 'string' || opt.text.trim() === '') {
        throw new BadRequestException(
          `Option "${normalizedKey}" must have a non-empty text value`,
        );
      }
    }

    const correctKey = question.correctAnswer?.toUpperCase();
    if (!correctKey || !seenKeys.has(correctKey)) {
      throw new BadRequestException(
        `correctAnswer "${question.correctAnswer}" does not match any option key. Available: ${[...seenKeys].join(', ')}`,
      );
    }

    if (
      !question.explanation ||
      typeof question.explanation !== 'string' ||
      question.explanation.trim() === ''
    ) {
      throw new BadRequestException(
        'MCQ question must have a non-empty explanation',
      );
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 3b. NUMERIC VALIDATION
  // Rules:
  //  - contentPayload.question must be a non-empty string
  //  - options must NOT be present
  //  - correctAnswer must be a valid number (incl. negatives, scientific notation)
  //  - explanation must be a non-empty string
  //  - numericTolerance must be defined and >= 0
  // ─────────────────────────────────────────────────────────────────────────
  private validateNumeric(question: QuestionPayload): void {
    const payload = question.contentPayload as NumericContentPayload;

    if (
      !payload ||
      !payload.question ||
      typeof payload.question !== 'string' ||
      payload.question.trim() === ''
    ) {
      throw new BadRequestException(
        'NUMERIC contentPayload.question must be a non-empty string',
      );
    }

    // options must be absent
    if ((payload as any).options !== undefined) {
      throw new BadRequestException(
        'NUMERIC question must not contain options',
      );
    }

    // Safe numeric parsing — supports negatives, decimals, scientific notation
    const parsedAnswer = this.safeParseNumericAnswer(question.correctAnswer);
    if (parsedAnswer === null) {
      throw new BadRequestException(
        `NUMERIC correctAnswer "${question.correctAnswer}" is not a valid number. ` +
          `Supports: integers, decimals, negatives, scientific notation (e.g. 1.5e-3)`,
      );
    }

    if (
      !question.explanation ||
      typeof question.explanation !== 'string' ||
      question.explanation.trim() === ''
    ) {
      throw new BadRequestException(
        'NUMERIC question must have a non-empty explanation',
      );
    }

    if (
      question.numericTolerance === undefined ||
      question.numericTolerance === null
    ) {
      throw new BadRequestException(
        'NUMERIC question must have numericTolerance defined (use 0 for exact match)',
      );
    }

    const tolerance = this.safeParseDecimal(
      question.numericTolerance,
      'numericTolerance',
    );
    if (tolerance < 0) {
      throw new BadRequestException('numericTolerance must be >= 0');
    }

    // Validate tolerance + precision: tolerance must not be larger than |correctAnswer| * 100
    // (prevents "any answer is correct" scenarios on non-zero answers)
    if (
      Math.abs(parsedAnswer) > 0 &&
      tolerance > Math.abs(parsedAnswer) * 100
    ) {
      throw new BadRequestException(
        `numericTolerance (${tolerance}) is unreasonably large relative to correctAnswer (${parsedAnswer})`,
      );
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // NUMERIC ENGINE: Safe decimal parsing
  // Handles: integers, decimals, negative values, scientific notation
  // Returns null on invalid input (not NaN/Infinity)
  // ─────────────────────────────────────────────────────────────────────────
  safeParseNumericAnswer(
    value: string | number | null | undefined,
  ): number | null {
    if (value === null || value === undefined) return null;
    const str = String(value).trim();
    if (str === '') return null;

    // Strict pattern: optional sign, digits, optional decimal, optional exponent
    // Matches: 42, -3.14, 1.5e10, -2.5E-3, 0.001, etc.
    const numericRegex = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
    if (!numericRegex.test(str)) return null;

    const parsed = Number(str);
    if (!isFinite(parsed)) return null;

    return parsed;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Evaluate whether a submitted answer is within tolerance of the correct answer
  // ─────────────────────────────────────────────────────────────────────────
  evaluateNumericAnswer(
    submitted: string,
    correctAnswer: string,
    tolerance: number | string,
  ): boolean {
    const parsedSubmitted = this.safeParseNumericAnswer(submitted);
    const parsedCorrect = this.safeParseNumericAnswer(correctAnswer);
    const parsedTolerance = this.safeParseDecimal(tolerance, 'tolerance');

    if (parsedSubmitted === null || parsedCorrect === null) return false;

    return Math.abs(parsedSubmitted - parsedCorrect) <= parsedTolerance;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // VALIDATE AGAINST TEST SNAPSHOT (cross-test contamination + metadata check)
  // ─────────────────────────────────────────────────────────────────────────
  validateAgainstTestSnapshot(
    question: QuestionPayload,
    sectionSnapshot: any[],
    ruleSnapshot: any,
    targetSectionId: string,
    existingQuestionIds: string[],
  ): void {
    // Prevent duplicate insertion into same test
    if (existingQuestionIds.includes(question.questionId)) {
      throw new BadRequestException(
        `Question "${question.questionId}" is already inserted in this test`,
      );
    }

    // Find the target section
    const section = sectionSnapshot.find(
      (s: any) => s.sectionId === targetSectionId,
    );
    if (!section) {
      throw new BadRequestException(
        `Section "${targetSectionId}" does not exist in this test's sectionSnapshot`,
      );
    }

    // Subject must match section
    if (
      question.subject.trim().toLowerCase() !==
      section.subject.trim().toLowerCase()
    ) {
      throw new BadRequestException(
        `Question subject "${question.subject}" does not match section subject "${section.subject}"`,
      );
    }

    // Marks must align with ruleSnapshot / section marksPerQuestion if defined
    if (
      section.marksPerQuestion !== undefined &&
      section.marksPerQuestion !== null
    ) {
      const questionMarks = this.safeParseDecimal(question.marks, 'marks');
      const expectedMarks = this.safeParseDecimal(
        section.marksPerQuestion,
        'marksPerQuestion',
      );
      if (Math.abs(questionMarks - expectedMarks) > 0.0001) {
        throw new BadRequestException(
          `Question marks (${questionMarks}) do not match section marksPerQuestion (${expectedMarks})`,
        );
      }
    }

    // Time-per-question bounds: if ruleSnapshot has maxTimePerQuestion, enforce it
    if (
      ruleSnapshot &&
      ruleSnapshot.maxTimePerQuestion &&
      question.defaultTimeSeconds
    ) {
      if (question.defaultTimeSeconds > ruleSnapshot.maxTimePerQuestion) {
        throw new BadRequestException(
          `Question defaultTimeSeconds (${question.defaultTimeSeconds}) exceeds ` +
            `ruleSnapshot.maxTimePerQuestion (${ruleSnapshot.maxTimePerQuestion})`,
        );
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // UTILITY: Safe Decimal parse (no JS float errors)
  // ─────────────────────────────────────────────────────────────────────────
  private safeParseDecimal(value: any, fieldName: string): number {
    if (value === null || value === undefined) {
      throw new BadRequestException(`${fieldName} is required`);
    }
    const str = String(value).trim();
    if (str === '')
      throw new BadRequestException(`${fieldName} cannot be empty`);

    // Allow: integers, decimals, negatives, scientific notation
    const decimalRegex = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
    if (!decimalRegex.test(str)) {
      throw new BadRequestException(
        `${fieldName} "${value}" is not a valid decimal number`,
      );
    }
    const n = Number(str);
    if (!isFinite(n)) {
      throw new BadRequestException(
        `${fieldName} "${value}" is not a finite number`,
      );
    }
    return n;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Legacy compatibility shims (used by existing QuestionService.createCanonicalQuestion)
  // ─────────────────────────────────────────────────────────────────────────
  validateStructure(question: any): void {
    this.validateContent(question as QuestionPayload);
  }
}
