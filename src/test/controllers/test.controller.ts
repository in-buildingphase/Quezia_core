import { Controller, Patch, Get, Param, UseGuards } from '@nestjs/common';
import { TestService } from '../services/test.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserRole } from '@prisma/client';

@Controller('tests')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TestController {
    constructor(private readonly testService: TestService) { }

    @Patch(':id/publish')
    @Roles('admin')
    async publishTest(
        @Param('id') id: string,
        @CurrentUser() user: { role: UserRole },
    ) {
        return this.testService.publishTest(id, user.role);
    }

    @Patch(':id/archive')
    @Roles('admin')
    async archiveTest(
        @Param('id') id: string,
        @CurrentUser() user: { role: UserRole },
    ) {
        return this.testService.archiveTest(id, user.role);
    }

    @Get(':id')
    async getTest(
        @Param('id') id: string,
        @CurrentUser() user: { userId: string; role: UserRole },
    ) {
        return this.testService.getTestById(id, user.userId, user.role);
    }
}
