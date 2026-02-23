import {
    Body,
    Controller,
    Delete,
    Get,
    HttpCode,
    HttpStatus,
    Param,
    Patch,
    Post,
    UseGuards,
} from '@nestjs/common';
import { ExamService } from './exam.service';
import { CreateExamDto } from './dto/create-exam.dto';
import { UpdateExamDto } from './dto/update-exam.dto';
import { CreateBlueprintDto } from './dto/create-blueprint.dto';
import { ActivateBlueprintDto } from './dto/activate-blueprint.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('exams')
export class ExamController {
    constructor(private readonly examService: ExamService) { }

    // -------------------------------------------------------
    // EXAM ENDPOINTS
    // -------------------------------------------------------

    @Post()
    @Roles('admin')
    createExam(@Body() dto: CreateExamDto) {
        return this.examService.createExam(dto);
    }

    @Get()
    getAllExams() {
        return this.examService.getAllExams();
    }

    @Get(':id')
    getExamById(@Param('id') id: string) {
        return this.examService.getExamById(id);
    }

    /**
     * Update exam details and/or activate / deactivate it.
     * PATCH /exams/:id  { isActive: false } → deactivate
     */
    @Patch(':id')
    @Roles('admin')
    updateExam(@Param('id') id: string, @Body() dto: UpdateExamDto) {
        return this.examService.updateExam(id, dto);
    }

    /**
     * DELETE /exams/:id
     * Permanently removes an exam. Rejected with 400 if any tests reference it.
     */
    @Delete(':id')
    @Roles('admin')
    @HttpCode(HttpStatus.OK)
    deleteExam(@Param('id') id: string) {
        return this.examService.deleteExam(id);
    }

    /**
     * DELETE /exams/blueprints/:id
     * Permanently removes a blueprint. Rejected with 400 if any tests reference it.
     */
    @Delete('blueprints/:id')
    @Roles('admin')
    @HttpCode(HttpStatus.OK)
    deleteBlueprint(@Param('id') id: string) {
        return this.examService.deleteBlueprint(id);
    }

    // -------------------------------------------------------
    // BLUEPRINT ENDPOINTS
    // -------------------------------------------------------

    @Post(':id/blueprints')
    @Roles('admin')
    createBlueprint(@Param('id') id: string, @Body() dto: CreateBlueprintDto) {
        return this.examService.createBlueprint(id, dto);
    }

    @Get('blueprints/:id')
    getBlueprintById(@Param('id') id: string) {
        return this.examService.getBlueprintById(id);
    }

    /**
     * Update the effective date window for a blueprint
     * (makes it active between the supplied dates).
     */
    @Post('blueprints/:id/activate')
    @Roles('admin')
    activateBlueprint(
        @Param('id') id: string,
        @Body() dto: ActivateBlueprintDto,
    ) {
        return this.examService.activateBlueprint(id, dto);
    }

    /**
     * Archive a blueprint by setting its effectiveTo to now.
     * Archived blueprints will no longer be returned as the active blueprint
     * for an exam.
     */
    @Post('blueprints/:id/archive')
    @Roles('admin')
    archiveBlueprint(@Param('id') id: string) {
        return this.examService.archiveBlueprint(id);
    }

    /**
     * Returns the currently active blueprint for an exam (by date).
     * This is a read-only reference — it must never drive runtime test behaviour.
     */
    @Get(':id/blueprints/active')
    getActiveBlueprint(@Param('id') id: string) {
        return this.examService.getActiveBlueprint(id);
    }
}

