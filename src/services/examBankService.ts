import prisma from '../config/database.js';
import { ExamQuestionType, FRQType, ExamDifficulty } from '@prisma/client';
import { AppError } from '../middleware/errorHandler.js';

export class ExamBankService {
  /**
   * Create a new exam bank question (MCQ)
   */
  async createMCQQuestion(data: {
    unitId: string;
    questionText: string;
    options: string[];
    correctAnswer: string;
    explanation?: string;
    difficulty?: ExamDifficulty;
    approved?: boolean;
  }) {
    const question = await prisma.examBankQuestion.create({
      data: {
        unitId: data.unitId,
        questionType: 'MCQ',
        questionText: data.questionText,
        options: data.options,
        correctAnswer: data.correctAnswer,
        explanation: data.explanation,
        difficulty: data.difficulty || 'MEDIUM',
        approved: data.approved ?? false,
        aiGenerated: false,
      },
      include: {
        unit: true,
      },
    });

    return question;
  }

  /**
   * Create a new FRQ question
   */
  /**
 * Create a new FRQ question with multi-part structure
 */
/**
 * Create a new FRQ question with multi-part structure
 */
async createFRQQuestion(data: {
  unitId: string;
  frqType: FRQType;
  questionText: string;
  promptText: string;
  starterCode?: string;
  frqParts?: any; // Array of parts
  maxPoints?: number;
  explanation?: string;
  approved?: boolean;
}) {
  const question = await prisma.examBankQuestion.create({
    data: {
      unitId: data.unitId,
      questionType: 'FRQ',
      frqType: data.frqType,
      questionText: data.questionText,
      promptText: data.promptText,
      starterCode: data.starterCode,
      frqParts: data.frqParts, // Store the parts array
      maxPoints: data.maxPoints || 9,
      explanation: data.explanation,
      approved: data.approved ?? false,
      aiGenerated: false,
    },
    include: {
      unit: true,
    },
  });

  return question;
}
 
  /**
   * Get all exam bank questions with filters
   */
  async getExamBankQuestions(filters: {
    unitId?: string;
    questionType?: ExamQuestionType;
    frqType?: FRQType;
    approved?: boolean;
    isActive?: boolean;
  }) {
    const where: any = {};

    if (filters.unitId) where.unitId = filters.unitId;
    if (filters.questionType) where.questionType = filters.questionType;
    if (filters.frqType) where.frqType = filters.frqType;
    if (filters.approved !== undefined) where.approved = filters.approved;
    if (filters.isActive !== undefined) where.isActive = filters.isActive;

    const questions = await prisma.examBankQuestion.findMany({
      where,
      include: {
        unit: true,
      },
      orderBy: [
        { unitId: 'asc' },
        { questionType: 'asc' },
        { createdAt: 'desc' },
      ],
    });

    return questions;
  }

  /**
   * Get random 42 MCQ questions for exam (distributed across units)
   */
  /**
 * Get random 42 MCQ questions for exam (distributed across units)
 */
async getRandomMCQForExam(): Promise<any[]> {
  // Get all units
  const units = await prisma.examUnit.findMany({
    orderBy: { unitNumber: 'asc' },
  });

  // Distribution based on exam weight (approximate)
  // Unit 1: 15-25% → ~9 questions (21%)
  // Unit 2: 25-35% → ~13 questions (31%)
  // Unit 3: 10-18% → ~6 questions (14%)
  // Unit 4: 30-40% → ~14 questions (33%)
  const distribution: Record<number, number> = {
    1: 9,
    2: 13,
    3: 6,
    4: 14,
  };

  const selectedQuestions: any[] = [];

  for (const unit of units) {
    const count = distribution[unit.unitNumber] || 0;

    // Get approved MCQ questions for this unit
    const questions = await prisma.examBankQuestion.findMany({
      where: {
        unitId: unit.id,
        questionType: 'MCQ',
        approved: true,
        isActive: true,
      },
    });

    if (questions.length < count) {
      throw new AppError(
        `Not enough MCQ questions for Unit ${unit.unitNumber}. Need ${count}, have ${questions.length}`,
        400
      );
    }

    // Randomly select questions
    const shuffled = questions.sort(() => 0.5 - Math.random());
    const selected = shuffled.slice(0, count);

    selectedQuestions.push(...selected);
  }

  // Shuffle final set
  return selectedQuestions.sort(() => 0.5 - Math.random());
}
  /**
   * Get 4 FRQ questions for exam (one of each type)
   */
  async getFRQForExam(): Promise<any[]> {
    const frqTypes: FRQType[] = ['METHODS_CONTROL', 'CLASSES', 'ARRAYLIST', 'TWO_D_ARRAY'];
    const selectedQuestions: any[] = [];

    for (const frqType of frqTypes) {
      const questions = await prisma.examBankQuestion.findMany({
        where: {
          questionType: 'FRQ',
          frqType: frqType,
          approved: true,
          isActive: true,
        },
      });

      if (questions.length === 0) {
        throw new AppError(`No approved ${frqType} questions available`, 400);
      }

      // Randomly select one
      const selected = questions[Math.floor(Math.random() * questions.length)];
      selectedQuestions.push(selected);
    }

    return selectedQuestions;
  }

  /**
   * Update exam bank question
   */
  async updateQuestion(questionId: string, data: any) {
    const question = await prisma.examBankQuestion.update({
      where: { id: questionId },
      data,
      include: {
        unit: true,
      },
    });

    return question;
  }

  /**
   * Delete exam bank question
   */
  async deleteQuestion(questionId: string) {
    await prisma.examBankQuestion.delete({
      where: { id: questionId },
    });
  }

  /**
   * Get exam units
   */
  async getExamUnits() {
    const units = await prisma.examUnit.findMany({
      orderBy: { unitNumber: 'asc' },
      include: {
        questions: {
          where: {
            approved: true,
            isActive: true,
          },
        },
      },
    });

    return units.map(unit => ({
      ...unit,
      mcqCount: unit.questions.filter(q => q.questionType === 'MCQ').length,
      frqCount: unit.questions.filter(q => q.questionType === 'FRQ').length,
    }));
  }

  /**
   * Get question counts by type
   */
  async getQuestionCounts() {
    const [mcqCount, frqCount, methodsCount, classesCount, arrayListCount, twoDArrayCount] = await Promise.all([
      prisma.examBankQuestion.count({
        where: { questionType: 'MCQ', approved: true, isActive: true },
      }),
      prisma.examBankQuestion.count({
        where: { questionType: 'FRQ', approved: true, isActive: true },
      }),
      prisma.examBankQuestion.count({
        where: { frqType: 'METHODS_CONTROL', approved: true, isActive: true },
      }),
      prisma.examBankQuestion.count({
        where: { frqType: 'CLASSES', approved: true, isActive: true },
      }),
      prisma.examBankQuestion.count({
        where: { frqType: 'ARRAYLIST', approved: true, isActive: true },
      }),
      prisma.examBankQuestion.count({
        where: { frqType: 'TWO_D_ARRAY', approved: true, isActive: true },
      }),
    ]);

    return {
      mcq: mcqCount,
      frq: frqCount,
      frqByType: {
        methodsControl: methodsCount,
        classes: classesCount,
        arrayList: arrayListCount,
        twoDArray: twoDArrayCount,
      },
      total: mcqCount + frqCount,
    };
  }
}

export default new ExamBankService();