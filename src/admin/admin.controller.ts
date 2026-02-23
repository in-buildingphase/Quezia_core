import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  UseGuards,
  UseInterceptors,
  ParseIntPipe,
  DefaultValuePipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AdminService } from './admin.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { AuditLogInterceptor } from '../common/interceptors/audit-log.interceptor';

/**
 * ADMIN CONTROLLER
 * 
 * All endpoints require ADMIN role.
 * Provides:
 * - System-wide analytics
 * - User moderation
 * - Audit log viewing
 * - Test management
 * - Advanced administrative operations
 * 
 * All actions are logged via AuditLogInterceptor
 */
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@UseInterceptors(AuditLogInterceptor)
@Roles('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  /**
   * Get system-wide analytics dashboard
   */
  @Get('analytics/system')
  async getSystemAnalytics() {
    return this.adminService.getSystemAnalytics();
  }

  /**
   * Get exam-specific analytics
   */
  @Get('analytics/exam/:examId')
  async getExamAnalytics(@Param('examId') examId: string) {
    return this.adminService.getExamAnalytics(examId);
  }

  /**
   * Get all users with filters and pagination
   */
  @Get('users')
  async getUsers(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('role') role?: string,
    @Query('isActive') isActive?: string,
    @Query('search') search?: string,
  ) {
    return this.adminService.getUsers({
      page,
      limit,
      role: role as any,
      isActive: isActive === 'true' ? true : isActive === 'false' ? false : undefined,
      search,
    });
  }

  /**
   * Get detailed user information
   */
  @Get('users/:userId')
  async getUserDetails(@Param('userId') userId: string) {
    return this.adminService.getUserDetails(userId);
  }

  /**
   * Suspend a user account
   */
  @Post('users/:userId/suspend')
  @HttpCode(HttpStatus.OK)
  async suspendUser(
    @Param('userId') userId: string,
    @Body('reason') reason?: string,
  ) {
    return this.adminService.suspendUser(userId, reason);
  }

  /**
   * Activate a user account
   */
  @Post('users/:userId/activate')
  @HttpCode(HttpStatus.OK)
  async activateUser(@Param('userId') userId: string) {
    return this.adminService.activateUser(userId);
  }

  /**
   * Delete user data (GDPR)
   */
  @Delete('users/:userId')
  async deleteUser(@Param('userId') userId: string) {
    return this.adminService.deleteUserData(userId);
  }

  /**
   * Get audit logs with filters
   */
  @Get('audit-logs')
  async getAuditLogs(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('userId') userId?: string,
    @Query('event') event?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.adminService.getAuditLogs({
      page,
      limit,
      userId,
      event,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
    });
  }

  /**
   * Get test statistics
   */
  @Get('tests/statistics')
  async getTestStatistics(@Query('examId') examId?: string) {
    return this.adminService.getTestStatistics(examId);
  }

  /**
   * Get performance stats for a specific test
   */
  @Get('tests/:testId/performance')
  async getTestPerformanceStats(@Param('testId') testId: string) {
    return this.adminService.getTestPerformanceStats(testId);
  }

  /**
   * Override test visibility (admin override)
   */
  @Patch('tests/:testId/visibility')
  async overrideTestVisibility(
    @Param('testId') testId: string,
    @Body('status') status: 'PUBLISHED' | 'ARCHIVED',
  ) {
    return this.adminService.overrideTestVisibility(testId, status);
  }
}
