import { Request, Response } from 'express';
import fullExamService from '../services/fullExamService.js';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import frqEvaluationService from '../services/frqEvaluationService.js';
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

  const frqResponse = await prisma.examAttemptFRQ.findFirst({
    where: {
      examAttemptId,
      frqNumber,
    },
  });

  if (!frqResponse) {
    throw new AppError('FRQ response not found', 404);
  }

  const updated = await prisma.examAttemptFRQ.update({
    where: { id: frqResponse.id },
    data: {
      userCode,
      partResponses, // Store part-by-part responses
      timeSpent,
    },
  });

  res.status(200).json({
    status: 'success',
    data: { saved: true, frqNumber, timeSpent },
  });
});

// Get exam attempt
export const getExamAttempt = asyncHandler(async (req: Request, res: Response) => {
  const { examAttemptId } = req.params;

  const examAttempt = await fullExamService.getExamAttempt(examAttemptId);

  res.status(200).json({
    status: 'success',
    data: { examAttempt },
  });
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

  // Submit exam (calculates MCQ score)
  const submitResult = await fullExamService.submitExam(examAttemptId, totalTimeSpent);

  // Trigger FRQ evaluation asynchronously
  // This happens in the background while we respond to the user
  frqEvaluationService.evaluateAllFRQs(examAttemptId)
    .then(async (frqResults) => {
      console.log('✅ FRQ evaluation complete');
      
      // Calculate final score
      await frqEvaluationService.calculateFinalScore(examAttemptId);
      console.log('✅ Final score calculated');
    })
    .catch(error => {
      console.error('❌ Error in FRQ evaluation:', error);
    });

  res.status(200).json({
    status: 'success',
    data: submitResult,
  });
});

// Get exam results (new endpoint)
export const getExamResults = asyncHandler(async (req: Request, res: Response) => {
  const { examAttemptId } = req.params;

  const examAttempt = await fullExamService.getExamAttempt(examAttemptId);

  // Check if grading is complete
  if (examAttempt.status !== 'GRADED') {
    return res.status(200).json({
      status: 'success',
      data: {
        status: examAttempt.status,
        message: 'Grading in progress...',
        mcqScore: examAttempt.mcqScore,
        mcqPercentage: examAttempt.mcqPercentage,
      },
    });
  }

  // Return full results
  res.status(200).json({
    status: 'success',
    data: {
      examAttempt,
      mcqScore: examAttempt.mcqScore,
      frqTotalScore: examAttempt.frqTotalScore,
      percentageScore: examAttempt.percentageScore,
      predictedAPScore: examAttempt.predictedAPScore,
      unitBreakdown: examAttempt.unitBreakdown,
      strengths: examAttempt.strengths,
      weaknesses: examAttempt.weaknesses,
      recommendations: examAttempt.recommendations,
      frqDetails: examAttempt.frqResponses.map(frq => ({
        frqNumber: frq.frqNumber,
        score: frq.finalScore,
        maxScore: frq.question.maxPoints,
        evaluation: frq.aiEvaluationResult,
        comments: frq.aiComments,
      })),
    },
  });
});