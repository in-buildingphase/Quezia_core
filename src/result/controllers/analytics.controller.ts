import { Controller, Get, NotFoundException, Param, UseGuards } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('analytics')
@UseGuards(JwtAuthGuard)
export class AnalyticsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('exam/:examId')
  async getExamAnalytics(
    @Param('examId') examId: string,
    @CurrentUser() user: { userId: string },
  ) {
    const exam = await this.prisma.exam.findUnique({
      where: { id: examId },
      select: { id: true, name: true, isActive: true },
    });
    if (!exam) throw new NotFoundException(`Exam ${examId} not found`);

    const analytics = await this.prisma.userExamAnalytics.findUnique({
      where: {
        userId_examId: {
          userId: user.userId,
          examId,
        },
      },
    });

    if (!analytics) return { exam };
    return { exam, ...analytics };
  }

  @Get('exam/:examId/subjects')
  async getSubjectAnalytics(
    @Param('examId') examId: string,
    @CurrentUser() user: { userId: string },
  ) {
    return this.prisma.userSubjectAnalytics.findMany({
      where: {
        userId: user.userId,
        examId,
      },
      orderBy: {
        accuracy: 'desc',
      },
    });
  }

  @Get('exam/:examId/topics')
  async getTopicAnalytics(
    @Param('examId') examId: string,
    @CurrentUser() user: { userId: string },
  ) {
    return this.prisma.userTopicAnalytics.findMany({
      where: {
        userId: user.userId,
        examId,
      },
      orderBy: {
        accuracy: 'desc',
      },
    });
  }

  @Get('exam/:examId/trend')
  async getPerformanceTrend(
    @Param('examId') examId: string,
    @CurrentUser() user: { userId: string },
  ) {
    return this.prisma.performanceTrend.findMany({
      where: {
        userId: user.userId,
        examId,
      },
      orderBy: {
        testDate: 'asc',
      },
    });
  }

  @Get('exam/:examId/benchmark')
  async getPeerBenchmark(
    @Param('examId') examId: string,
    @CurrentUser() user: { userId: string },
  ) {
    const userAnalytics = await this.prisma.userExamAnalytics.findUnique({
      where: {
        userId_examId: {
          userId: user.userId,
          examId,
        },
      },
      select: {
        averageScore: true,
      },
    });

    const benchmark = await this.prisma.peerBenchmark.findFirst({
      where: { examId },
      orderBy: { computedAt: 'desc' },
    });

    // Current user percentile is stored in the latest attempt or exam analytics
    // For simplicity, we return the benchmark distribution and user's avg score
    return {
      userScore: userAnalytics?.averageScore,
      benchmark,
    };
  }
}
