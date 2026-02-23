import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    Patch,
    Post,
    Query,
    UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SubscriptionService } from './subscription.service';
import { CreateSubscriptionPackDto } from './dto/create-subscription-pack.dto';
import { UpdateSubscriptionPackDto } from './dto/update-subscription-pack.dto';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('subscriptions')
export class SubscriptionController {
    constructor(private readonly subscriptionService: SubscriptionService) {}

    // -------------------------------------------------------
    // SUBSCRIPTION PACK ENDPOINTS (admin)
    // -------------------------------------------------------

    @Post('packs')
    @Roles('admin')
    createPack(@Body() dto: CreateSubscriptionPackDto) {
        return this.subscriptionService.createPack(dto);
    }

    @Get('packs')
    getAllPacks() {
        return this.subscriptionService.getAllPacks();
    }

    @Get('packs/exam/:examId')
    getPacksByExam(@Param('examId') examId: string) {
        return this.subscriptionService.getPacksByExam(examId);
    }

    @Get('packs/:id')
    getPackById(@Param('id') id: string) {
        return this.subscriptionService.getPackById(id);
    }

    @Patch('packs/:id')
    @Roles('admin')
    updatePack(@Param('id') id: string, @Body() dto: UpdateSubscriptionPackDto) {
        return this.subscriptionService.updatePack(id, dto);
    }

    @Patch('packs/:id/toggle')
    @Roles('admin')
    togglePackStatus(@Param('id') id: string) {
        return this.subscriptionService.togglePackStatus(id);
    }

    // -------------------------------------------------------
    // USER SUBSCRIPTION ENDPOINTS (learner)
    // -------------------------------------------------------

    /**
     * Called after successful payment confirmation.
     * The payment provider + reference should be passed in the body.
     */
    @Post('subscribe')
    subscribe(
        @CurrentUser() user: { userId: string },
        @Body() dto: CreateSubscriptionDto,
    ) {
        return this.subscriptionService.createSubscription(user.userId, dto);
    }

    @Get('my')
    getMySubscriptions(@CurrentUser() user: { userId: string }) {
        return this.subscriptionService.getSubscriptionsForUser(user.userId);
    }

    @Delete('my/:id/cancel')
    cancelMySubscription(
        @CurrentUser() user: { userId: string },
        @Param('id') id: string,
    ) {
        return this.subscriptionService.cancelSubscription(user.userId, id);
    }

    @Get('my/access/:examId')
    checkAccess(
        @CurrentUser() user: { userId: string },
        @Param('examId') examId: string,
    ) {
        return this.subscriptionService.getActiveSubscription(user.userId, examId);
    }

    // -------------------------------------------------------
    // ADMIN ENDPOINTS
    // -------------------------------------------------------

    @Get('admin/all')
    @Roles('admin')
    getAllSubscriptions(
        @Query('page') page?: string,
        @Query('limit') limit?: string,
    ) {
        return this.subscriptionService.getAllSubscriptions(
            page ? parseInt(page, 10) : 1,
            limit ? parseInt(limit, 10) : 50,
        );
    }

    @Post('admin/grant')
    @Roles('admin')
    adminGrant(
        @Body()
        body: {
            userId: string;
            packId: string;
            durationDaysOverride?: number;
        },
    ) {
        return this.subscriptionService.adminGrantAccess(
            body.userId,
            body.packId,
            body.durationDaysOverride,
        );
    }

    @Post('admin/expire-stale')
    @Roles('admin')
    expireStale() {
        return this.subscriptionService.expireStaleSubscriptions();
    }
}
