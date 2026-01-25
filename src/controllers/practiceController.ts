import { Request, Response } from 'express';
import practiceSessionService from '../services/practiceSessionService.js';
import { generateSessionSummary, getSessionInsights } from '../services/aiService.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import prisma from '../config/database.js';

// Helper function to calculate AP score
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

// Generate logic-based summary
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
              unit: { select: { id: true, name: true, unitNumber: true } },
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
  const unitName = session.unitId ? (unitInfo?.name || 'Practice Session') : 'Mixed Practice (All Units)';

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

  const byUnit: Record<string, { correct: number; total: number; name: string; unitNumber: number }> = {};
  session.responses.forEach((r: any) => {
    const unit = r.question.unit;
    if (unit && !byUnit[unit.id]) {
      byUnit[unit.id] = { correct: 0, total: 0, name: unit.name, unitNumber: unit.unitNumber };
    }
    if (unit) {
      byUnit[unit.id].total++;
      if (r.isCorrect) byUnit[unit.id].correct++;
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

  const unitPerformance = Object.entries(byUnit).map(([id, data]) => ({
    unitId: id,
    name: data.name,
    unitNumber: data.unitNumber,
    accuracy: data.total > 0 ? (data.correct / data.total) * 100 : 0,
    correct: data.correct,
    total: data.total,
  })).sort((a, b) => a.unitNumber - b.unitNumber);

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

  if (!session.unitId && unitPerformance.length > 0) {
    const weakUnits = unitPerformance.filter(u => u.accuracy < 60 && u.total >= 2);
    if (weakUnits.length > 0) {
      recommendations.push(`Review these units: ${weakUnits.map(u => `Unit ${u.unitNumber}`).join(', ')}`);
    }
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
    isMixedMode: !session.unitId,
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
    byUnit: unitPerformance,
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
  const { userId, unitId, topicId, userEmail, userName, targetQuestions, mixed } = req.body;

  if (!mixed && !unitId) {
    return res.status(400).json({
      success: false,
      message: 'unitId is required for non-mixed practice sessions',
    });
  }

  const result = await practiceSessionService.startSession(
    userId,
    unitId,
    topicId,
    userEmail,
    userName,
    targetQuestions || 10,
    mixed || false
  );

  res.status(200).json({
    success: true,
    data: result,
  });
});

export const getNextQuestion = asyncHandler(async (req: Request, res: Response) => {
  const { userId, sessionId, unitId, answeredQuestionIds, topicId, mixed, difficulty } = req.body;

  if (!mixed && !unitId) {
    return res.status(400).json({
      success: false,
      message: 'unitId is required for non-mixed practice sessions',
    });
  }

  const result = await practiceSessionService.getNextQuestion(
    userId,
    sessionId,
    unitId,
    answeredQuestionIds || [],
    topicId,
    mixed || false,
    difficulty
  );

  if (!result.question) {
    return res.status(200).json({
      success: true,
      data: { question: null, sessionComplete: true, currentDifficulty: result.currentDifficulty },
    });
  }

  res.status(200).json({
    success: true,
    data: { 
      question: result.question,
      currentDifficulty: result.currentDifficulty,
    },
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
    success: true,
    data: result,
  });
});

export const endPracticeSession = asyncHandler(async (req: Request, res: Response) => {
  const { sessionId } = req.params;
  const { generateAiSummary = false } = req.body;

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
    success: true,
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
      success: false,
      message: 'Summary not found or still generating',
    });
  }

  res.status(200).json({
    success: true,
    data: summary,
  });
});

export const getSessionResults = asyncHandler(async (req: Request, res: Response) => {
  const { sessionId } = req.params;
  const { includeAiInsights = true } = req.query;

  const results = await practiceSessionService.getSessionStats(sessionId);

  if (!results) {
    return res.status(404).json({
      success: false,
      message: 'Session not found',
    });
  }

  let aiInsights = null;
  if (includeAiInsights === 'true' || includeAiInsights === true) {
    aiInsights = await getSessionInsights(sessionId);
  }

  res.status(200).json({
    success: true,
    data: {
      ...results,
      aiInsights,
    },
  });
});
export const getSessionAnswers = asyncHandler(async (req: Request, res: Response) => {
  const { sessionId } = req.params;

  console.log('📋 Getting session answers for:', sessionId);

  const session = await prisma.studySession.findUnique({
    where: { id: sessionId },
    include: {
      responses: {
        include: {
          question: {
            select: {
              id: true,
              questionText: true,
              options: true,
              correctAnswer: true,
              explanation: true,
              difficulty: true,
              topic: {
                select: {
                  id: true,
                  name: true,
                },
              },
              unit: {
                select: {
                  id: true,
                  name: true,
                  unitNumber: true,
                },
              },
            },
          },
        },
        orderBy: {
          createdAt: 'asc',
        },
      },
    },
  });

  if (!session) {
    return res.status(404).json({
      success: false,
      message: 'Session not found',
    });
  }

  // Format the answers for the frontend
  const answers = session.responses.map((response: any) => ({
    id: response.id,
    questionId: response.questionId,
    userAnswer: response.userAnswer,
    isCorrect: response.isCorrect,
    timeSpent: response.timeSpent,
    createdAt: response.createdAt,
    question: {
      id: response.question.id,
      questionText: response.question.questionText,
      options: response.question.options,
      correctAnswer: response.question.correctAnswer,
      explanation: response.question.explanation,
      difficulty: response.question.difficulty,
      topic: response.question.topic,
      unit: response.question.unit,
    },
  }));

  console.log('✅ Returning', answers.length, 'answers');

  res.status(200).json({
    success: true,
    data: {
      sessionId: session.id,
      totalQuestions: answers.length,
      correctAnswers: answers.filter(a => a.isCorrect).length,
      answers,
    },
  });
});