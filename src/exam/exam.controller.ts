import {
    Body,
    Controller,
    Get,
    Param,
    Patch,
    Post,
    UseGuards,
} from '@nestjs/common';
import { ExamService } from './exam.service';
import { CreateExamDto } from './dto/create-exam.dto';
import { CreateBlueprintDto } from './dto/create-blueprint.dto';
import { ActivateBlueprintDto } from './dto/activate-blueprint.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('exams')
export class ExamController {
    constructor(private readonly examService: ExamService) { }

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

    @Post(':id/blueprints')
    @Roles('admin')
    createBlueprint(@Param('id') id: string, @Body() dto: CreateBlueprintDto) {
        return this.examService.createBlueprint(id, dto);
    }

    @Get('blueprints/:id')
    getBlueprintById(@Param('id') id: string) {
        return this.examService.getBlueprintById(id);
    }

    @Post('blueprints/:id/activate')
    @Roles('admin')
    activateBlueprint(
        @Param('id') id: string,
        @Body() dto: ActivateBlueprintDto,
    ) {
        return this.examService.activateBlueprint(id, dto);
    }
}
