import { Request, Response } from 'express';
import prisma from '../config/database.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';

export const getAnalytics = asyncHandler(async (req: Request, res: Response) => {
  const { unitId, timeRange } = req.query;

  // Calculate date range
  let startDate = new Date();
  if (timeRange === '7') {
    startDate.setDate(startDate.getDate() - 7);
  } else if (timeRange === '30') {
    startDate.setDate(startDate.getDate() - 30);
  } else if (timeRange === '90') {
    startDate.setDate(startDate.getDate() - 90);
  } else if (timeRange === '365') {
    startDate.setDate(startDate.getDate() - 365);
  } else {
    startDate = new Date(0); // All time
  }

  // Build where clause
  const whereClause: any = {
    createdAt: { gte: startDate },
  };

  if (unitId && unitId !== 'all') {
    whereClause.question = {
      unitId: unitId as string,
    };
  }

  // Get total students
  const totalStudents = await prisma.user.count();

  // Get total attempts
  const totalAttempts = await prisma.questionResponse.count({
    where: whereClause,
  });

  // Get average accuracy
  const responses = await prisma.questionResponse.findMany({
    where: whereClause,
    select: { isCorrect: true },
  });

  const correctResponses = responses.filter((r) => r.isCorrect).length;
  const averageAccuracy = totalAttempts > 0 
    ? Math.round((correctResponses / totalAttempts) * 100) 
    : 0;

  // Get average time
  const avgTimeResult = await prisma.questionResponse.aggregate({
    where: whereClause,
    _avg: { timeSpent: true },
  });

  const averageTime = avgTimeResult._avg.timeSpent || 0;

  // Get performance by difficulty
  const difficulties = ['EASY', 'MEDIUM', 'HARD'];
  const byDifficulty: any = {};

  for (const difficulty of difficulties) {
    const difficultyResponses = await prisma.questionResponse.findMany({
      where: {
        ...whereClause,
        question: {
          ...(whereClause.question || {}),
          difficulty: difficulty as any,
        },
      },
      select: { isCorrect: true },
    });

    const correct = difficultyResponses.filter((r) => r.isCorrect).length;
    const total = difficultyResponses.length;

    byDifficulty[difficulty] = {
      accuracy: total > 0 ? Math.round((correct / total) * 100) : 0,
      attempts: total,
    };
  }

  // Get top performing topics
  const topicResponses = await prisma.questionResponse.findMany({
    where: whereClause,
    include: {
      question: {
        include: { topic: true },
      },
    },
  });

  const topicStats: Record<string, { correct: number; total: number }> = {};

  topicResponses.forEach((response) => {
    const topicName = response.question.topic?.name || 'General';
    if (!topicStats[topicName]) {
      topicStats[topicName] = { correct: 0, total: 0 };
    }
    topicStats[topicName].total++;
    if (response.isCorrect) {
      topicStats[topicName].correct++;
    }
  });

  const topTopics = Object.entries(topicStats)
    .map(([name, stats]) => ({
      name,
      accuracy: Math.round((stats.correct / stats.total) * 100),
      attempts: stats.total,
    }))
    .sort((a, b) => b.accuracy - a.accuracy)
    .slice(0, 5);

  const strugglingTopics = Object.entries(topicStats)
    .map(([name, stats]) => ({
      name,
      accuracy: Math.round((stats.correct / stats.total) * 100),
      attempts: stats.total,
    }))
    .filter((t) => t.attempts >= 5) // Only topics with at least 5 attempts
    .sort((a, b) => a.accuracy - b.accuracy)
    .slice(0, 5);

  // Get question statistics
  const mostAttempted = await prisma.question.findFirst({
    where: unitId && unitId !== 'all' ? { unitId: unitId as string } : {},
    orderBy: { timesAttempted: 'desc' },
    select: {
      id: true,
      questionText: true,
      timesAttempted: true,
    },
  });

  const leastAttempted = await prisma.question.findFirst({
    where: {
      ...(unitId && unitId !== 'all' ? { unitId: unitId as string } : {}),
      timesAttempted: { gt: 0 },
    },
    orderBy: { timesAttempted: 'asc' },
    select: {
      id: true,
      questionText: true,
      timesAttempted: true,
    },
  });

  // Get hardest and easiest questions
  const questions = await prisma.question.findMany({
    where: {
      ...(unitId && unitId !== 'all' ? { unitId: unitId as string } : {}),
      timesAttempted: { gte: 5 },
    },
    select: {
      id: true,
      questionText: true,
      timesAttempted: true,
      timesCorrect: true,
    },
  });

  const questionsWithAccuracy = questions.map((q) => ({
    ...q,
    accuracy: Math.round(((q.timesCorrect || 0) / q.timesAttempted) * 100),
  }));

  const hardestQuestion = questionsWithAccuracy.sort((a, b) => a.accuracy - b.accuracy)[0];
  const easiestQuestion = questionsWithAccuracy.sort((a, b) => b.accuracy - a.accuracy)[0];

  // Get session statistics
  const completedSessions = await prisma.studySession.count({
    where: {
      ...(unitId && unitId !== 'all' ? { unitId: unitId as string } : {}),
      endedAt: { not: null },
      createdAt: { gte: startDate },
    },
  });

  const inProgressSessions = await prisma.studySession.count({
    where: {
      ...(unitId && unitId !== 'all' ? { unitId: unitId as string } : {}),
      endedAt: null,
      createdAt: { gte: startDate },
    },
  });

  const allSessions = await prisma.studySession.findMany({
    where: {
      ...(unitId && unitId !== 'all' ? { unitId: unitId as string } : {}),
      createdAt: { gte: startDate },
    },
    select: {
      totalQuestions: true,
      targetQuestions: true,
      endedAt: true,
    },
  });

  const abandonedSessions = allSessions.filter(
    (s) => !s.endedAt && s.totalQuestions > 0 && s.totalQuestions < (s.targetQuestions || 40)
  ).length;

  const totalSessions = completedSessions + inProgressSessions + abandonedSessions;
  const completionRate = totalSessions > 0 
    ? Math.round((completedSessions / totalSessions) * 100) 
    : 0;
  const abandonmentRate = totalSessions > 0 
    ? Math.round((abandonedSessions / totalSessions) * 100) 
    : 0;

  res.status(200).json({
    status: 'success',
    data: {
      totalStudents,
      totalAttempts,
      averageAccuracy,
      averageTime: Math.round(averageTime),
      byDifficulty,
      topTopics,
      strugglingTopics,
      mostAttempted: mostAttempted ? {
        id: mostAttempted.id,
        questionText: mostAttempted.questionText.substring(0, 100) + '...',
        attempts: mostAttempted.timesAttempted,
      } : null,
      leastAttempted: leastAttempted ? {
        id: leastAttempted.id,
        questionText: leastAttempted.questionText.substring(0, 100) + '...',
        attempts: leastAttempted.timesAttempted,
      } : null,
      hardestQuestion: hardestQuestion ? {
        id: hardestQuestion.id,
        questionText: hardestQuestion.questionText.substring(0, 100) + '...',
        accuracy: hardestQuestion.accuracy,
      } : null,
      easiestQuestion: easiestQuestion ? {
        id: easiestQuestion.id,
        questionText: easiestQuestion.questionText.substring(0, 100) + '...',
        accuracy: easiestQuestion.accuracy,
      } : null,
      completedSessions,
      inProgressSessions,
      abandonedSessions,
      completionRate,
      abandonmentRate,
    },
  });
});

// export const downloadAnalyticsReport = asyncHandler(async (req: Request, res: Response) => {
//   const { unitId, timeRange } = req.query;

//   // Reuse the analytics logic
//   // This is a simplified version - in production, you'd generate a proper report
//   //const analyticsData = await getAnalytics(req, res);

//   res.status(200).json({
//     status: 'success',
//     data: {
//       generatedAt: new Date().toISOString(),
//       parameters: { unitId, timeRange },
//       report: analyticsData,
//     },
//   });
// });