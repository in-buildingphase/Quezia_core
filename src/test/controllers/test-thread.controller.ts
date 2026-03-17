import { Controller, Post, Get, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { TestService } from '../services/test.service';
import { CreateThreadDto } from '../dto/create-thread.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserRole } from '@prisma/client';

@Controller('test-threads')
@UseGuards(JwtAuthGuard)
export class TestThreadController {
  constructor(private readonly testService: TestService) { }

  @Get()
  async listThreads(
    @CurrentUser() user: { userId: string; role: UserRole },
  ) {
    return this.testService.getThreadsByUser(user.userId, user.role);
  }

  @Post()
  async createThread(
    @Body() dto: CreateThreadDto,
    @CurrentUser() user: { userId: string; role: UserRole },
  ) {
    return this.testService.createThread(dto, user.userId);
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

  @Delete(':id')
  async deleteThread(
    @Param('id') id: string,
    @CurrentUser() user: { userId: string; role: UserRole },
  ) {
    return this.testService.deleteThread(id, user.userId, user.role);
  }
}
