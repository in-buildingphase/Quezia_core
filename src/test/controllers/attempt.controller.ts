import {
  Controller,
  Post,
  Get,
  Body,
  HttpCode,
  Param,
  UseGuards,
  Patch,
} from '@nestjs/common';
import { TestLifecycleService } from '../services/test-lifecycle.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SubmitAnswerDto } from '../dto/submit-answer.dto';

@Controller('attempts')
@UseGuards(JwtAuthGuard)
export class AttemptController {
  constructor(private readonly testLifecycleService: TestLifecycleService) {}

  @Post(':testId/start')
  async startAttempt(
    @Param('testId') testId: string,
    @CurrentUser() user: { userId: string },
  ) {
    return this.testLifecycleService.startAttempt(testId, user.userId);
  }

  @Get(':attemptId/questions')
  async getAttemptQuestions(
    @Param('attemptId') attemptId: string,
    @CurrentUser() user: { userId: string },
  ) {
    return this.testLifecycleService.getAttemptQuestions(attemptId, user.userId);
  }

  @Post(':id/submit')
  async submitAnswer(
    @Param('id') attemptId: string,
    @Body() dto: SubmitAnswerDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.testLifecycleService.submitAnswer(
      attemptId,
      dto.questionId,
      dto.answer,
      user.userId,
    );
  }

  @Post(':id/submit-test')
  @HttpCode(200)
  async submitTest(
    @Param('id') attemptId: string,
    @CurrentUser() user: { userId: string },
  ) {
    return this.testLifecycleService.completeAttempt(attemptId, user.userId);
  }
}
