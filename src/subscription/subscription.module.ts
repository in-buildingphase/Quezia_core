import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SubscriptionService } from './subscription.service';
import { SubscriptionController } from './subscription.controller';
import { SubscriptionGuard } from './guards/subscription.guard';

@Module({
    imports: [PrismaModule],
    controllers: [SubscriptionController],
    providers: [SubscriptionService, SubscriptionGuard],
    exports: [SubscriptionService, SubscriptionGuard],
})
export class SubscriptionModule {}
