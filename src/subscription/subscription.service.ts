import {
    BadRequestException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSubscriptionPackDto } from './dto/create-subscription-pack.dto';
import { UpdateSubscriptionPackDto } from './dto/update-subscription-pack.dto';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';

@Injectable()
export class SubscriptionService {
    constructor(private readonly prisma: PrismaService) {}

    // -------------------------------------------------------
    // SUBSCRIPTION PACK MANAGEMENT
    // -------------------------------------------------------

    async createPack(dto: CreateSubscriptionPackDto) {
        // Verify exam exists
        const exam = await this.prisma.exam.findUnique({
            where: { id: dto.examId },
        });
        if (!exam) {
            throw new NotFoundException(`Exam ${dto.examId} not found`);
        }

        return this.prisma.subscriptionPack.create({
            data: {
                examId: dto.examId,
                name: dto.name,
                durationDays: dto.durationDays,
                price: dto.price,
                isActive: dto.isActive ?? true,
            },
        });
    }

    async getAllPacks() {
        return this.prisma.subscriptionPack.findMany({
            include: {
                exam: { select: { id: true, name: true } },
                _count: { select: { subscriptions: true } },
            },
            orderBy: { exam: { name: 'asc' } },
        });
    }

    async getPacksByExam(examId: string) {
        return this.prisma.subscriptionPack.findMany({
            where: { examId },
            include: {
                _count: { select: { subscriptions: true } },
            },
        });
    }

    async getPackById(id: string) {
        const pack = await this.prisma.subscriptionPack.findUnique({
            where: { id },
            include: {
                exam: { select: { id: true, name: true } },
            },
        });
        if (!pack) {
            throw new NotFoundException(`Subscription pack ${id} not found`);
        }
        return pack;
    }

    async updatePack(id: string, dto: UpdateSubscriptionPackDto) {
        await this.getPackById(id);
        return this.prisma.subscriptionPack.update({
            where: { id },
            data: {
                ...(dto.name !== undefined && { name: dto.name }),
                ...(dto.durationDays !== undefined && {
                    durationDays: dto.durationDays,
                }),
                ...(dto.price !== undefined && { price: dto.price }),
                ...(dto.isActive !== undefined && { isActive: dto.isActive }),
            },
        });
    }

    async togglePackStatus(id: string) {
        const pack = await this.getPackById(id);
        return this.prisma.subscriptionPack.update({
            where: { id },
            data: { isActive: !pack.isActive },
        });
    }

    // -------------------------------------------------------
    // USER SUBSCRIPTION MANAGEMENT
    // -------------------------------------------------------

    /**
     * Called on payment success.
     * Computes expiry from pack.durationDays and stores provider reference.
     * Cancels any existing ACTIVE subscription for the same exam before
     * creating the new one (renewal handling).
     */
    async createSubscription(userId: string, dto: CreateSubscriptionDto) {
        const pack = await this.getPackById(dto.packId);
        if (!pack.isActive) {
            throw new BadRequestException(
                `Subscription pack ${dto.packId} is not active`,
            );
        }

        // Renewal: cancel current active subscriptions for this exam, if any.
        // updateMany does not support relation filters, so we resolve IDs first.
        const existingSubs = await this.prisma.userSubscription.findMany({
            where: {
                userId,
                status: SubscriptionStatus.ACTIVE,
                pack: { examId: pack.examId },
            },
            select: { id: true },
        });
        if (existingSubs.length > 0) {
            await this.prisma.userSubscription.updateMany({
                where: { id: { in: existingSubs.map((s) => s.id) } },
                data: { status: SubscriptionStatus.CANCELLED },
            });
        }

        const now = new Date();
        const expiresAt = new Date(now);
        expiresAt.setDate(expiresAt.getDate() + pack.durationDays);

        return this.prisma.userSubscription.create({
            data: {
                userId,
                packId: dto.packId,
                status: SubscriptionStatus.ACTIVE,
                startedAt: now,
                expiresAt,
                paymentProvider: dto.paymentProvider ?? null,
                providerReference: dto.providerReference ?? null,
            },
            include: {
                pack: { include: { exam: { select: { id: true, name: true } } } },
            },
        });
    }

