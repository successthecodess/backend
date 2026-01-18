import { Request, Response } from 'express';
import practiceSessionService from '../services/practiceSessionService.js';
import { generateSessionSummary, getSessionInsights } from '../services/aiService.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import prisma from '../config/database.js';

// Helper function to calculate AP score from performance (no AI)
function calculateAPScore(
  accuracy: number,
  avgDifficulty: number,
  totalQuestions: number
): { score: number; confidence: string; breakdown: any } {
  const difficultyMultiplier = avgDifficulty / 2;
  const weightedAccuracy = accuracy * difficultyMultiplier;

  let score: number;
  let confidence: string;

  if (weightedAccuracy >= 85) {
    score = 5;
    confidence = totalQuestions >= 15 ? 'High' : 'Medium';
  } else if (weightedAccuracy >= 70) {
    score = 4;
    confidence = totalQuestions >= 15 ? 'High' : 'Medium';
  } else if (weightedAccuracy >= 55) {
    score = 3;
    confidence = totalQuestions >= 10 ? 'Medium' : 'Low';
  } else if (weightedAccuracy >= 40) {
    score = 2;
    confidence = totalQuestions >= 10 ? 'Medium' : 'Low';
  } else {
    score = 1;
    confidence = 'Low';
  }

  if (totalQuestions < 5) {
    confidence = 'Very Low';
  }

  return {
    score,
    confidence,
    breakdown: {
      rawAccuracy: accuracy,
      weightedAccuracy: Math.round(weightedAccuracy),
      avgDifficulty: avgDifficulty.toFixed(1),
      questionsAnswered: totalQuestions,
    },
  };
}

// Helper function to generate logic-based summary (no AI)
async function generateLogicBasedSummary(sessionId: string) {
  const session = await prisma.studySession.findUnique({
    where: { id: sessionId },
    include: {
      responses: {
        include: {
          question: {
            select: {
              id: true,
              difficulty: true,
              topicId: true,
              topic: { select: { id: true, name: true } },
              unit: { select: { id: true, name: true } },
            },
          },
        },
      },
    },
  });

  if (!session) {
    return null;
  }

  const unitInfo = session.responses[0]?.question?.unit || null;
  const unitName = unitInfo?.name || 'Practice Session';

  const totalQuestions = session.responses.length;
  const correctAnswers = session.responses.filter((r: any) => r.isCorrect).length;
  const accuracy = totalQuestions > 0 ? (correctAnswers / totalQuestions) * 100 : 0;

  const difficultyMap: Record<string, number> = { EASY: 1, MEDIUM: 2, HARD: 3 };
  const avgDifficulty =
    session.responses.reduce((sum: number, r: any) => {
      return sum + (difficultyMap[r.question.difficulty] || 2);
    }, 0) / Math.max(totalQuestions, 1);

  const byDifficulty: Record<string, { correct: number; total: number }> = {
    EASY: { correct: 0, total: 0 },
    MEDIUM: { correct: 0, total: 0 },
    HARD: { correct: 0, total: 0 },
  };

  session.responses.forEach((r: any) => {
    const diff = r.question.difficulty;
    if (byDifficulty[diff]) {
      byDifficulty[diff].total++;
      if (r.isCorrect) byDifficulty[diff].correct++;
    }
  });

  const byTopic: Record<string, { correct: number; total: number; name: string }> = {};
  session.responses.forEach((r: any) => {
    const topicId = r.question.topicId;
    const topicName = r.question.topic?.name || 'Unknown';

    if (topicId && !byTopic[topicId]) {
      byTopic[topicId] = { correct: 0, total: 0, name: topicName };
    }
    if (topicId) {
      byTopic[topicId].total++;
      if (r.isCorrect) byTopic[topicId].correct++;
    }
  });

  const apPrediction = calculateAPScore(accuracy, avgDifficulty, totalQuestions);

  const topicPerformance = Object.entries(byTopic).map(([id, data]) => ({
    topicId: id,
    name: data.name,
    accuracy: data.total > 0 ? (data.correct / data.total) * 100 : 0,
    correct: data.correct,
    total: data.total,
  }));

  const strengths = topicPerformance
    .filter((t) => t.accuracy >= 70 && t.total >= 2)
    .sort((a, b) => b.accuracy - a.accuracy)
    .slice(0, 3);

  const weaknesses = topicPerformance
    .filter((t) => t.accuracy < 70 && t.total >= 2)
    .sort((a, b) => a.accuracy - b.accuracy)
    .slice(0, 3);

  const recommendations: string[] = [];

  if (byDifficulty.EASY.total > 0 && byDifficulty.EASY.correct / byDifficulty.EASY.total < 0.7) {
    recommendations.push('Review fundamental concepts - focus on Easy level questions first');
  }

  if (weaknesses.length > 0) {
    recommendations.push(`Focus on: ${weaknesses.map((w) => w.name).join(', ')}`);
  }

  if (accuracy >= 80 && avgDifficulty < 2.5) {
    recommendations.push('Try more Hard difficulty questions to challenge yourself');
  }

  if (accuracy < 50) {
    recommendations.push('Consider reviewing the unit material before more practice');
  }

  if (totalQuestions < 10) {
    recommendations.push('Complete more questions for a more accurate assessment');
  }

  if (accuracy >= 80) {
    recommendations.push('Great work! Keep practicing to maintain your momentum');
  }

  const totalTimeSpent = session.responses.reduce(
    (sum: number, r: any) => sum + (r.timeSpent || 0),
    0
  );
  const avgTimePerQuestion = totalQuestions > 0 ? totalTimeSpent / totalQuestions : 0;

  return {
    sessionId,
    unitId: session.unitId,
    unitName,
    completedAt: new Date().toISOString(),
    totalQuestions,
    correctAnswers,
    incorrectAnswers: totalQuestions - correctAnswers,
    accuracy: Math.round(accuracy),
    totalTimeSpent,
    avgTimePerQuestion: Math.round(avgTimePerQuestion),
    byDifficulty: {
      easy: {
        correct: byDifficulty.EASY.correct,
        total: byDifficulty.EASY.total,
        accuracy:
          byDifficulty.EASY.total > 0
            ? Math.round((byDifficulty.EASY.correct / byDifficulty.EASY.total) * 100)
            : null,
      },
      medium: {
        correct: byDifficulty.MEDIUM.correct,
        total: byDifficulty.MEDIUM.total,
        accuracy:
          byDifficulty.MEDIUM.total > 0
            ? Math.round((byDifficulty.MEDIUM.correct / byDifficulty.MEDIUM.total) * 100)
            : null,
      },
      hard: {
        correct: byDifficulty.HARD.correct,
        total: byDifficulty.HARD.total,
        accuracy:
          byDifficulty.HARD.total > 0
            ? Math.round((byDifficulty.HARD.correct / byDifficulty.HARD.total) * 100)
            : null,
      },
    },
    byTopic: topicPerformance,
    apScore: apPrediction.score,
    apScoreConfidence: apPrediction.confidence,
    apScoreBreakdown: apPrediction.breakdown,
    strengths,
    weaknesses,
    recommendations,
    performanceLevel:
      accuracy >= 90
        ? 'Excellent'
        : accuracy >= 75
        ? 'Good'
        : accuracy >= 60
        ? 'Satisfactory'
        : accuracy >= 40
        ? 'Needs Improvement'
        : 'Struggling',
  };
}

