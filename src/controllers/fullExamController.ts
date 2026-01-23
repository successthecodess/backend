import { Request, Response } from 'express';
import fullExamService from '../services/fullExamService.js';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import prisma from '../config/database.js';

// Start full exam
export const startFullExam = asyncHandler(async (req: Request, res: Response) => {
  const { userId } = req.body;

  const examData = await fullExamService.startExam(userId);

  res.status(200).json({
    status: 'success',
    data: examData,
  });
});

// Debug exam attempt
export const debugExamAttempt = asyncHandler(async (req: Request, res: Response) => {
  const { examAttemptId } = req.params;

  console.log('🔍 Debug: Looking for exam attempt:', examAttemptId);

  const attempt = await prisma.fullExamAttempt.findUnique({
    where: { id: examAttemptId },
  });

  console.log('🔍 Debug: Found:', attempt ? 'YES' : 'NO');

  if (attempt) {
    console.log('🔍 Debug: Attempt details:', {
      id: attempt.id,
      userId: attempt.userId,
      status: attempt.status,
      createdAt: attempt.createdAt,
    });
  }

  if (req.user?.userId) {
    const userAttempts = await prisma.fullExamAttempt.findMany({
      where: { userId: req.user.userId },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });

    console.log('🔍 Debug: User has', userAttempts.length, 'attempts');
    console.log('🔍 Debug: Recent attempts:', userAttempts.map(a => ({
      id: a.id,
      status: a.status,
      createdAt: a.createdAt,
    })));
  }

  res.status(200).json({
    status: 'success',
    data: {
      exists: !!attempt,
      attempt,
      examAttemptId,
    },
  });
});

// Submit MCQ answer
export const submitMCQAnswer = asyncHandler(async (req: Request, res: Response) => {
  const { examAttemptId, orderIndex, userAnswer, timeSpent } = req.body;

  const result = await fullExamService.submitMCQAnswer(
    examAttemptId,
    orderIndex,
    userAnswer,
    timeSpent
  );

  res.status(200).json({
    status: 'success',
    data: result,
  });
});

// Submit FRQ answer
export const submitFRQAnswer = asyncHandler(async (req: Request, res: Response) => {
  const { examAttemptId, frqNumber, userCode, partResponses, timeSpent } = req.body;

  const result = await fullExamService.submitFRQAnswer(
    examAttemptId,
    frqNumber,
    userCode,
    partResponses,
    timeSpent
  );

  res.status(200).json({
    status: 'success',
    data: result,
  });
});

// Get exam attempt
export const getExamAttempt = asyncHandler(async (req: Request, res: Response) => {
  const { examAttemptId } = req.params;

  console.log('📋 Fetching exam attempt:', examAttemptId);

  if (!examAttemptId || examAttemptId === 'undefined' || examAttemptId === 'null') {
    throw new AppError('Invalid exam attempt ID', 400);
  }

  try {
    const examAttempt = await fullExamService.getExamAttempt(examAttemptId);

    res.status(200).json({
      status: 'success',
      data: { examAttempt },
    });
  } catch (error: any) {
    console.error('❌ Error fetching exam attempt:', error);
    
    if (error.statusCode === 404) {
      throw new AppError('Exam attempt not found. Please start a new exam.', 404);
    }
    
    throw error;
  }
});

// Flag for review
export const flagMCQForReview = asyncHandler(async (req: Request, res: Response) => {
  const { examAttemptId, orderIndex, flagged } = req.body;

  const result = await fullExamService.flagMCQForReview(examAttemptId, orderIndex, flagged);

  res.status(200).json({
    status: 'success',
    data: result,
  });
});

// Submit entire exam
export const submitFullExam = asyncHandler(async (req: Request, res: Response) => {
  const { examAttemptId, totalTimeSpent } = req.body;

  const submitResult = await fullExamService.submitExam(examAttemptId, totalTimeSpent);

  res.status(200).json({
    status: 'success',
    data: submitResult,
  });
});

// Get exam results with FRQ solutions AND RUBRICS
export const getExamResults = asyncHandler(async (req: Request, res: Response) => {
  const { examAttemptId } = req.params;

  console.log('📊 Fetching exam results for:', examAttemptId);

  const examAttempt = await fullExamService.getExamAttempt(examAttemptId);

  if (examAttempt.status !== 'GRADED') {
    return res.status(200).json({
      status: 'success',
      data: {
        status: examAttempt.status,
        message: 'Exam not yet submitted',
      },
    });
  }

  // Calculate estimated AP score ranges
  const apScoreRanges = fullExamService.calculateEstimatedAPRange(examAttempt.mcqScore || 0);

  // Parse JSON fields
  const unitBreakdown = examAttempt.unitBreakdown 
    ? (typeof examAttempt.unitBreakdown === 'string' 
        ? JSON.parse(examAttempt.unitBreakdown) 
        : examAttempt.unitBreakdown)
    : null;

  const recommendations = examAttempt.recommendations 
    ? (typeof examAttempt.recommendations === 'string' 
        ? JSON.parse(examAttempt.recommendations) 
        : examAttempt.recommendations)
    : null;

  // Include FRQ details with solutions AND rubrics
  const frqDetails = examAttempt.frqResponses.map((frq: any) => {
    console.log(`📝 Processing FRQ ${frq.frqNumber}:`, {
      hasQuestion: !!frq.question,
      hasParts: !!frq.question?.frqParts,
      partsCount: frq.question?.frqParts?.length || 0,
    });

    // Parse frqParts if it's a string
    let frqParts = frq.question?.frqParts;
    if (typeof frqParts === 'string') {
      try {
        frqParts = JSON.parse(frqParts);
      } catch (error) {
        console.error('Failed to parse frqParts:', error);
        frqParts = [];
      }
    }

    return {
      frqNumber: frq.frqNumber,
      userCode: frq.userCode,
      partResponses: frq.partResponses,
      timeSpent: frq.timeSpent,
      // Include the complete question with rubrics
      question: {
        questionText: frq.question?.questionText || '',
        promptText: frq.question?.promptText || '',
        starterCode: frq.question?.starterCode || '',
        maxPoints: frq.question?.maxPoints || 9,
        explanation: frq.question?.explanation || '',
        // IMPORTANT: Include the rubrics for each part
        frqParts: Array.isArray(frqParts) ? frqParts.map((part: any) => ({
          partLetter: part.partLetter,
          partDescription: part.partDescription,
          maxPoints: part.maxPoints,
          // RUBRIC DATA - this is what was missing
          rubricItems: Array.isArray(part.rubricItems) ? part.rubricItems : [],
          sampleSolution: part.sampleSolution || '',
        })) : [],
      },
    };
  });

  console.log('✅ Returning FRQ details with rubrics:', {
    frqCount: frqDetails.length,
    hasRubrics: frqDetails.map((f: any) => ({
      frqNumber: f.frqNumber,
      partsCount: f.question?.frqParts?.length || 0,
      hasRubricData: f.question?.frqParts?.some((p: any) => p.rubricItems?.length > 0),
    })),
  });

  res.status(200).json({
    status: 'success',
    data: {
      status: examAttempt.status,
      mcqScore: examAttempt.mcqScore,
      mcqPercentage: examAttempt.mcqPercentage,
      mcqTotal: 42,
      apScoreRanges,
      unitBreakdown,
      strengths: examAttempt.strengths,
      weaknesses: examAttempt.weaknesses,
      recommendations,
      frqDetails, // Now includes complete rubrics
      submittedAt: examAttempt.submittedAt,
      totalTimeSpent: examAttempt.totalTimeSpent,
    },
  });
});