import { Request, Response } from 'express';
import practiceSessionService from '../services/practiceSessionService.js';
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

  // CRITICAL: Validate unitId
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
    unitId, // Make sure this is passed!
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

  console.log('📥 End session request:', { sessionId });

  const result = await practiceSessionService.endSession(sessionId);

  res.status(200).json({
    status: 'success',
    data: result,
  });
});