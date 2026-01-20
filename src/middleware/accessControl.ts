import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import prisma from '../config/database.js';

// Define clear access tiers
export const AccessTiers = {
  FREE_TRIAL: 'free-trial-only',
  BASIC: 'apcs-practice-access',
  FULL: 'apcs-test-access', // Highest tier - includes everything
  PREMIUM: 'apcs-exam', // Premium full exam access
} as const;

export type AccessTier = 'none' | 'trial' | 'basic' | 'full' | 'premium';

export interface UserAccess {
  hasFreeTrialAccess: boolean;
  hasBasicAccess: boolean;
  hasFullAccess: boolean;
  hasPremiumAccess: boolean;
  canAccessPractice: boolean;
  canAccessTests: boolean;
  canAccessCourse: boolean;
  canAccessPremiumExam: boolean; // NEW
  accessTier: AccessTier;
}

export async function checkUserAccess(userId: string): Promise<UserAccess> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      ghlTags: true,
      isAdmin: true,
      hasUsedFreeTrial: true,
      isPremium: true,
      premiumUntil: true,
    },
  });

  if (!user) {
    return {
      hasFreeTrialAccess: false,
      hasBasicAccess: false,
      hasFullAccess: false,
      hasPremiumAccess: false,
      canAccessPractice: false,
      canAccessTests: false,
      canAccessCourse: false,
      canAccessPremiumExam: false,
      accessTier: 'none',
    };
  }

  // Admins have full access
  if (user.isAdmin) {
    return {
      hasFreeTrialAccess: true,
      hasBasicAccess: true,
      hasFullAccess: true,
      hasPremiumAccess: true,
      canAccessPractice: true,
      canAccessTests: true,
      canAccessCourse: true,
      canAccessPremiumExam: true,
      accessTier: 'premium',
    };
  }

  const tags = user.ghlTags || [];

  // Check if premium is active
  const isPremiumActive = user.isPremium && (!user.premiumUntil || new Date(user.premiumUntil) > new Date());

  // Check access tiers (higher tier includes lower tiers)
  const hasPremiumTag = tags.includes(AccessTiers.PREMIUM);
  const hasPremium = hasPremiumTag || isPremiumActive;
  const hasFull = tags.includes(AccessTiers.FULL) || hasPremium;
  const hasBasic = tags.includes(AccessTiers.BASIC);
  const hasTrial = !user.hasUsedFreeTrial || hasBasic;

  return {
    hasFreeTrialAccess: hasTrial,
    hasBasicAccess: hasBasic,
    hasFullAccess: hasFull,
    hasPremiumAccess: hasPremium,
    canAccessPractice: hasFull, // Basic or higher
    canAccessTests: hasFull, // Full or higher
    canAccessCourse: hasFull, // Full or higher
    canAccessPremiumExam: hasPremium, // Premium only
    accessTier: hasPremium ? 'premium' : hasFull ? 'full' : hasBasic ? 'basic' : hasTrial ? 'trial' : 'none',
  };
}

export async function requireAccess(minTier: 'trial' | 'basic' | 'full' | 'premium') {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const authHeader = req.headers.authorization;
      
      if (!authHeader) {
        return res.status(401).json({ error: 'No authorization token' });
      }

      const token = authHeader.substring(7);
      const decoded = jwt.verify(token, process.env.JWT_SECRET!) as { userId: string };

      const access = await checkUserAccess(decoded.userId);

      // Define tier levels with 'none' included
      const tierLevels: Record<AccessTier, number> = {
        none: 0,
        trial: 1,
        basic: 2,
        full: 3,
        premium: 4,
      };

      const userLevel = tierLevels[access.accessTier];
      const requiredLevel = tierLevels[minTier];

      if (userLevel < requiredLevel) {
        return res.status(403).json({ 
          error: 'Insufficient access level',
          required: minTier,
          current: access.accessTier,
        });
      }

      next();
    } catch (error) {
      res.status(401).json({ error: 'Invalid token' });
    }
  };
}