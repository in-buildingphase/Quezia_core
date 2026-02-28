import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { SubscriptionService } from '../subscription.service';

export const SUBSCRIPTION_EXAM_KEY = 'subscriptionExamParam';

/**
 * Guards a route so that only users with an ACTIVE subscription for
 * the relevant exam can proceed.
 *
 * The exam ID is resolved (in priority order) from:
 *   1. request.params.examId
 *   2. request.body.examId
 *   3. request.query.examId
 *
 * Admins bypass this check entirely.
 *
 * Usage:
 *   @UseGuards(JwtAuthGuard, SubscriptionGuard)
 */
@Injectable()
export class SubscriptionGuard implements CanActivate {
  constructor(
    private readonly subscriptionService: SubscriptionService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('Authentication required');
    }

    // Admins bypass subscription check
    if (user.role === UserRole.ADMIN) {
      return true;
    }

    // Resolve examId from params, body, or query
    const examId =
      request.params?.examId ?? request.body?.examId ?? request.query?.examId;

    if (!examId) {
      throw new ForbiddenException(
        'Could not determine exam context for subscription check',
      );
    }

    const hasAccess = await this.subscriptionService.hasActiveAccess(
      user.userId,
      examId,
    );

    if (!hasAccess) {
      throw new ForbiddenException(
        `No active subscription found for exam ${examId}`,
      );
    }

    return true;
  }
}
