import { cleanupExpiredTokens } from '../utils/tokenManager.js';
import prisma from '../config/database.js';

export async function runCleanupJobs() {
  console.log('🧹 Running cleanup jobs...');

  try {
    // Clean up expired refresh tokens
    const tokensDeleted = await cleanupExpiredTokens();
    console.log(`✅ Deleted ${tokensDeleted} expired refresh tokens`);

    // Clean up old audit logs (keep last 90 days)
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const logsDeleted = await prisma.auditLog.deleteMany({
      where: {
        createdAt: {
          lt: ninetyDaysAgo,
        },
      },
    });
    console.log(`✅ Deleted ${logsDeleted.count} old audit logs`);
  } catch (error) {
    console.error('❌ Cleanup job failed:', error);
  }
}

// Run cleanup every hour
export function startCleanupScheduler() {
  // Run immediately on startup
  runCleanupJobs();

  // Then run every hour
  setInterval(runCleanupJobs, 60 * 60 * 1000);
  console.log('✅ Cleanup scheduler started (runs every hour)');
}