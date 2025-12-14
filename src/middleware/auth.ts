import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

// Use the global Express.Request extension from rbac.ts
// No need to redefine the interface here

export const authenticateToken = (req: Request, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as {
      userId: string;
      email: string;
      name: string;
      ghlUserId?: string;
    };

    // Set user on request
    req.user = {
      userId: decoded.userId,
      email: decoded.email,
      name: decoded.name,
      ghlUserId: decoded.ghlUserId,
    };

    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

export const optionalAuth = (req: Request, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const decoded = jwt.verify(token, process.env.JWT_SECRET!) as {
        userId: string;
        email: string;
        name: string;
        ghlUserId?: string;
      };
      
      req.user = {
        userId: decoded.userId,
        email: decoded.email,
        name: decoded.name,
        ghlUserId: decoded.ghlUserId,
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