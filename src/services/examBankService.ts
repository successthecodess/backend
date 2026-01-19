import prisma from '../config/database.js';
import { FRQType } from '@prisma/client';
import { AppError } from '../middleware/errorHandler.js';

// Cache for questions to avoid repeated DB calls
interface CachedQuestions {
  questions: Map<string, any[]>; // unitId -> questions
  timestamp: number;
}

let questionCache: CachedQuestions | null = null;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export class ExamBankService {
  
  /**
   * Preload all questions into cache
   */
  private async ensureCache(): Promise<Map<string, any[]>> {
    if (questionCache && Date.now() - questionCache.timestamp < CACHE_TTL) {
      return questionCache.questions;
    }

    console.log('📦 Loading question cache...');
    const startTime = Date.now();

    // Single query to get ALL approved questions
    const allQuestions = await prisma.question.findMany({
      where: { approved: true },
      include: {
        unit: true,
        topic: true,
      },
    });

    // Group by unitId
    const questionsByUnit = new Map<string, any[]>();
    for (const q of allQuestions) {
      const existing = questionsByUnit.get(q.unitId) || [];
      existing.push(q);
      questionsByUnit.set(q.unitId, existing);
    }

    questionCache = {
      questions: questionsByUnit,
      timestamp: Date.now(),
    };

    console.log(`✅ Cache loaded: ${allQuestions.length} questions in ${Date.now() - startTime}ms`);
    return questionsByUnit;
  }

  /**
   * Get 42 random MCQ questions for exam - OPTIMIZED
   * Uses cache and parallel processing
   */
  async getRandomMCQForExam(): Promise<any[]> {
    console.log('🎲 Selecting 42 random MCQ questions (optimized)...');
    const startTime = Date.now();

    // Get cached questions (single DB call or cache hit)
    const questionsByUnit = await this.ensureCache();

    // Get units
    const units = await prisma.unit.findMany({
      orderBy: { unitNumber: 'asc' },
      select: { id: true, unitNumber: true, name: true },
    });

    // AP CS A distribution
    const distribution: Record<number, number> = {
      1: 3, 2: 4, 3: 6, 4: 8, 5: 5, 6: 5, 7: 5, 8: 4, 9: 1, 10: 1,
    };

    const selectedQuestions: any[] = [];

    for (const unit of units) {
      const targetCount = distribution[unit.unitNumber] || 0;
      if (targetCount === 0) continue;

      const unitQuestions = questionsByUnit.get(unit.id) || [];
      
      if (unitQuestions.length === 0) {
        console.warn(`⚠️ No questions for Unit ${unit.unitNumber}`);
        continue;
      }

      // Fast shuffle and select
      const selected = this.fastRandomSelect(unitQuestions, targetCount);
      selectedQuestions.push(...selected);
    }

    // Final shuffle
    this.shuffleInPlace(selectedQuestions);

    console.log(`✅ Selected ${selectedQuestions.length}/42 MCQs in ${Date.now() - startTime}ms`);
    return selectedQuestions;
  }

  /**
   * Fast random selection without full shuffle
   */
  private fastRandomSelect<T>(array: T[], count: number): T[] {
    if (array.length <= count) return [...array];
    
    const result: T[] = [];
    const used = new Set<number>();
    
    while (result.length < count) {
      const idx = Math.floor(Math.random() * array.length);
      if (!used.has(idx)) {
        used.add(idx);
        result.push(array[idx]);
      }
    }
    
    return result;
  }

  /**
   * In-place shuffle (faster than creating new array)
   */
  private shuffleInPlace<T>(array: T[]): void {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
  }

  /**
   * Shuffle array (returns new array)
   */
  private shuffleArray<T>(array: T[]): T[] {
    const shuffled = [...array];
    this.shuffleInPlace(shuffled);
    return shuffled;
  }

  /**
   * Get 4 random FRQ questions - OPTIMIZED with single query
   */
  async getFRQForExam(): Promise<any[]> {
    console.log('🎲 Selecting 4 random FRQ questions...');
    const startTime = Date.now();

    // Single query to get all approved FRQs
    const allFRQs = await prisma.examBankQuestion.findMany({
      where: {
        questionType: 'FRQ',
        approved: true,
        isActive: true,
      },
      include: {
        unit: true,
      },
    });

    // Group by frqType
    const frqsByType = new Map<string, any[]>();
    for (const frq of allFRQs) {
      if (!frq.frqType) continue;
      const existing = frqsByType.get(frq.frqType) || [];
      existing.push(frq);
      frqsByType.set(frq.frqType, existing);
    }

    const frqTypes: FRQType[] = ['METHODS_CONTROL', 'CLASSES', 'ARRAYLIST', 'TWO_D_ARRAY'];
    const selectedQuestions: any[] = [];

    for (const frqType of frqTypes) {
      const questions = frqsByType.get(frqType) || [];
      if (questions.length === 0) {
        console.warn(`⚠️ No approved ${frqType} questions`);
        continue;
      }
      // Random select one
      const randomIndex = Math.floor(Math.random() * questions.length);
      selectedQuestions.push(questions[randomIndex]);
    }

    console.log(`✅ Selected ${selectedQuestions.length}/4 FRQs in ${Date.now() - startTime}ms`);
    return selectedQuestions;
  }

  /**
   * Invalidate cache (call when questions are added/updated/deleted)
   */
  invalidateCache(): void {
    questionCache = null;
    console.log('🗑️ Question cache invalidated');
  }

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

  async getExamBankQuestions(filters: {
    unitId?: string;
    questionType?: 'MCQ' | 'FRQ';
    frqType?: FRQType;
    approved?: boolean;
  }) {
    const results: any[] = [];

    if (!filters.questionType || filters.questionType === 'MCQ') {
      const mcqWhere: any = {
        approved: filters.approved ?? true,
      };
      if (filters.unitId) mcqWhere.unitId = filters.unitId;

      const mcqs = await prisma.question.findMany({
        where: mcqWhere,
        include: {
          unit: true,
          topic: true,
        },
        orderBy: [
          { unitId: 'asc' },
          { createdAt: 'desc' },
        ],
      });

      results.push(...mcqs.map(q => ({ ...q, questionType: 'MCQ' })));
    }

    if (!filters.questionType || filters.questionType === 'FRQ') {
      const frqWhere: any = {
        questionType: 'FRQ',
        isActive: true,
      };
      if (filters.unitId) frqWhere.unitId = filters.unitId;
      if (filters.frqType) frqWhere.frqType = filters.frqType;
      if (filters.approved !== undefined) frqWhere.approved = filters.approved;

      const frqs = await prisma.examBankQuestion.findMany({
        where: frqWhere,
        include: {
          unit: true,
        },
        orderBy: [
          { unitId: 'asc' },
          { frqType: 'asc' },
          { createdAt: 'desc' },
        ],
      });

      results.push(...frqs);
    }

    return results;
  }

  async updateQuestion(questionId: string, data: any) {
    const mcq = await prisma.question.findUnique({
      where: { id: questionId },
    });

    if (mcq) {
      const result = await prisma.question.update({
        where: { id: questionId },
        data,
        include: {
          unit: true,
          topic: true,
        },
      });
      this.invalidateCache();
      return result;
    }

    return prisma.examBankQuestion.update({
      where: { id: questionId },
      data,
      include: {
        unit: true,
      },
    });
  }

  async deleteQuestion(questionId: string) {
    const mcq = await prisma.question.findUnique({
      where: { id: questionId },
    });

    if (mcq) {
      await prisma.question.delete({
        where: { id: questionId },
      });
      this.invalidateCache();
      return;
    }

    await prisma.examBankQuestion.delete({
      where: { id: questionId },
    });
  }

  async getExamUnits() {
    const units = await prisma.unit.findMany({
      orderBy: { unitNumber: 'asc' },
      select: { id: true, unitNumber: true, name: true },
    });

    // Use cache for counts if available
    const questionsByUnit = await this.ensureCache();

    return units.map((unit) => {
      const questions = questionsByUnit.get(unit.id) || [];
      return {
        ...unit,
        mcqCount: questions.length,
        frqCount: 0, // FRQs are separate
      };
    });
  }

  async getQuestionCounts() {
    // Use cache for MCQ count
    const questionsByUnit = await this.ensureCache();
    let mcqCount = 0;
    for (const questions of questionsByUnit.values()) {
      mcqCount += questions.length;
    }

    const [frqCount, methodsCount, classesCount, arrayListCount, twoDArrayCount] = await Promise.all([
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