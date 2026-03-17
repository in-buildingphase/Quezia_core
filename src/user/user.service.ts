import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateContextDto } from './dto/update-context.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { AuthEventType, AuthEventStatus } from '@prisma/client';

@Injectable()
export class UserService {
  constructor(private readonly prisma: PrismaService) {}

  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        username: true,
        role: true,
        isActive: true,
        isEmailVerified: true,
        lastLogin: true,
        createdAt: true,
        profile: {
          select: {
            fullName: true,
            displayName: true,
            avatarUrl: true,
            country: true,
            timezone: true,
            targetExamId: true,
            targetExam: {
              select: {
                id: true,
                name: true,
              },
            },
            targetExamYear: true,
            preparationStage: true,
            studyGoal: true,
            preferredSubjects: true,
            preferredDifficultyBias: true,
            dailyStudyTimeTargetMinutes: true,
            notificationPreferences: true,
            preferredLanguage: true,
            onboardingCompleted: true,
            onboardingStep: true,
            initialDiagnosticTestId: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async updateContext(userId: string, payload: UpdateContextDto) {
    await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });

    if (payload.targetExamId) {
      const exam = await this.prisma.exam.findUnique({
        where: { id: payload.targetExamId },
      });
      if (!exam || !exam.isActive) {
        throw new BadRequestException('Target exam is invalid or not active');
      }
    }

    await this.prisma.userProfile.upsert({
      where: { userId },
      update: {
        ...(payload.targetExamId !== undefined && { targetExamId: payload.targetExamId }),
        ...(payload.targetExamYear !== undefined && {
          targetExamYear: payload.targetExamYear,
        }),
      },
      create: {
        userId,
        targetExamId: payload.targetExamId ?? null,
        targetExamYear: payload.targetExamYear ?? null,
      },
    });

    return this.getMe(userId);
  }

  async updateProfile(userId: string, payload: UpdateProfileDto) {
    await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });

    if (payload.targetExamId) {
      const exam = await this.prisma.exam.findUnique({
        where: { id: payload.targetExamId },
      });
      if (!exam || !exam.isActive) {
        throw new BadRequestException('Target exam is invalid or not active');
      }
    }

    const { preferredSubjects, notificationPreferences, ...rest } = payload;

    await this.prisma.userProfile.upsert({
      where: { userId },
      update: {
        ...rest,
        ...(preferredSubjects !== undefined && { preferredSubjects }),
        ...(notificationPreferences !== undefined && {
          notificationPreferences,
        }),
      },
      create: {
        userId,
        ...rest,
        ...(preferredSubjects !== undefined && { preferredSubjects }),
        ...(notificationPreferences !== undefined && {
          notificationPreferences,
        }),
      },
    });

    return this.getMe(userId);
  }

  async suspendUser(targetUserId: string): Promise<{ message: string }> {
    const user = await this.prisma.user.findUnique({
      where: { id: targetUserId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (!user.isActive) {
      throw new BadRequestException('User is already suspended');
    }

    await this.prisma.user.update({
      where: { id: targetUserId },
      data: { isActive: false },
    });

    // Invalidate all sessions immediately
    await this.prisma.session.deleteMany({ where: { userId: targetUserId } });

    await this.prisma.authAuditLog.create({
      data: {
        userId: targetUserId,
        event: AuthEventType.ACCOUNT_SUSPENDED,
        status: AuthEventStatus.SUCCESS,
        metadata: {},
      },
    });

    return { message: 'User suspended successfully' };
  }

  async activateUser(targetUserId: string): Promise<{ message: string }> {
    const user = await this.prisma.user.findUnique({
      where: { id: targetUserId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.isActive) {
      throw new BadRequestException('User is already active');
    }

    await this.prisma.user.update({
      where: { id: targetUserId },
      data: { isActive: true },
    });

    await this.prisma.authAuditLog.create({
      data: {
        userId: targetUserId,
        event: AuthEventType.ACCOUNT_ACTIVATED,
        status: AuthEventStatus.SUCCESS,
        metadata: {},
      },
    });

    return { message: 'User activated successfully' };
  }
}
