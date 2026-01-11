import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../utils/tokenManager.js';
import { AuditLogger, AuditAction } from '../utils/auditLogger.js';
import prisma from '../config/database.js';

// Use the global Express.Request extension from rbac.ts
// No need to redefine the interface here

export const authenticateToken = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix
    
    // Use the new token manager with secrets
    const decoded = await verifyAccessToken(token);

    // Set user on request
    req.user = {
      userId: decoded.userId,
      email: decoded.email,
    };

    next();
  } catch (error: any) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        error: 'Token expired',
        code: 'TOKEN_EXPIRED',
      });
    }
    
    // Log failed authentication attempt
    await AuditLogger.log({
      action: AuditAction.ACCESS_DENIED,
      success: false,
      ipAddress: req.ip || req.socket.remoteAddress,
      userAgent: req.headers['user-agent'],
      metadata: { reason: 'Invalid token', endpoint: req.path },
    });
    
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

export const optionalAuth = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const decoded = await verifyAccessToken(token);
      
      req.user = {
        userId: decoded.userId,
        email: decoded.email,
      };
    }
    
    next();
  } catch (error) {
    // Invalid token, but continue without user
    next();
  }
};

/**
 * Require authentication - alias for authenticateToken
 */
export const requireAuth = authenticateToken;

/**
 * Require admin role
 */
export const requireAdmin = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.user?.userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Fetch user from database to check admin status
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: {
        id: true,
        email: true,
        isAdmin: true,
        role: true,
      },
    });

    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    // Check if user is admin
    if (!user.isAdmin && user.role !== 'ADMIN' && user.role !== 'SUPER_ADMIN') {
      // Log unauthorized admin access attempt
      await AuditLogger.log({
        userId: user.id,
        action: AuditAction.ACCESS_DENIED,
        resource: req.path,
        success: false,
        ipAddress: req.ip || req.socket.remoteAddress,
        userAgent: req.headers['user-agent'],
        metadata: { reason: 'Not an admin', role: user.role },
      });

      return res.status(403).json({ 
        error: 'Admin access required',
        message: 'You do not have permission to access this resource'
      });
    }

    // User is admin, proceed
    next();
  } catch (error) {
    console.error('Error in requireAdmin middleware:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Require staff role (instructor or admin)
 */
export const requireStaff = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.user?.userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: {
        id: true,
        email: true,
        isAdmin: true,
        isStaff: true,
        role: true,
      },
    });

    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    // Check if user is staff or admin
    const isStaffOrAdmin = 
      user.isAdmin || 
      user.isStaff || 
      user.role === 'ADMIN' || 
      user.role === 'SUPER_ADMIN' || 
      user.role === 'INSTRUCTOR' ||
      user.role === 'TEACHER';

    if (!isStaffOrAdmin) {
      await AuditLogger.log({
        userId: user.id,
        action: AuditAction.ACCESS_DENIED,
        resource: req.path,
        success: false,
        ipAddress: req.ip || req.socket.remoteAddress,
        userAgent: req.headers['user-agent'],
        metadata: { reason: 'Not staff', role: user.role },
      });

      return res.status(403).json({ 
        error: 'Staff access required',
        message: 'You do not have permission to access this resource'
      });
    }

    next();
  } catch (error) {
    console.error('Error in requireStaff middleware:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Require specific role
 */
export const requireRole = (allowedRoles: string[]) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user?.userId) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const user = await prisma.user.findUnique({
        where: { id: req.user.userId },
        select: {
          id: true,
          email: true,
          role: true,
          isAdmin: true,
        },
      });

      if (!user) {
        return res.status(401).json({ error: 'User not found' });
      }

      // Admins have access to everything
      if (user.isAdmin || user.role === 'ADMIN' || user.role === 'SUPER_ADMIN') {
        return next();
      }

      // Check if user's role is in allowed roles
      if (!allowedRoles.includes(user.role)) {
        await AuditLogger.log({
          userId: user.id,
          action: AuditAction.ACCESS_DENIED,
          resource: req.path,
          success: false,
          ipAddress: req.ip || req.socket.remoteAddress,
          userAgent: req.headers['user-agent'],
          metadata: { 
            reason: 'Insufficient role', 
            userRole: user.role,
            requiredRoles: allowedRoles 
          },
        });

        return res.status(403).json({ 
          error: 'Insufficient permissions',
          message: `This action requires one of the following roles: ${allowedRoles.join(', ')}`
        });
      }

      next();
    } catch (error) {
      console.error('Error in requireRole middleware:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  };
};

// Alias for backward compatibility
export const authenticate = authenticateToken;