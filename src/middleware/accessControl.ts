import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import prisma from '../config/database.js';

// Define clear access tiers
export const AccessTiers = {
  FREE_TRIAL: 'free-trial-only',
  BASIC: 'apcs-practice-access',
  FULL: 'apcsa-test-access', // Includes practice access
  PREMIUM: 'apcsa-exam', // Premium full exam access
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
  canAccessPremiumExam: boolean;
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

  // Check access tiers
  const hasPremiumTag = tags.includes(AccessTiers.PREMIUM);
  const hasPremium = hasPremiumTag || isPremiumActive;
  const hasFullTag = tags.includes(AccessTiers.FULL);
  const hasFull = hasFullTag || hasPremium; // Premium includes Full
  const hasBasicTag = tags.includes(AccessTiers.BASIC);
  const hasBasic = hasBasicTag || hasFull; // Full includes Basic
  
  // Free trial: ONLY available if they haven't used it yet AND have no other access
  const hasFreeTrialAccess = !user.hasUsedFreeTrial;

  // Determine access tier
  let accessTier: AccessTier = 'none';
  if (hasPremium) {
    accessTier = 'premium';
  } else if (hasFull) {
    accessTier = 'full';
  } else if (hasBasic) {
    accessTier = 'basic';
  } else if (hasFreeTrialAccess) {
    accessTier = 'trial';
  }

  return {
    hasFreeTrialAccess: hasFreeTrialAccess, // True ONLY if not used yet
    hasBasicAccess: hasBasic,
    hasFullAccess: hasFull,
    hasPremiumAccess: hasPremium,
    canAccessPractice: hasBasic, // Requires at least Basic (or Full/Premium)
    canAccessTests: hasFull, // Requires Full or Premium
    canAccessCourse: hasFull, // Requires Full or Premium
    canAccessPremiumExam: hasPremium, // Premium only
    accessTier: accessTier,
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