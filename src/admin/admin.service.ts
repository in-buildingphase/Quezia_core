import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UserRole } from '@prisma/client';

/**
 * ADMIN SERVICE
 *
 * Provides admin-only operations:
 * - View aggregated analytics
 * - Moderate users (suspend/activate)
 * - View audit logs
 * - Override test visibility
 * - Manage system-wide operations
 */
@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Get aggregated analytics across all exams
   */
  async getSystemAnalytics() {
    const [
      totalUsers,
      activeUsers,
      totalExams,
      totalTests,
      publishedTests,
      totalAttempts,
      completedAttempts,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { isActive: true } }),
      this.prisma.exam.count(),
      this.prisma.test.count(),
      this.prisma.test.count({ where: { status: 'PUBLISHED' } }),
      this.prisma.testAttempt.count(),
      this.prisma.testAttempt.count({ where: { status: 'COMPLETED' } }),
    ]);

    return {
      users: {
        total: totalUsers,
        active: activeUsers,
        inactive: totalUsers - activeUsers,
      },
      exams: {
        total: totalExams,
      },
      tests: {
        total: totalTests,
        published: publishedTests,
        draft: totalTests - publishedTests,
      },
      attempts: {
        total: totalAttempts,
        completed: completedAttempts,
        active: totalAttempts - completedAttempts,
      },
    };
  }

  /**
   * Get exam-specific aggregated analytics
   */
  async getExamAnalytics(examId: string) {
    const exam = await this.prisma.exam.findUnique({
      where: { id: examId },
      include: {
        _count: {
          select: {
            tests: true,
            threads: true,
            blueprints: true,
          },
        },
      },
    });

    if (!exam) {
      throw new NotFoundException(`Exam ${examId} not found`);
    }

    const [attempts, subscriptions, peerBenchmarks] = await Promise.all([
      this.prisma.testAttempt.findMany({
        where: {
          test: { examId },
          status: 'COMPLETED',
        },
        select: {
          totalScore: true,
          accuracy: true,
          timeSpentSeconds: true,
        },
      }),
      this.prisma.userSubscription.count({
        where: {
          pack: { examId },
          status: 'ACTIVE',
        },
      }),
      this.prisma.peerBenchmark.findMany({
        where: { examId },
      }),
    ]);

    const avgScore =
      attempts.length > 0
        ? attempts.reduce((sum, a) => sum + Number(a.totalScore || 0), 0) /
          attempts.length
        : 0;

    const avgAccuracy =
      attempts.length > 0
        ? attempts.reduce((sum, a) => sum + Number(a.accuracy || 0), 0) /
          attempts.length
        : 0;

    const avgTime =
      attempts.length > 0
        ? attempts.reduce((sum, a) => sum + (a.timeSpentSeconds || 0), 0) /
          attempts.length
        : 0;

    return {
      exam: {
        id: exam.id,
        name: exam.name,
        isActive: exam.isActive,
      },
      tests: exam._count.tests,
      threads: exam._count.threads,
      blueprints: exam._count.blueprints,
      activeSubscriptions: subscriptions,
      attempts: {
        total: attempts.length,
        avgScore: Math.round(avgScore * 100) / 100,
        avgAccuracy: Math.round(avgAccuracy * 100) / 100,
        avgTimeSeconds: Math.round(avgTime),
      },
      peerBenchmarks: peerBenchmarks.map((pb) => ({
        blueprintVersion: pb.blueprintVersion,
        totalParticipants: pb.totalParticipants,
        lastUpdated: pb.lastRecalculatedAt,
      })),
    };
  }

  /**
   * Get all users with pagination and filters
   */
  async getUsers(options: {
    page?: number;
    limit?: number;
    role?: UserRole;
    isActive?: boolean;
    search?: string;
  }) {
    const page = options.page || 1;
    const limit = options.limit || 20;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (options.role) where.role = options.role;
    if (options.isActive !== undefined) where.isActive = options.isActive;
    if (options.search) {
      where.OR = [
        { email: { contains: options.search, mode: 'insensitive' } },
        { username: { contains: options.search, mode: 'insensitive' } },
      ];
    }

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take: limit,
        select: {
          id: true,
          email: true,
          username: true,
          role: true,
          isActive: true,
          createdAt: true,
          lastLogin: true,
          isEmailVerified: true,
          _count: {
            select: {
              attempts: true,
              subscriptions: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      users,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Suspend a user account
   */
  async suspendUser(userId: string, reason?: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException(`User ${userId} not found`);
    }

    if (user.role === UserRole.ADMIN) {
      throw new BadRequestException('Cannot suspend admin users');
    }

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { isActive: false },
      }),
      this.prisma.authAuditLog.create({
        data: {
          userId,
          event: 'ACCOUNT_SUSPENDED',
          status: 'SUCCESS',
          metadata: { reason },
        },
      }),
    ]);

    return { message: 'User suspended successfully' };
  }

  /**
   * Activate a user account
   */
  async activateUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException(`User ${userId} not found`);
    }

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { isActive: true },
      }),
      this.prisma.authAuditLog.create({
        data: {
          userId,
          event: 'ACCOUNT_ACTIVATED',
          status: 'SUCCESS',
        },
      }),
    ]);

    return { message: 'User activated successfully' };
  }

  /**
   * Get user details with full activity
   */
  async getUserDetails(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        username: true,
        role: true,
        isActive: true,
        createdAt: true,
        lastLogin: true,
        isEmailVerified: true,
        profile: {
          select: {
            userId: true,
            fullName: true,
            displayName: true,
            targetExamId: true,
            targetExam: {
              select: {
                id: true,
                name: true,
              },
            },
            targetExamYear: true,
            preparationStage: true,
            createdAt: true,
            updatedAt: true,
          },
        },
        subscriptions: {
          select: {
            id: true,
            status: true,
            startedAt: true,
            expiresAt: true,
            pack: {
              select: {
                id: true,
                name: true,
                exam: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
              },
            },
          },
          orderBy: { startedAt: 'desc' },
          take: 10,
        },
        attempts: {
          where: { status: 'COMPLETED' },
          select: {
            id: true,
            totalScore: true,
            accuracy: true,
            percentile: true,
            completedAt: true,
            test: {
              select: {
                id: true,
                versionNumber: true,
                exam: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
              },
            },
          },
          orderBy: { completedAt: 'desc' },
          take: 10,
        },
        _count: {
          select: {
            attempts: true,
            sessions: true,
            authLogs: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException(`User ${userId} not found`);
    }

    return user;
  }

  /**
   * Get audit logs with filters
   */
  async getAuditLogs(options: {
    page?: number;
    limit?: number;
    userId?: string;
    event?: string;
    startDate?: Date;
    endDate?: Date;
  }) {
    const page = options.page || 1;
    const limit = options.limit || 50;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (options.userId) where.userId = options.userId;
    if (options.event) where.event = options.event;
    if (options.startDate || options.endDate) {
      where.createdAt = {};
      if (options.startDate) where.createdAt.gte = options.startDate;
      if (options.endDate) where.createdAt.lte = options.endDate;
    }

    const [logs, total] = await Promise.all([
      this.prisma.authAuditLog.findMany({
        where,
        skip,
        take: limit,
        include: {
          user: {
            select: {
              id: true,
              email: true,
              username: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.authAuditLog.count({ where }),
    ]);

    return {
      logs,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Override test visibility (force publish/archive)
   */
  async overrideTestVisibility(
    testId: string,
    status: 'PUBLISHED' | 'ARCHIVED',
  ) {
    const test = await this.prisma.test.findUnique({
      where: { id: testId },
    });

    if (!test) {
      throw new NotFoundException(`Test ${testId} not found`);
    }

    return this.prisma.test.update({
      where: { id: testId },
      data: { status },
    });
  }

  /**
   * Get system-wide test statistics
   */
  async getTestStatistics(examId?: string) {
    const where: any = examId ? { examId } : {};

    const tests = await this.prisma.test.findMany({
      where,
      select: {
        id: true,
        status: true,
        difficulty: true,
        totalQuestions: true,
        totalMarks: true,
        exam: {
          select: {
            id: true,
            name: true,
          },
        },
        _count: {
          select: {
            attempts: true,
          },
        },
      },
    });

    const summary = {
      total: tests.length,
      byStatus: {
        DRAFT: tests.filter((t) => t.status === 'DRAFT').length,
        PUBLISHED: tests.filter((t) => t.status === 'PUBLISHED').length,
        ARCHIVED: tests.filter((t) => t.status === 'ARCHIVED').length,
      },
      byDifficulty: {
        EASY: tests.filter((t) => t.difficulty === 'EASY').length,
        MEDIUM: tests.filter((t) => t.difficulty === 'MEDIUM').length,
        HARD: tests.filter((t) => t.difficulty === 'HARD').length,
        MIXED: tests.filter((t) => t.difficulty === 'MIXED').length,
      },
      totalAttempts: tests.reduce((sum, t) => sum + t._count.attempts, 0),
    };

    return { summary, tests };
  }

  /**
   * Get performance statistics for a specific test
   */
  async getTestPerformanceStats(testId: string) {
    const test = await this.prisma.test.findUnique({
      where: { id: testId },
      include: {
        exam: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    if (!test) {
      throw new NotFoundException(`Test ${testId} not found`);
    }

    const attempts = await this.prisma.testAttempt.findMany({
      where: {
        testId,
        status: 'COMPLETED',
      },
      select: {
        totalScore: true,
        accuracy: true,
        timeSpentSeconds: true,
        percentile: true,
      },
    });

    if (attempts.length === 0) {
      return {
        test,
        attempts: 0,
        stats: null,
      };
    }

    const scores = attempts.map((a) => Number(a.totalScore || 0));
    const accuracies = attempts.map((a) => Number(a.accuracy || 0));

    return {
      test,
      attempts: attempts.length,
      stats: {
        score: {
          avg: scores.reduce((a, b) => a + b, 0) / scores.length,
          min: Math.min(...scores),
          max: Math.max(...scores),
        },
        accuracy: {
          avg: accuracies.reduce((a, b) => a + b, 0) / accuracies.length,
          min: Math.min(...accuracies),
          max: Math.max(...accuracies),
        },
        avgTimeSeconds:
          attempts.reduce((sum, a) => sum + (a.timeSpentSeconds || 0), 0) /
          attempts.length,
      },
    };
  }

  /**
   * Delete user data (GDPR compliance)
   */
  async deleteUserData(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException(`User ${userId} not found`);
    }

    if (user.role === UserRole.ADMIN) {
      throw new BadRequestException('Cannot delete admin users');
    }

    // Cascade delete will handle related records due to schema constraints
    await this.prisma.user.delete({
      where: { id: userId },
    });

    return { message: 'User data deleted successfully' };
  }
}
