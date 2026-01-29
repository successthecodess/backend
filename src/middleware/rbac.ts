import { Request, Response, NextFunction } from 'express';
import prisma from '../config/database.js';
import { UserRole } from '@prisma/client';

// Extend Express Request
declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: string;
        email: string;
        name?: string;
        ghlUserId?: string;
        role?: UserRole;
        isAdmin?: boolean;
        isStaff?: boolean;
      };
    }
  }
}

// Re-export requireAdmin and requireStaff from auth.ts to avoid duplication
// The auth.ts implementations include audit logging for security events
export { requireAdmin, requireStaff } from './auth.js';

// Check feature access
export const requireFeature = (featureName: string) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const [user, feature] = await Promise.all([
        prisma.user.findUnique({
          where: { id: req.user.userId },
          select: {
            ghlTags: true,
            isPremium: true,
            isStaff: true,
            isAdmin: true,
            hasAccessToQuestionBank: true,
            hasAccessToTimedPractice: true,
            hasAccessToAnalytics: true,
          }
        }),
        prisma.featureFlag.findUnique({
          where: { name: featureName }
        })
      ]);

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Admins and staff bypass feature checks
      if (user.isAdmin || user.isStaff) {
        return next();
      }

      if (!feature) {
        return res.status(404).json({ error: 'Feature not found' });
      }

      if (!feature.isEnabled) {
        return res.status(403).json({ 
          error: 'This feature is currently disabled',
          feature: featureName
        });
      }

      // Check premium requirement
      if (feature.requiresPremium && !user.isPremium) {
        return res.status(403).json({ 
          error: 'This feature requires premium access',
          feature: featureName,
          upgrade: true
        });
      }

      // Check GHL tag requirement
      if (feature.requiredGhlTag) {
        const hasTag = user.ghlTags.includes(feature.requiredGhlTag);
        if (!hasTag) {
          return res.status(403).json({ 
            error: 'You do not have access to this feature. Contact your instructor.',
            feature: featureName,
            requiredTag: feature.requiredGhlTag
          });
        }
      }

      next();
    } catch (error) {
      res.status(500).json({ error: 'Feature access check failed' });
    }
  };
};

// Check course access
export const requireCourse = (courseSlug: string) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const [user, course] = await Promise.all([
        prisma.user.findUnique({
          where: { id: req.user.userId },
          select: {
            ghlTags: true,
            isStaff: true,
            isAdmin: true,
            hasAccessToQuestionBank: true,
          }
        }),
        prisma.courseAccess.findUnique({
          where: { courseSlug }
        })
      ]);

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Staff and admin always have access
      if (user.isStaff || user.isAdmin) {
        return next();
      }

      if (!course) {
        return res.status(404).json({ error: 'Course not found' });
      }

      if (!course.isActive) {
        return res.status(403).json({ 
          error: 'This course is currently unavailable',
          course: courseSlug
        });
      }

      // Check GHL tag
      const hasTag = user.ghlTags.includes(course.requiredGhlTag);
      
      // If no tag, check fallback flag
      if (!hasTag && course.fallbackToFlag) {
        const fallbackField = course.fallbackToFlag as keyof typeof user;
        if (user[fallbackField]) {
          return next();
        }
      }

      if (!hasTag) {
        return res.status(403).json({ 
          error: 'You do not have access to this course. Contact your instructor.',
          course: course.courseName,
          requiredTag: course.requiredGhlTag
        });
      }

      next();
    } catch (error) {
      res.status(500).json({ error: 'Course access check failed' });
    }
  };
};