import { Request, Response } from 'express';
import practiceSessionService from '../services/practiceSessionService.js';
import { generateSessionSummary, getSessionInsights } from '../services/aiService.js';
import { asyncHandler } from '../middleware/errorHandler.js';

export const startPracticeSession = asyncHandler(async (req: Request, res: Response) => {
  const { userId, unitId, topicId, userEmail, userName, targetQuestions } = req.body;

  console.log('📥 Start session request:', { userId, unitId, topicId, targetQuestions });

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

  console.log('📥 Next question request:', { 
    userId, 
    sessionId, 
    unitId,
    topicId,
    answeredCount: answeredQuestionIds?.length 
  });

  if (!unitId) {
    console.error('❌ Missing unitId in request!');
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

  if (!question) {
    return res.status(200).json({
      status: 'success',
      data: { question: null },
    });
  }

  res.status(200).json({
    status: 'success',
    data: { question },
  });
});

export const submitAnswer = asyncHandler(async (req: Request, res: Response) => {
  const { userId, sessionId, questionId, userAnswer, timeSpent } = req.body;

  console.log('📥 Submit answer request:', { userId, sessionId, questionId });

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
  const { generateAiSummary = true } = req.body;

  console.log('📥 End session request:', { sessionId, generateAiSummary });

  const result = await practiceSessionService.endSession(sessionId);

  // Generate AI summary asynchronously (don't block response)
  if (generateAiSummary && result.session) {
    generateSessionSummary(sessionId).catch((err) => {
      console.error('⚠️ AI summary generation failed:', err.message);
    });
  }

  res.status(200).json({
    status: 'success',
    data: result,
  });
});

export const getSessionSummary = asyncHandler(async (req: Request, res: Response) => {
  const { sessionId } = req.params;

  console.log('📥 Get session summary:', { sessionId });

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

  console.log('📥 Get session results:', { sessionId, includeAiInsights });

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