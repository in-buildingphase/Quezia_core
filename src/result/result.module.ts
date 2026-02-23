import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { GradingService } from './services/grading.service';
import { AnalyticsService } from './services/analytics.service';
import { TimeEfficiencyService } from './services/time-efficiency.service';
import { RiskRatioService } from './services/risk-ratio.service';
import { TopicHealthService } from './services/topic-health.service';
import { PeerBenchmarkService } from './services/peer-benchmark.service';
import { AnalyticsController } from './controllers/analytics.controller';

@Module({
    imports: [PrismaModule],
    controllers: [AnalyticsController],
    providers: [
        GradingService,
        AnalyticsService,
        TimeEfficiencyService,
        RiskRatioService,
        TopicHealthService,
        PeerBenchmarkService,
    ],
    exports: [
        GradingService,
        AnalyticsService,
        TimeEfficiencyService,
        RiskRatioService,
        TopicHealthService,
        PeerBenchmarkService,
    ],
})
export class ResultModule { }
