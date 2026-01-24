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

// Helper function to deeply parse JSON fields
function deepParseJson(data: any): any {
  if (data === null || data === undefined) {
    return data;
  }

  if (typeof data === 'string') {
    try {
      return JSON.parse(data);
    } catch {
      return data;
    }
  }

  if (Array.isArray(data)) {
    return data.map(item => deepParseJson(item));
  }

  if (typeof data === 'object') {
    const parsed: any = {};
    for (const key in data) {
      parsed[key] = deepParseJson(data[key]);
    }
    return parsed;
  }

  return data;
}

// Get exam results with FRQ solutions AND RUBRICS
export const getExamResults = asyncHandler(async (req: Request, res: Response) => {
  const { examAttemptId } = req.params;

  console.log('📊 Fetching exam results for:', examAttemptId);

  // Fetch exam attempt with RAW query to ensure we get all JSON data
  const examAttempt = await prisma.fullExamAttempt.findUnique({
    where: { id: examAttemptId },
    include: {
      frqResponses: {
        include: {
          question: true, // This gets the raw question data including frqParts JSON
        },
        orderBy: { frqNumber: 'asc' },
      },
      mcqResponses: {
        select: {
          isCorrect: true,
        },
      },
    },
  });

  if (!examAttempt) {
    throw new AppError('Exam attempt not found', 404);
  }

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
  const unitBreakdown = deepParseJson(examAttempt.unitBreakdown);
  const recommendations = deepParseJson(examAttempt.recommendations);

  console.log('\n🔍 ========== FRQ DATA INSPECTION ==========');
  
  // Process FRQ details with DEEP parsing
  const frqDetails = examAttempt.frqResponses.map((frq: any, index: number) => {
    console.log(`\n📝 FRQ ${frq.frqNumber}:`);
    console.log('  Raw question.frqParts type:', typeof frq.question?.frqParts);

    // CRITICAL: Deep parse the frqParts JSON
    let frqParts = deepParseJson(frq.question?.frqParts);
    
    console.log('  After deepParse is array:', Array.isArray(frqParts));

    if (!Array.isArray(frqParts)) {
      console.log('  ⚠️ frqParts is not an array, converting to empty array');
      frqParts = [];
    }

    console.log('  Parts count:', frqParts.length);

    // Process each part
    const processedParts = frqParts.map((part: any, partIndex: number) => {
      console.log(`  \n  Part ${part.partLetter}:`);
      
      // 🔥 FIX: The field is called rubricPoints, NOT rubricItems!
      console.log('    Raw rubricPoints type:', typeof part.rubricPoints);
      console.log('    Raw rubricPoints value:', part.rubricPoints);
      
      // CRITICAL: Deep parse rubricPoints (not rubricItems!)
      let rubricItems = deepParseJson(part.rubricPoints);
      
      console.log('    After deepParse type:', typeof rubricItems);
      console.log('    After deepParse is array:', Array.isArray(rubricItems));
      console.log('    Rubric items count:', Array.isArray(rubricItems) ? rubricItems.length : 0);

      if (!Array.isArray(rubricItems)) {
        console.log('    ⚠️ rubricItems is not an array, converting to empty array');
        rubricItems = [];
      }

      if (rubricItems.length > 0) {
        console.log('    ✅ Rubric items:', rubricItems.map((r: any) => ({
          criterion: r.criterion,
          points: r.points,
        })));
      } else {
        console.log('    ❌ NO rubric items found!');
      }

      return {
        partLetter: part.partLetter,
        partDescription: part.partDescription,
        maxPoints: part.maxPoints,
        promptText: part.promptText,
        rubricItems: rubricItems, // Now correctly parsed from rubricPoints
        sampleSolution: part.sampleSolution || '',
      };
    });

   // const rubricCount = processedParts.reduce((sum, p) => sum + (p.rubricItems?.length || 0), 0);
   // console.log(`  \n  ✅ Total rubric items for FRQ ${frq.frqNumber}: ${rubricCount}`);

    return {
      frqNumber: frq.frqNumber,
      userCode: frq.userCode,
      partResponses: frq.partResponses,
      timeSpent: frq.timeSpent,
      question: {
        questionText: frq.question?.questionText || '',
        promptText: frq.question?.promptText || '',
        starterCode: frq.question?.starterCode || '',
        maxPoints: frq.question?.maxPoints || 9,
        explanation: frq.question?.explanation || '',
        frqParts: processedParts,
      },
    };
  });

  console.log('\n✅ ========== FINAL RUBRIC SUMMARY ==========');
  frqDetails.forEach((f: any) => {
    const totalRubrics = f.question.frqParts.reduce((sum: number, p: any) => 
      sum + (p.rubricItems?.length || 0), 0
    );
    console.log(`FRQ ${f.frqNumber}: ${f.question.frqParts.length} parts, ${totalRubrics} total rubric items`);
    f.question.frqParts.forEach((p: any) => {
      console.log(`  Part ${p.partLetter}: ${p.rubricItems?.length || 0} rubric items`);
    });
  });
  console.log('==========================================\n');

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
      frqDetails,
      submittedAt: examAttempt.submittedAt,
      totalTimeSpent: examAttempt.totalTimeSpent,
    },
  });
});