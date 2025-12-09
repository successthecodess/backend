import axios from 'axios';
import prisma from '../config/database.js';

const GHL_API_BASE = 'https://services.leadconnectorhq.com';
const GHL_TOKEN_URL = 'https://services.leadconnectorhq.com/oauth/token';

export async function syncProgressToGHL(userId: string) {
  try {
    // Get user with GHL credentials
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        ghlUserId: true,
        ghlAccessToken: true,
        ghlRefreshToken: true,
        ghlTokenExpiry: true,
      },
    });

    if (!user || !user.ghlUserId || !user.ghlAccessToken) {
      console.log('User not connected to GHL, skipping sync');
      return;
    }

    // Check if token is expired and refresh if needed
    let accessToken = user.ghlAccessToken;
    if (user.ghlTokenExpiry && new Date() >= user.ghlTokenExpiry) {
      accessToken = await refreshGHLToken(userId, user.ghlRefreshToken!);
    }

    // Get aggregated progress data
    const progressData = await getProgressData(userId);

    // Update custom fields in GHL contact
    await axios.put(
      `${GHL_API_BASE}/contacts/${user.ghlUserId}`,
      {
        customFields: [
          {
            key: 'total_questions_answered',
            value: progressData.totalQuestions.toString(),
          },
          {
            key: 'overall_accuracy',
            value: progressData.accuracy.toFixed(2),
          },
          {
            key: 'current_streak',
            value: progressData.streak.toString(),
          },
          {
            key: 'units_mastered',
            value: progressData.unitsMastered.toString(),
          },
          {
            key: 'last_practice_date',
            value: new Date().toISOString(),
          },
          {
            key: 'study_time_minutes',
            value: progressData.studyTimeMinutes.toString(),
          },
        ],
      },
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Version': '2021-07-28',
        },
      }
    );

    console.log(`✅ Synced progress to GHL for user ${userId}`);
  } catch (error: any) {
    console.error('Failed to sync to GHL:', error.response?.data || error.message);
    // Don't throw - sync failures shouldn't break the app
  }
}

async function getProgressData(userId: string) {
  // Get all progress records
  const progressRecords = await prisma.progress.findMany({
    where: { userId },
  });

  const totalQuestions = progressRecords.reduce((sum, p) => sum + p.totalAttempts, 0);
  const correctAnswers = progressRecords.reduce((sum, p) => sum + p.correctAttempts, 0); // Changed
  const accuracy = totalQuestions > 0 ? (correctAnswers / totalQuestions) * 100 : 0;
  const unitsMastered = progressRecords.filter(p => p.masteryLevel >= 80).length;

  // Get streak data
  const sessions = await prisma.studySession.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  });

  const uniqueDates = [...new Set(
    sessions.map(s => new Date(s.createdAt).toDateString())
  )];

  let streak = 0;
  const today = new Date().toDateString();
  const yesterday = new Date(Date.now() - 86400000).toDateString();

  if (uniqueDates.includes(today) || uniqueDates.includes(yesterday)) {
    let currentDate = new Date();
    if (!uniqueDates.includes(today)) {
      currentDate = new Date(Date.now() - 86400000);
    }

    while (uniqueDates.includes(currentDate.toDateString())) {
      streak++;
      currentDate = new Date(currentDate.getTime() - 86400000);
    }
  }

  // Calculate total study time from question responses
  const responses = await prisma.questionResponse.findMany({
    where: { userId },
    select: { timeSpent: true },
  });

  const studyTimeMinutes = Math.floor(
    responses.reduce((sum, r) => sum + (r.timeSpent || 0), 0) / 60
  );

  return {
    totalQuestions,
    correctAnswers,
    accuracy,
    unitsMastered,
    streak,
    studyTimeMinutes,
  };
}

async function refreshGHLToken(userId: string, refreshToken: string): Promise<string> {
  const response = await axios.post(
    GHL_TOKEN_URL,
    new URLSearchParams({
      client_id: process.env.GHL_CLIENT_ID!,
      client_secret: process.env.GHL_CLIENT_SECRET!,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
    {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    }
  );

  const { access_token, refresh_token: newRefreshToken, expires_in } = response.data;

  // Update tokens in database
  await prisma.user.update({
    where: { id: userId },
    data: {
      ghlAccessToken: access_token,
      ghlRefreshToken: newRefreshToken,
      ghlTokenExpiry: new Date(Date.now() + expires_in * 1000),
    },
  });

  return access_token;
}