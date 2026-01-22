// import prisma from '../config/database.js';

// /**
//  * Tag hierarchy for access control
//  * Higher number = more access
//  */
// export const TAG_HIERARCHY = {
//   'free-trial-completed': 1,
//   'apcs-test-accesss': 2, // Practice tests only
//   'apcs-test-access': 3, // Full course access
//   'premium-access': 4, // Everything
// } as const;

// export type AccessTag = keyof typeof TAG_HIERARCHY;

// /**
//  * User access response type
//  */
// export interface UserAccess {
//   hasPracticeTestAccess: boolean;
//   hasFullAccess: boolean;
//   canAccessPremiumExam: boolean;
//   hasCompletedTrial: boolean;
//   shouldShowFreeTrial: boolean;
//   isAdmin: boolean;
//   tags: string[];
// }

// /**
//  * Check if user has access to a specific feature
//  */
// export function hasAccess(userTags: string[], requiredTag: AccessTag): boolean {
//   const requiredLevel = TAG_HIERARCHY[requiredTag];
  
//   return userTags.some((tag) => {
//     const tagLevel = TAG_HIERARCHY[tag as AccessTag];
//     return tagLevel !== undefined && tagLevel >= requiredLevel;
//   });
// }

// /**
//  * Get user's highest access level
//  */
// export function getAccessLevel(userTags: string[]): {
//   level: number;
//   highestTag: string | null;
//   hasFullAccess: boolean;
//   hasPracticeTestAccess: boolean;
//   canAccessPremiumExam: boolean;
//   hasCompletedTrial: boolean;
// } {
//   let highestLevel = 0;
//   let highestTag: string | null = null;

//   userTags.forEach((tag) => {
//     const level = TAG_HIERARCHY[tag as AccessTag];
//     if (level !== undefined && level > highestLevel) {
//       highestLevel = level;
//       highestTag = tag;
//     }
//   });

//   return {
//     level: highestLevel,
//     highestTag,
//     hasFullAccess: highestLevel >= TAG_HIERARCHY['apcs-test-access'],
//     hasPracticeTestAccess: highestLevel >= TAG_HIERARCHY['apcs-test-access'],
//     // apcs-exam is checked separately (not in hierarchy)
//     canAccessPremiumExam: userTags.includes('apcs-exam') || highestLevel >= TAG_HIERARCHY['apcs-test-access'],
//     hasCompletedTrial: userTags.includes('free-trial-completed'),
//   };
// }

// /**
//  * Check if user should see free trial prompt
//  */
// export function shouldShowFreeTrial(
//   userTags: string[],
//   hasUsedTrial: boolean
// ): boolean {
//   const { hasFullAccess } = getAccessLevel(userTags);
  
//   // Don't show if user has any paid access
//   if (hasFullAccess) {
//     return false;
//   }
  
//   // Show only if they haven't used the trial
//   return !hasUsedTrial;
// }

// /**
//  * Check user's access permissions - used by /auth/oauth/my-access endpoint
//  */
// export async function checkUserAccess(userId: string): Promise<UserAccess> {
//   const user = await prisma.user.findUnique({
//     where: { id: userId },
//     select: {
//       ghlTags: true,
//       isPremium: true,
//       isAdmin: true,
//       isStaff: true,
//       hasUsedFreeTrial: true,
//       role: true,
//     },
//   });

//   if (!user) {
//     return {
//       hasPracticeTestAccess: false,
//       hasFullAccess: false,
//       canAccessPremiumExam: false,
//       hasCompletedTrial: false,
//       shouldShowFreeTrial: true,
//       isAdmin: false,
//       tags: [],
//     };
//   }

//   // Admin/staff have full access to everything
//   if (user.isAdmin || user.isStaff || user.role === 'ADMIN' || user.role === 'SUPER_ADMIN') {
//     return {
//       hasPracticeTestAccess: true,
//       hasFullAccess: true,
//       canAccessPremiumExam: true,
//       hasCompletedTrial: true,
//       shouldShowFreeTrial: false,
//       isAdmin: true,
//       tags: user.ghlTags,
//     };
//   }

//   const accessLevel = getAccessLevel(user.ghlTags);

//   return {
//     hasPracticeTestAccess: accessLevel.hasPracticeTestAccess,
//     hasFullAccess: accessLevel.hasFullAccess,
//     canAccessPremiumExam: accessLevel.canAccessPremiumExam,
//     hasCompletedTrial: accessLevel.hasCompletedTrial || user.hasUsedFreeTrial,
//     shouldShowFreeTrial: shouldShowFreeTrial(user.ghlTags, user.hasUsedFreeTrial),
//     isAdmin: false,
//     tags: user.ghlTags,
//   };
// }