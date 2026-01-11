import { Request, Response } from 'express';
import examBankService from '../services/examBankService.js';
import { asyncHandler } from '../middleware/errorHandler.js';

// Get all exam units
export const getExamUnits = asyncHandler(async (req: Request, res: Response) => {
  const units = await examBankService.getExamUnits();

  res.status(200).json({
    status: 'success',
    data: { units },
  });
});

// Get exam bank questions
export const getExamBankQuestions = asyncHandler(async (req: Request, res: Response) => {
  const { unitId, questionType, frqType, approved } = req.query;

  const filters: any = {};
  if (unitId) filters.unitId = unitId as string;
  if (questionType) filters.questionType = questionType;
  if (frqType) filters.frqType = frqType;
  if (approved !== undefined) filters.approved = approved === 'true';

  const questions = await examBankService.getExamBankQuestions(filters);

  res.status(200).json({
    status: 'success',
    data: { questions },
  });
});

// Create MCQ question
export const createMCQQuestion = asyncHandler(async (req: Request, res: Response) => {
  const { unitId, questionText, options, correctAnswer, explanation, difficulty, approved } = req.body;

  const question = await examBankService.createMCQQuestion({
    unitId,
    questionText,
    options,
    correctAnswer,
    explanation,
    difficulty,
    approved,
  });

  res.status(201).json({
    status: 'success',
    data: { question },
  });
});

// Create FRQ question
// Create FRQ question
export const createFRQQuestion = asyncHandler(async (req: Request, res: Response) => {
  const {
    unitId,
    frqType,
    questionText,
    promptText,
    starterCode,
    frqParts,
    maxPoints,
    explanation,
    approved,
  } = req.body;

  const question = await examBankService.createFRQQuestion({
    unitId,
    frqType,
    questionText,
    promptText,
    starterCode,
    frqParts, // Pass the parts array
    maxPoints,
    explanation,
    approved,
  });

  res.status(201).json({
    status: 'success',
    data: { question },
  });
});
// Update question
export const updateExamBankQuestion = asyncHandler(async (req: Request, res: Response) => {
  const { questionId } = req.params;
  const updateData = req.body;

  const question = await examBankService.updateQuestion(questionId, updateData);

  res.status(200).json({
    status: 'success',
    data: { question },
  });
});

// Delete question
export const deleteExamBankQuestion = asyncHandler(async (req: Request, res: Response) => {
  const { questionId } = req.params;

  await examBankService.deleteQuestion(questionId);

  res.status(200).json({
    status: 'success',
    message: 'Question deleted successfully',
  });
});

// Get question counts
export const getQuestionCounts = asyncHandler(async (req: Request, res: Response) => {
  const counts = await examBankService.getQuestionCounts();

  res.status(200).json({
    status: 'success',
    data: counts,
  });
});