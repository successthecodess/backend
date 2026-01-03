import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../utils/tokenManager.js';
import { AuditLogger, AuditAction } from '../utils/auditLogger.js';

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

// Alias for backward compatibility
export const authenticate = authenticateToken;