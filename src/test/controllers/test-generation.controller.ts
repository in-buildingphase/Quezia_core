import { Controller, Post, Body, Param, UseGuards } from '@nestjs/common';
import { TestGenerationService } from '../services/test-generation.service';
import { GenerateTestDto } from '../dto/generate-test.dto';
import { RegenerateTestDto } from '../dto/regenerate-test.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserRole } from '@prisma/client';

@Controller('test-threads')
@UseGuards(JwtAuthGuard)
export class TestGenerationController {
    constructor(private readonly generationService: TestGenerationService) { }

    @Post(':threadId/generate')
    async generateInitial(
        @Param('threadId') threadId: string,
        @Body() dto: GenerateTestDto,
        @CurrentUser() user: { userId: string; role: UserRole },
    ) {
        return this.generationService.generateInitial(threadId, dto, user.userId, user.role);
    }

    @Post(':threadId/regenerate')
    async regenerate(
        @Param('threadId') threadId: string,
        @Body() dto: RegenerateTestDto,
        @CurrentUser() user: { userId: string; role: UserRole },
    ) {
        return this.generationService.regenerate(threadId, dto, user.userId, user.role);
    }
}
