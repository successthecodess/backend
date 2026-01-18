import { Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import freeTrialService from '../services/freeTrialService.js';
import questionService from '../services/questionService.js';
import prisma from '../config/database.js';
import { SessionType } from '@prisma/client';

export const checkFreeTrialStatus = asyncHandler(async (req: Request, res: Response) => {
  const { userId } = req.params;

  const hasUsed = await freeTrialService.hasUsedFreeTrial(userId);

  res.json({
    hasUsedFreeTrial: hasUsed,
  });
});

export const startFreeTrial = asyncHandler(async (req: Request, res: Response) => {
  const { userId, userEmail, userName } = req.body;

  console.log('📥 Start free trial request:', { userId, userEmail });

  const result = await freeTrialService.startFreeTrialSession(userId, userEmail, userName);

  res.json({
    status: 'success',
    data: {
      session: result.session,
      question: result.questions[0], // Return first question
      totalQuestions: result.totalQuestions,
      questionNumber: 1,
    },
  });
});

export const getFreeTrialQuestion = asyncHandler(async (req: Request, res: Response) => {
  const { sessionId, questionNumber } = req.params;

  console.log('📥 Get free trial question:', { sessionId, questionNumber });

  // OPTIMIZED: Only select what we need
  const session = await prisma.studySession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      sessionType: true,
      metadata: true, // Get stored question order
    },
  });

  if (!session || session.sessionType !== SessionType.FREE_TRIAL) {
    return res.status(404).json({
      status: 'error',
      message: 'Free trial session not found',
    });
  }

  // Get question order from metadata
  const questionOrder = (session.metadata as any)?.questionOrder || [];
  const index = parseInt(questionNumber) - 1;
  const questionId = questionOrder[index];

  if (!questionId) {
    return res.json({
      status: 'success',
      data: { question: null },
    });
  }

  // Fetch only the specific question
  const question = await prisma.question.findUnique({
    where: { id: questionId },
    include: {
      unit: {
        select: {
          id: true,
          unitNumber: true,
          name: true,
        },
      },
      topic: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  res.json({
    status: 'success',
    data: { question },
  });
});

export const submitFreeTrialAnswer = asyncHandler(async (req: Request, res: Response) => {
  const { userId, sessionId, questionId, userAnswer, timeSpent, questionNumber } = req.body;

  console.log('📥 Submit free trial answer:', { userId, sessionId, questionId, questionNumber });

  // Submit answer using existing question service
  const result = await questionService.submitAnswer(userId, questionId, userAnswer, timeSpent);

  // Update session
  const updateData: any = {
    totalQuestions: { increment: 1 },
  };

  if (result.isCorrect) {
    updateData.correctAnswers = { increment: 1 };
  }

  const session = await prisma.studySession.update({
    where: { id: sessionId },
    data: updateData,
    select: {
      id: true,
      totalQuestions: true,
      correctAnswers: true,
    },
  });

  // Check if trial is complete (10 questions)
  const isComplete = session.totalQuestions >= 10;

  if (isComplete) {
    // Run completion async (don't wait for GHL tag)
    freeTrialService.completeFreeTrialSession(userId, sessionId).catch(err =>
      console.error('Failed to complete trial:', err)
    );
  }

  res.json({
    status: 'success',
    data: {
      ...result,
      session,
      isComplete,
      questionsRemaining: 10 - session.totalQuestions,
    },
  });
});

export const endFreeTrial = asyncHandler(async (req: Request, res: Response) => {
  const { sessionId } = req.params;
  const { userId } = req.body;

  console.log('📥 End free trial:', { sessionId, userId });

  const result = await freeTrialService.completeFreeTrialSession(userId, sessionId);

  res.json({
    status: 'success',
    data: {
      summary: {
        totalQuestions: result.totalQuestions,
        correctAnswers: result.correctAnswers,
        accuracy: result.accuracy,
      },
      trialCompleted: true,
    },
  });
});