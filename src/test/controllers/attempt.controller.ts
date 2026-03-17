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
import { TimerService } from '../services/timer.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SubmitAnswerDto } from '../dto/submit-answer.dto';
import { UpdateTimeDto } from '../dto/update-time.dto';
import { Query } from '@nestjs/common';

@Controller('attempts')
@UseGuards(JwtAuthGuard)
export class AttemptController {
  constructor(
    private readonly testLifecycleService: TestLifecycleService,
    private readonly timerService: TimerService,
  ) { }

  @Get()
  async listAttempts(
    @Query('threadId') threadId: string,
    @CurrentUser() user: { userId: string },
  ) {
    return this.testLifecycleService.getAttempts(user.userId, threadId);
  }

  @Get(':id')
  async getAttempt(
    @Param('id') attemptId: string,
    @CurrentUser() user: { userId: string },
  ) {
    return this.testLifecycleService.getAttemptById(attemptId, user.userId);
  }

  @Get(':id/review')
  async getAttemptReview(
    @Param('id') attemptId: string,
    @CurrentUser() user: { userId: string },
  ) {
    return this.testLifecycleService.getAttemptReview(attemptId, user.userId);
  }

  @Post(':testId/start')
  async startAttempt(
    @Param('testId') testId: string,
    @CurrentUser() user: { userId: string },
  ) {
    return this.testLifecycleService.startAttempt(testId, user.userId);
  }

  @Get(':id/questions')
  async getAttemptQuestions(
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
  ) {
    return this.testLifecycleService.getAttemptQuestions(id, user.userId);
  }

  @Post(':id/time')
  @HttpCode(200)
  async updateTime(
    @Param('id') attemptId: string,
    @Body() dto: UpdateTimeDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.timerService.updateQuestionTime(attemptId, user.userId, dto);
  }

  @Post(':id/submit')
  async submitAnswer(
    @Param('id') attemptId: string,
    @Body() dto: SubmitAnswerDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.testLifecycleService.submitAnswer(
      attemptId,
      dto,
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

