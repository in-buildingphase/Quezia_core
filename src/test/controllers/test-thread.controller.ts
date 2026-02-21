import { Controller, Post, Get, Body, Param, UseGuards } from '@nestjs/common';
import { TestService } from '../services/test.service';
import { CreateThreadDto } from '../dto/create-thread.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserRole } from '@prisma/client';

@Controller('test-threads')
@UseGuards(JwtAuthGuard)
export class TestThreadController {
    constructor(private readonly testService: TestService) { }

    @Post()
    async createThread(
        @Body() dto: CreateThreadDto,
        @CurrentUser() user: { userId: string; role: UserRole },
    ) {
        return this.testService.createThread(dto, user.userId, user.role);
    }

    @Get(':id')
    async getThread(
        @Param('id') id: string,
        @CurrentUser() user: { userId: string; role: UserRole },
    ) {
        return this.testService.getThreadById(id, user.userId, user.role);
    }

    @Get(':id/latest')
    async getLatestVersion(
        @Param('id') id: string,
        @CurrentUser() user: { userId: string; role: UserRole },
    ) {
        return this.testService.getLatestVersion(id, user.userId, user.role);
    }
}
