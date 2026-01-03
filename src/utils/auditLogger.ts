import prisma from '../config/database.js';

export enum AuditAction {
  // Authentication
  LOGIN = 'LOGIN',
  SIGNUP = 'SIGNUP',
  LOGOUT = 'LOGOUT',
  TOKEN_REFRESH = 'TOKEN_REFRESH',
  PASSWORD_RESET = 'PASSWORD_RESET',
  
  // Admin actions
  ADMIN_GRANT = 'ADMIN_GRANT',
  ADMIN_REVOKE = 'ADMIN_REVOKE',
  ROLE_CHANGE = 'ROLE_CHANGE',
  
  // Tag management
  TAG_ADD = 'TAG_ADD',
  TAG_REMOVE = 'TAG_REMOVE',
  TAG_SYNC = 'TAG_SYNC',
  
  // User management
  USER_CREATE = 'USER_CREATE',
  USER_UPDATE = 'USER_UPDATE',
  USER_DELETE = 'USER_DELETE',
  
  // Access attempts
  ACCESS_DENIED = 'ACCESS_DENIED',
  RATE_LIMIT_HIT = 'RATE_LIMIT_HIT',
  
  // Data access
  SENSITIVE_DATA_ACCESS = 'SENSITIVE_DATA_ACCESS',
  EXPORT_DATA = 'EXPORT_DATA',
}

interface AuditLogParams {
  userId?: string;
  action: AuditAction;
  resource?: string;
  success: boolean;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, any>;
}

export class AuditLogger {
  static async log(params: AuditLogParams): Promise<void> {
    try {
      await prisma.auditLog.create({
        data: {
          userId: params.userId,
          action: params.action,
          resource: params.resource,
          success: params.success,
          ipAddress: params.ipAddress,
          userAgent: params.userAgent,
          metadata: params.metadata || {},
        },
      });
    } catch (error) {
      // Don't let audit logging failure break the app
      console.error('❌ Failed to create audit log:', error);
    }
  }

  // Convenience methods
  static async logAuth(
    action: AuditAction,
    userId: string | undefined,
    success: boolean,
    req: any
  ) {
    await this.log({
      userId,
      action,
      success,
      ipAddress: req.ip || req.socket.remoteAddress,
      userAgent: req.headers['user-agent'],
    });
  }

  static async logAdminAction(
    action: AuditAction,
    adminId: string,
    targetResource: string,
    success: boolean,
    metadata?: Record<string, any>
  ) {
    await this.log({
      userId: adminId,
      action,
      resource: targetResource,
      success,
      metadata,
    });
  }

  // Query audit logs
  static async getRecentLogs(limit: number = 100) {
    return await prisma.auditLog.findMany({
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { email: true, name: true } } },
    });
  }

  static async getUserLogs(userId: string, limit: number = 50) {
    return await prisma.auditLog.findMany({
      where: { userId },
      take: limit,
      orderBy: { createdAt: 'desc' },
    });
  }

  static async getFailedLogins(hours: number = 24) {
    return await prisma.auditLog.findMany({
      where: {
        action: AuditAction.LOGIN,
        success: false,
        createdAt: {
          gte: new Date(Date.now() - hours * 60 * 60 * 1000),
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}