    async getSubscriptionsForUser(userId: string) {
        return this.prisma.userSubscription.findMany({
            where: { userId },
            include: {
                pack: { include: { exam: { select: { id: true, name: true } } } },
            },
            orderBy: { startedAt: 'desc' },
        });
    }

    async cancelSubscription(userId: string, subscriptionId: string) {
        const sub = await this.prisma.userSubscription.findUnique({
            where: { id: subscriptionId },
        });
        if (!sub || sub.userId !== userId) {
            throw new NotFoundException(`Subscription ${subscriptionId} not found`);
        }
        if (sub.status !== SubscriptionStatus.ACTIVE) {
            throw new BadRequestException(
                `Only ACTIVE subscriptions can be cancelled`,
            );
        }
        return this.prisma.userSubscription.update({
            where: { id: subscriptionId },
            data: { status: SubscriptionStatus.CANCELLED },
        });
    }

    /**
     * Expire all subscriptions whose expiresAt has passed.
     * Intended to be called by a cron job or on-demand by an admin.
     */
    async expireStaleSubscriptions() {
        const now = new Date();
        const result = await this.prisma.userSubscription.updateMany({
            where: {
                status: SubscriptionStatus.ACTIVE,
                expiresAt: { lt: now },
            },
            data: { status: SubscriptionStatus.EXPIRED },
        });
        return { expired: result.count };
    }

    // -------------------------------------------------------
    // ACCESS VALIDATION
    // -------------------------------------------------------

    /**
     * Returns true if the user has an ACTIVE, non-expired subscription
     * that covers the given examId.
     */
    async hasActiveAccess(userId: string, examId: string): Promise<boolean> {
        const now = new Date();
        const sub = await this.prisma.userSubscription.findFirst({
            where: {
                userId,
                status: SubscriptionStatus.ACTIVE,
                expiresAt: { gt: now },
                pack: { examId },
            },
        });
        return sub !== null;
    }

    /**
     * Returns the active subscription record for an exam or null.
     */
    async getActiveSubscription(userId: string, examId: string) {
        const now = new Date();
        return this.prisma.userSubscription.findFirst({
            where: {
                userId,
                status: SubscriptionStatus.ACTIVE,
                expiresAt: { gt: now },
                pack: { examId },
            },
            include: {
                pack: { include: { exam: { select: { id: true, name: true } } } },
            },
        });
    }

    // -------------------------------------------------------
    // ADMIN HELPERS
    // -------------------------------------------------------

    async getAllSubscriptions(page = 1, limit = 50) {
        const skip = (page - 1) * limit;
        const [total, items] = await Promise.all([
            this.prisma.userSubscription.count(),
            this.prisma.userSubscription.findMany({
                skip,
                take: limit,
                include: {
                    pack: {
                        include: { exam: { select: { id: true, name: true } } },
                    },
                    user: { select: { id: true, email: true, username: true } },
                },
                orderBy: { startedAt: 'desc' },
            }),
        ]);
        return { total, page, limit, items };
    }

    /**
     * Admin override: grant access by creating an active subscription
     * without payment (providerReference = 'ADMIN_OVERRIDE').
     */
    async adminGrantAccess(
        userId: string,
        packId: string,
        durationDaysOverride?: number,
    ) {
        const pack = await this.getPackById(packId);

        const existingForGrant = await this.prisma.userSubscription.findMany({
            where: {
                userId,
                status: SubscriptionStatus.ACTIVE,
                pack: { examId: pack.examId },
            },
            select: { id: true },
        });
        if (existingForGrant.length > 0) {
            await this.prisma.userSubscription.updateMany({
                where: { id: { in: existingForGrant.map((s) => s.id) } },
                data: { status: SubscriptionStatus.CANCELLED },
            });
        }

        const now = new Date();
        const days =
            durationDaysOverride !== undefined
                ? durationDaysOverride
                : pack.durationDays;
        const expiresAt = new Date(now);
        expiresAt.setDate(expiresAt.getDate() + days);

        return this.prisma.userSubscription.create({
            data: {
                userId,
                packId,
                status: SubscriptionStatus.ACTIVE,
                startedAt: now,
                expiresAt,
                paymentProvider: 'ADMIN',
                providerReference: 'ADMIN_OVERRIDE',
            },
        });
    }
}
