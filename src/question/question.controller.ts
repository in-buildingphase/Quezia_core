import {
  Controller,
  Delete,
  Post,
  Get,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { QuestionService } from './question.service';
import {
  QuestionValidatorService,
  QuestionPayload,
} from './question-validator.service';
import { CreateQuestionDto } from './dto/create-question.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('questions')
@UseGuards(JwtAuthGuard)
export class QuestionController {
  constructor(
    private readonly questionService: QuestionService,
    private readonly validator: QuestionValidatorService,
  ) {}

  /**
   * POST /questions
   * Register a canonical question in the Question Registry.
   * Admin only — learners never write questions.
   */
  @Post()
  @UseGuards(RolesGuard)
  @Roles('admin')
  async createQuestion(@Body() dto: CreateQuestionDto) {
    return this.questionService.createCanonicalQuestion(dto);
  }

  /**
   * GET /questions/:questionId
   * Fetch the latest active version of a canonical question.
   * Optionally pass ?version=N to fetch a specific version.
   */
  @Get(':questionId')
  async getQuestion(
    @Param('questionId') questionId: string,
    @Query('version') version?: string,
  ) {
    return this.questionService.getCanonicalQuestion(
      questionId,
      version ? parseInt(version, 10) : undefined,
    );
  }

  /**
   * POST /questions/validate
   * Validate a question payload without persisting it.
   * Returns { valid: true } or throws 400 with the first validation error.
   * Useful for external AI services to pre-check before full injection.
   */
  @Post('validate')
  @HttpCode(HttpStatus.OK)
  async validateQuestion(@Body() body: QuestionPayload) {
    this.validator.validateFull(body);
    return {
      valid: true,
      questionId: body.questionId,
      questionType: body.questionType,
    };
  }

  /**
   * DELETE /questions/:questionId
   * Remove a canonical question from the registry.
   * Rejected with 400 if the question is snapshotted in any existing test.
   */
  @Delete(':questionId')
  @UseGuards(RolesGuard)
  @Roles('admin')
  @HttpCode(HttpStatus.OK)
  async deleteQuestion(@Param('questionId') questionId: string) {
    return this.questionService.deleteCanonicalQuestion(questionId);
  }
}
