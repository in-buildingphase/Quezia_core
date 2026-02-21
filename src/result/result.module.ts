import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { GradingService } from './services/grading.service';

@Module({
    imports: [PrismaModule],
    providers: [GradingService],
    exports: [GradingService],
})
export class ResultModule { }
