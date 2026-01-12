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

  const submitResult = await fullExamService.submitExam(examAttemptId, totalTimeSpent);

  res.status(200).json({
    status: 'success',
    data: submitResult,
  });
});

// Get exam results with FRQ solutions
export const getExamResults = asyncHandler(async (req: Request, res: Response) => {
  const { examAttemptId } = req.params;

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

  // Include FRQ details with solutions and rubrics
  const frqDetails = examAttempt.frqResponses.map((frq: any) => ({
    frqNumber: frq.frqNumber,
    userCode: frq.userCode,
    partResponses: frq.partResponses,
    timeSpent: frq.timeSpent,
    // Include the solutions and rubrics
    question: {
      questionText: frq.question.questionText,
      promptText: frq.question.promptText,
      starterCode: frq.question.starterCode,
      frqParts: frq.question.frqParts,
      maxPoints: frq.question.maxPoints,
      explanation: frq.question.explanation,
    },
  }));

  res.status(200).json({
    status: 'success',
    data: {
      status: examAttempt.status,
      mcqScore: examAttempt.mcqScore,
      mcqPercentage: examAttempt.mcqPercentage,
      mcqTotal: 42,
      apScoreRanges, // Show what they could get with different FRQ performance
      unitBreakdown,
      strengths: examAttempt.strengths,
      weaknesses: examAttempt.weaknesses,
      recommendations,
      frqDetails, // Include solutions and rubrics
      submittedAt: examAttempt.submittedAt,
      totalTimeSpent: examAttempt.totalTimeSpent,
    },
  });
});