export const startPracticeSession = asyncHandler(async (req: Request, res: Response) => {
  const { userId, unitId, topicId, userEmail, userName, targetQuestions } = req.body;

  const result = await practiceSessionService.startSession(
    userId,
    unitId,
    topicId,
    userEmail,
    userName,
    targetQuestions || 10
  );

  res.status(200).json({
    status: 'success',
    data: result,
  });
});

export const getNextQuestion = asyncHandler(async (req: Request, res: Response) => {
  const { userId, sessionId, unitId, answeredQuestionIds, topicId } = req.body;

  if (!unitId) {
    return res.status(400).json({
      status: 'error',
      message: 'unitId is required',
    });
  }

  const question = await practiceSessionService.getNextQuestion(
    userId,
    sessionId,
    unitId,
    answeredQuestionIds || [],
    topicId
  );

  res.status(200).json({
    status: 'success',
    data: { question },
  });
});

export const submitAnswer = asyncHandler(async (req: Request, res: Response) => {
  const { userId, sessionId, questionId, userAnswer, timeSpent } = req.body;

  const result = await practiceSessionService.submitAnswer(
    userId,
    sessionId,
    questionId,
    userAnswer,
    timeSpent
  );

  res.status(200).json({
    status: 'success',
    data: result,
  });
});

export const endPracticeSession = asyncHandler(async (req: Request, res: Response) => {
  const { sessionId } = req.params;
  const { generateAiSummary = false } = req.body;

  // Run endSession and generateLogicBasedSummary in parallel
  const [result, summary] = await Promise.all([
    practiceSessionService.endSession(sessionId),
    generateLogicBasedSummary(sessionId),
  ]);

  if (generateAiSummary && result.session) {
    generateSessionSummary(sessionId).catch((err) => {
      console.error('⚠️ AI summary generation failed:', err.message);
    });
  }

  res.status(200).json({
    status: 'success',
    data: {
      ...result,
      summary,
    },
  });
});

export const getSessionSummary = asyncHandler(async (req: Request, res: Response) => {
  const { sessionId } = req.params;

  const summary = await getSessionInsights(sessionId);

  if (!summary) {
    return res.status(404).json({
      status: 'error',
      message: 'Summary not found or still generating',
    });
  }

  res.status(200).json({
    status: 'success',
    data: summary,
  });
});

export const getSessionResults = asyncHandler(async (req: Request, res: Response) => {
  const { sessionId } = req.params;
  const { includeAiInsights = true } = req.query;

  const results = await practiceSessionService.getSessionStats(sessionId);

  if (!results) {
    return res.status(404).json({
      status: 'error',
      message: 'Session not found',
    });
  }

  let aiInsights = null;
  if (includeAiInsights === 'true' || includeAiInsights === true) {
    aiInsights = await getSessionInsights(sessionId);
  }

  res.status(200).json({
    status: 'success',
    data: {
      ...results,
      aiInsights,
    },
  });
});