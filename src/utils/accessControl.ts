/**
 * Tag hierarchy for access control
 * Higher number = more access
 */
export const TAG_HIERARCHY = {
  'free-trial-completed': 1,
  'apcs-test-access': 2, // Practice tests only
  'course-apcs-a': 3, // Full course access
  'premium-access': 4, // Everything
} as const;

export type AccessTag = keyof typeof TAG_HIERARCHY;

/**
 * Check if user has access to a specific feature
 */
export function hasAccess(userTags: string[], requiredTag: AccessTag): boolean {
  const requiredLevel = TAG_HIERARCHY[requiredTag];
  
  return userTags.some((tag) => {
    const tagLevel = TAG_HIERARCHY[tag as AccessTag];
    return tagLevel !== undefined && tagLevel >= requiredLevel;
  });
}

/**
 * Get user's highest access level
 */
export function getAccessLevel(userTags: string[]): {
  level: number;
  highestTag: string | null;
  hasFullAccess: boolean;
  hasPracticeTestAccess: boolean;
  hasCompletedTrial: boolean;
} {
  let highestLevel = 0;
  let highestTag: string | null = null;

  userTags.forEach((tag) => {
    const level = TAG_HIERARCHY[tag as AccessTag];
    if (level !== undefined && level > highestLevel) {
      highestLevel = level;
      highestTag = tag;
    }
  });

  return {
    level: highestLevel,
    highestTag,
    hasFullAccess: highestLevel >= TAG_HIERARCHY['course-apcs-a'],
    hasPracticeTestAccess: highestLevel >= TAG_HIERARCHY['apcs-test-access'],
    hasCompletedTrial: userTags.includes('free-trial-completed'),
  };
}

/**
 * Check if user should see free trial prompt
 */
export function shouldShowFreeTrial(
  userTags: string[],
  hasUsedTrial: boolean
): boolean {
  const { hasFullAccess, hasPracticeTestAccess } = getAccessLevel(userTags);
  
  // Don't show if user has any paid access
  if (hasFullAccess || hasPracticeTestAccess) {
    return false;
  }
  
  // Show only if they haven't used the trial
  return !hasUsedTrial;
}