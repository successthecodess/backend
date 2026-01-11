import prisma from '../config/database.js';
import { ExamQuestionType, FRQType, ExamDifficulty } from '@prisma/client';
import { AppError } from '../middleware/errorHandler.js';
import { v4 as uuidv4 } from 'uuid';

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
   * Create a new FRQ question with multi-part structure
   */
  async createFRQQuestion(data: {
    unitId: string;
    frqType: FRQType;
    questionText: string;
    promptText: string;
    starterCode?: string;
    frqParts?: any;
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
        frqParts: data.frqParts,
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
   * Get available practice questions (not already in exam bank)
   */
  async getAvailablePracticeQuestions(unitId?: string) {
    try {
      // Build where clause for practice questions
      const where: any = {
        approved: true,
      };

      if (unitId) {
        where.unitId = unitId;
      }

      // Get all approved practice questions
      const practiceQuestions = await prisma.question.findMany({
        where,
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
        orderBy: [
          { unit: { unitNumber: 'asc' } },
          { difficulty: 'asc' },
          { createdAt: 'desc' },
        ],
      });

      // Get IDs of questions already in exam bank
      const examBankQuestions = await prisma.examBankQuestion.findMany({
        where: {
          questionId: { not: null },
        },
        select: {
          questionId: true,
        },
      });

      const examBankIds = new Set(
        examBankQuestions
          .map(q => q.questionId)
          .filter((id): id is string => id !== null)
      );

      // Filter out questions already in exam bank
      const availableQuestions = practiceQuestions
        .filter(q => !examBankIds.has(q.id))
        .map(q => ({
          id: q.id,
          questionText: q.questionText,
          options: q.options,
          correctAnswer: q.correctAnswer,
          explanation: q.explanation,
          difficulty: q.difficulty,
          unit: q.unit ? {
            id: q.unit.id,
            unitNumber: q.unit.unitNumber,
            name: q.unit.name,
          } : null,
          topic: q.topic ? {
            id: q.topic.id,
            name: q.topic.name,
          } : null,
        }));

      return availableQuestions;
    } catch (error) {
      console.error('Error fetching available practice questions:', error);
      throw new AppError('Failed to fetch available practice questions', 500);
    }
  }

  /**
   * Import MCQ questions from practice tests to exam bank
   */
  async importMCQQuestions(questionIds: string[]) {
    try {
      let imported = 0;
      const errors: string[] = [];
      const importedQuestions: any[] = [];

      // Use transaction for atomicity
      await prisma.$transaction(async (tx) => {
        for (const questionId of questionIds) {
          try {
            // Check if question exists in practice questions
            const question = await tx.question.findUnique({
              where: { id: questionId },
              include: {
                unit: true,
                topic: true,
              },
            });

            if (!question || !question.approved) {
              errors.push(`Question ${questionId} not found or not approved`);
              continue;
            }

            // Check if already in exam bank
            const existing = await tx.examBankQuestion.findFirst({
              where: { questionId: questionId },
            });

            if (existing) {
              errors.push(`Question ${questionId} already in exam bank`);
              continue;
            }

            // Insert into exam bank
            const newQuestion = await tx.examBankQuestion.create({
              data: {
                questionId: questionId,
                unitId: question.unitId,
                questionType: 'MCQ',
                questionText: question.questionText,
                options: question.options,
                correctAnswer: question.correctAnswer,
                explanation: question.explanation,
                difficulty: question.difficulty,
                approved: true, // Already approved in practice questions
                aiGenerated: false,
              },
              include: {
                unit: true,
              },
            });

            importedQuestions.push(newQuestion);
            imported++;
          } catch (error: any) {
            console.error(`Error importing question ${questionId}:`, error);
            errors.push(`Failed to import question ${questionId}: ${error.message}`);
          }
        }
      });

      return {
        imported,
        total: questionIds.length,
        errors: errors.length > 0 ? errors : undefined,
        questions: importedQuestions,
      };
    } catch (error) {
      console.error('Error importing questions:', error);
      throw new AppError('Failed to import questions', 500);
    }
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
  async getRandomMCQForExam(): Promise<any[]> {
    const units = await prisma.examUnit.findMany({
      orderBy: { unitNumber: 'asc' },
    });

    const distribution: Record<number, number> = {
      1: 9,
      2: 13,
      3: 6,
      4: 14,
    };

    const selectedQuestions: any[] = [];

    for (const unit of units) {
      const count = distribution[unit.unitNumber] || 0;

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

      const shuffled = questions.sort(() => 0.5 - Math.random());
      const selected = shuffled.slice(0, count);

      selectedQuestions.push(...selected);
    }

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