import {
    Controller,
    Patch,
    Get,
    Post,
    Delete,
    Body,
    Param,
    UseGuards,
} from '@nestjs/common';
import { TestService } from '../services/test.service';
import { TestQuestionInjectionService } from '../services/test-question-injection.service';
import { InjectQuestionsDto } from '../dto/inject-questions.dto';
import { ReorderQuestionsDto } from '../dto/reorder-questions.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserRole } from '@prisma/client';

@Controller('tests')
@UseGuards(JwtAuthGuard)
export class TestController {
    constructor(
        private readonly testService: TestService,
        private readonly injectionService: TestQuestionInjectionService,
    ) { }

    // ─── Status Transitions (admin only) ────────────────────────────────────

    @Patch(':id/publish')
    @UseGuards(RolesGuard)
    @Roles('admin')
    async publishTest(
        @Param('id') id: string,
        @CurrentUser() user: { role: UserRole },
    ) {
        return this.testService.publishTest(id, user.role);
    }

    @Patch(':id/archive')
    @UseGuards(RolesGuard)
    @Roles('admin')
    async archiveTest(
        @Param('id') id: string,
        @CurrentUser() user: { role: UserRole },
    ) {
        return this.testService.archiveTest(id, user.role);
    }

    /**
     * DELETE /tests/:id
     * Permanently delete a test. Rejected with 400 if any attempts exist.
     */
    @Delete(':id')
    @UseGuards(RolesGuard)
    @Roles('admin')
    async deleteTest(
        @Param('id') id: string,
        @CurrentUser() user: { role: UserRole },
    ) {
        return this.testService.deleteTest(id, user.role);
    }

    // ─── Test Details ────────────────────────────────────────────────────────

    @Get(':id')
    async getTest(
        @Param('id') id: string,
        @CurrentUser() user: { userId: string; role: UserRole },
    ) {
        return this.testService.getTestById(id, user.userId, user.role);
    }

    // ─── Question Snapshot Layer ─────────────────────────────────────────────

    /**
     * POST /tests/:id/questions
     * Inject externally validated questions into a DRAFT test.
     * Validates structure, content, and metadata against sectionSnapshot + ruleSnapshot.
     * Snapshots each question as an immutable TestQuestion record.
     */
    @Post(':id/questions')
    async injectQuestions(
        @Param('id') testId: string,
        @Body() dto: InjectQuestionsDto,
        @CurrentUser() user: { userId: string; role: UserRole },
    ) {
        return this.injectionService.injectQuestions(testId, dto, user.userId, user.role);
    }

    /**
     * GET /tests/:id/questions
     * List all snapshotted questions in this test (ordered by sequence).
     */
    @Get(':id/questions')
    async getTestQuestions(
        @Param('id') testId: string,
        @CurrentUser() user: { userId: string; role: UserRole },
    ) {
        return this.injectionService.getTestQuestions(testId, user.userId, user.role);
    }

    /**
     * DELETE /tests/:id/questions/:questionSnapshotId
     * Remove a question snapshot from a DRAFT test (no completed attempts).
     * After removal sequences are compacted automatically.
     */
    @Delete(':id/questions/:questionSnapshotId')
    async removeQuestion(
        @Param('id') testId: string,
        @Param('questionSnapshotId') questionSnapshotId: string,
        @CurrentUser() user: { userId: string; role: UserRole },
    ) {
        return this.injectionService.removeQuestionSnapshot(
            testId,
            questionSnapshotId,
            user.userId,
            user.role,
        );
    }

    /**
     * Patch /tests/:id/questions/reorder
     * Reorder questions in a DRAFT test by supplying an ordered array of TestQuestion ids.
     */
    @Patch(':id/questions/reorder')
    async reorderQuestions(
        @Param('id') testId: string,
        @Body() dto: ReorderQuestionsDto,
        @CurrentUser() user: { userId: string; role: UserRole },
    ) {
        return this.injectionService.reorderQuestions(
            testId,
            dto.orderedIds,
            user.userId,
            user.role,
        );
    }
}

