import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * AUDIT LOGGING INTERCEPTOR
 * 
 * Logs all admin actions for compliance and security.
 * Applied to admin routes to track:
 * - User moderation actions
 * - Test visibility overrides
 * - Data access
 * - System configuration changes
 */
@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditLogInterceptor.name);

  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const { method, url, user, body, params, query } = request;

    const startTime = Date.now();

    // Extract admin user info
    const adminUserId = user?.userId;
    const adminEmail = user?.email;

    return next.handle().pipe(
      tap({
        next: (response) => {
          const duration = Date.now() - startTime;

          // Log to console
          this.logger.log(
            `[ADMIN ACTION] ${method} ${url} | User: ${adminEmail} | Duration: ${duration}ms`,
          );

          // Async logging to database (don't await to avoid blocking)
          this.logToDatabase({
            adminUserId,
            adminEmail,
            method,
            url,
            params,
            query,
            body,
            success: true,
            duration,
          }).catch((err) => {
            this.logger.error('Failed to log admin action to database', err);
          });
        },
        error: (error) => {
          const duration = Date.now() - startTime;

          // Log error to console
          this.logger.error(
            `[ADMIN ACTION FAILED] ${method} ${url} | User: ${adminEmail} | Error: ${error.message}`,
          );

          // Async logging to database
          this.logToDatabase({
            adminUserId,
            adminEmail,
            method,
            url,
            params,
            query,
            body,
            success: false,
            error: error.message,
            duration,
          }).catch((err) => {
            this.logger.error('Failed to log admin error to database', err);
          });
        },
      }),
    );
  }

  private async logToDatabase(logData: {
    adminUserId: string;
    adminEmail: string;
    method: string;
    url: string;
    params: any;
    query: any;
    body: any;
    success: boolean;
    error?: string;
    duration: number;
  }) {
    // Determine the event type from URL
    const event = this.determineEventType(logData.url, logData.method);

    // Sanitize sensitive data
    const sanitizedBody = this.sanitizeBody(logData.body);

    await this.prisma.authAuditLog.create({
      data: {
        userId: logData.adminUserId,
        event: event as any, // Map to existing auth event types or extend enum
        status: logData.success ? 'SUCCESS' : 'FAILURE',
        ipAddress: null, // Can be extracted from request if needed
        deviceInfo: null,
        metadata: {
          action: 'ADMIN_ACTION',
          method: logData.method,
          url: logData.url,
          params: logData.params,
          query: logData.query,
          body: sanitizedBody,
          error: logData.error,
          duration: logData.duration,
        },
      },
    });
  }

  private determineEventType(url: string, method: string): string {
    // Map admin actions to event types
    if (url.includes('/suspend')) return 'ACCOUNT_SUSPENDED';
    if (url.includes('/activate')) return 'ACCOUNT_ACTIVATED';
    
    // For other admin actions, use a generic type
    // Note: You may want to extend the AuthEventType enum to include admin-specific events
    return 'LOGIN'; // Fallback (ideally create new enum values)
  }

  private sanitizeBody(body: any): any {
    if (!body) return null;

    // Remove sensitive fields
    const sanitized = { ...body };
    const sensitiveFields = ['password', 'token', 'secret'];

    for (const field of sensitiveFields) {
      if (sanitized[field]) {
        sanitized[field] = '[REDACTED]';
      }
    }

    return sanitized;
  }
}
