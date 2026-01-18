import prisma from '../config/database.js';
import { AppError } from '../middleware/errorHandler.js';
import { DifficultyLevel } from '@prisma/client';

// Question type for cache
interface CachedQuestion {
  id: string;
  questionText: string;
  codeSnippet: string | null;
  options: any;
  correctAnswer: string;
  explanation: string;
  difficulty: DifficultyLevel;
  topicId: string | null;
  topic: { id: string; name: string } | null;
}

// Cache entry type
interface CacheEntry {
  questions: CachedQuestion[];
  timestamp: number;
}

// In-memory cache for questions (per unit)
const questionCache: Map<string, CacheEntry> = new Map();

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export class PracticeSessionService {
  private readonly QUESTIONS_PER_SESSION = 40;

  /**
   * Get cached questions for a unit or fetch fresh
   */
  private async getCachedQuestions(unitId: string, topicId?: string): Promise<CachedQuestion[]> {
    const cacheKey = `${unitId}_${topicId || 'all'}`;
    const cached = questionCache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.questions;
    }

    const where: {
      unitId: string;
      approved: boolean;
      isActive: boolean;
      topicId?: string;
    } = {
      unitId,
      approved: true,
      isActive: true,
    };

    if (topicId) {
      where.topicId = topicId;
    }

    const questions = await prisma.question.findMany({
      where,
      select: {
        id: true,
        questionText: true,
        codeSnippet: true,
        options: true,
        correctAnswer: true,
        explanation: true,
        difficulty: true,
        topicId: true,
        topic: { select: { id: true, name: true } },
      },
    });

    questionCache.set(cacheKey, {
      questions,
      timestamp: Date.now(),
    });

    return questions;
  }

  /**
   * Ensure user exists - optimized with upsert
   */
  private async ensureUserExists(userId: string, userEmail?: string, userName?: string) {
    const email = userEmail || `${userId}-${Date.now()}@clerk.user`;

    return prisma.user.upsert({
      where: { id: userId },
      update: {
        lastActive: new Date(),
        ...(userName && { name: userName }),
      },
      create: {
        id: userId,
        email,
        name: userName,
        password: 'clerk-managed',
      },
    });
  }

  /**
   * Start a new practice session - OPTIMIZED
   */
  async startSession(
    userId: string,
    unitId: string,
    topicId?: string,
    userEmail?: string,
    userName?: string,
    targetQuestions: number = 40
  ) {
    // Run user creation, unit fetch, and questions fetch in parallel
    const [, unit, questions] = await Promise.all([
      this.ensureUserExists(userId, userEmail, userName),
      prisma.unit.findUnique({
        where: { id: unitId },
        select: { id: true, name: true, unitNumber: true },
      }),
      this.getCachedQuestions(unitId, topicId),
    ]);

    if (!unit) {
      throw new AppError('Unit not found', 404);
    }

    if (questions.length === 0) {
      throw new AppError(
        `No approved questions available for ${unit.name}. Please contact your administrator to add questions.`,
        404
      );
    }

    // Get user's progress for difficulty recommendation
    const progress = await prisma.progress.findFirst({
      where: { userId, unitId, topicId: topicId ?? null },
      select: { currentDifficulty: true },
    });

    const studentLevel = progress?.currentDifficulty || 'EASY';

    // Create session
    const session = await prisma.studySession.create({
      data: {
        userId,
        unitId,
        topicId: topicId ?? null,
        sessionType: 'PRACTICE',
        totalQuestions: 0,
        correctAnswers: 0,
        targetQuestions,
      },
    });

    // Get first question from cached questions
    const questionsAtLevel = questions.filter((q) => q.difficulty === studentLevel);
    const question =
      questionsAtLevel.length > 0
        ? questionsAtLevel[Math.floor(Math.random() * questionsAtLevel.length)]
        : questions[Math.floor(Math.random() * questions.length)];

    // Get question counts from cached data
    const counts = {
      total: questions.length,
      easy: questions.filter((q) => q.difficulty === 'EASY').length,
      medium: questions.filter((q) => q.difficulty === 'MEDIUM').length,
      hard: questions.filter((q) => q.difficulty === 'HARD').length,
    };

    return {
      session,
      question,
      recommendedDifficulty: studentLevel,
      questionsRemaining: targetQuestions - 1,
      totalQuestions: targetQuestions,
      questionCounts: counts,
    };
  }

  /**
   * Get next question - OPTIMIZED using cache
   */
  async getNextQuestion(
    userId: string,
    sessionId: string,
    unitId: string,
    answeredQuestionIds: string[],
    topicId?: string
  ): Promise<CachedQuestion | null> {
    // Get session and progress in parallel
    const [session, progress] = await Promise.all([
      prisma.studySession.findUnique({
        where: { id: sessionId },
        select: { totalQuestions: true, targetQuestions: true },
      }),
      prisma.progress.findFirst({
        where: { userId, unitId, topicId: topicId ?? null },
        select: { currentDifficulty: true },
      }),
    ]);

    if (!session) {
      throw new AppError('Session not found', 404);
    }

    const targetQuestions = session.targetQuestions || this.QUESTIONS_PER_SESSION;
    if (session.totalQuestions >= targetQuestions) {
      return null;
    }

    const studentLevel = progress?.currentDifficulty || 'EASY';

    // Get questions from cache
    const allQuestions = await this.getCachedQuestions(unitId, topicId);

    // Filter out answered questions using Set for O(1) lookup
    const answeredSet = new Set(answeredQuestionIds);
    const availableQuestions = allQuestions.filter((q) => !answeredSet.has(q.id));

    if (availableQuestions.length === 0) {
      return null;
    }

    // Try to get question at student's level
    const questionsAtLevel = availableQuestions.filter((q) => q.difficulty === studentLevel);

    if (questionsAtLevel.length > 0) {
      return questionsAtLevel[Math.floor(Math.random() * questionsAtLevel.length)];
    }

    // Fallback: try adjacent difficulties
    const difficulties: DifficultyLevel[] = ['EASY', 'MEDIUM', 'HARD'];
    const currentIndex = difficulties.indexOf(studentLevel);
    const tryOrder = [currentIndex - 1, currentIndex + 1].filter((i) => i >= 0 && i < 3);

    for (const index of tryOrder) {
      const fallbackQuestions = availableQuestions.filter(
        (q) => q.difficulty === difficulties[index]
      );
      if (fallbackQuestions.length > 0) {
        return fallbackQuestions[Math.floor(Math.random() * fallbackQuestions.length)];
      }
    }

    // Last resort: any available question
    return availableQuestions[Math.floor(Math.random() * availableQuestions.length)];
  }

  /**
   * Submit answer - OPTIMIZED with parallel operations
   */
  async submitAnswer(
    userId: string,
    sessionId: string,
    questionId: string,
    userAnswer: string,
    timeSpent?: number
  ) {
    // Get session first
    const session = await prisma.studySession.findUnique({
      where: { id: sessionId },
      select: { unitId: true, topicId: true },
    });

    if (!session) {
      throw new AppError('Session not found', 404);
    }

    if (!session.unitId) {
      throw new AppError('Session has no unit assigned', 400);
    }

    // Try to get question from cache first (much faster)
    const allQuestions = await this.getCachedQuestions(
      session.unitId,
      session.topicId ?? undefined
    );
    
    let question = allQuestions.find((q) => q.id === questionId);

    // Fallback to DB if not in cache
    if (!question) {
      const dbQuestion = await prisma.question.findUnique({
        where: { id: questionId },
        select: {
          id: true,
          questionText: true,
          codeSnippet: true,
          options: true,
          correctAnswer: true,
          explanation: true,
          difficulty: true,
          topicId: true,
          topic: { select: { id: true, name: true } },
        },
      });
      
      if (!dbQuestion) {
        throw new AppError('Question not found', 404);
      }
      
      question = dbQuestion;
    }

    const isCorrect =
      userAnswer.trim().toLowerCase() === question.correctAnswer.trim().toLowerCase();

    // Get current progress for difficulty calculation
    const currentProgress = await prisma.progress.findFirst({
      where: { userId, unitId: session.unitId, topicId: session.topicId },
      select: { currentDifficulty: true, consecutiveCorrect: true, consecutiveWrong: true },
    });

    // Calculate new difficulty
    const newDifficulty = this.calculateNewDifficulty(currentProgress, isCorrect);

    // Run all updates in parallel
    const [, updatedSession, updatedProgress] = await Promise.all([
      // Save response
      prisma.questionResponse.create({
        data: {
          userId,
          questionId,
          sessionId,
          userAnswer,
          isCorrect,
          timeSpent,
          difficultyAtTime: question.difficulty,
        },
      }),
      // Update session
      prisma.studySession.update({
        where: { id: sessionId },
        data: {
          totalQuestions: { increment: 1 },
          ...(isCorrect && { correctAnswers: { increment: 1 } }),
        },
      }),
      // Update progress - handle null topicId properly
      this.upsertProgress(userId, session.unitId, session.topicId, isCorrect, newDifficulty),
    ]);

    return {
      isCorrect,
      correctAnswer: question.correctAnswer,
      explanation: question.explanation,
      userAnswer,
      session: updatedSession,
      progress: updatedProgress,
    };
  }

  /**
   * Upsert progress with proper null handling for topicId
   */
  private async upsertProgress(
    userId: string,
    unitId: string,
    topicId: string | null,
    isCorrect: boolean,
    newDifficulty: DifficultyLevel
  ) {
    // First try to find existing progress
    const existingProgress = await prisma.progress.findFirst({
      where: { userId, unitId, topicId },
    });

    if (existingProgress) {
      // Update existing
      return prisma.progress.update({
        where: { id: existingProgress.id },
        data: {
          totalAttempts: { increment: 1 },
          ...(isCorrect && { correctAttempts: { increment: 1 } }),
          consecutiveCorrect: isCorrect ? { increment: 1 } : 0,
          consecutiveWrong: isCorrect ? 0 : { increment: 1 },
          lastPracticed: new Date(),
          currentDifficulty: newDifficulty,
        },
      });
    } else {
      // Create new
      return prisma.progress.create({
        data: {
          userId,
          unitId,
          topicId,
          totalAttempts: 1,
          correctAttempts: isCorrect ? 1 : 0,
          consecutiveCorrect: isCorrect ? 1 : 0,
          consecutiveWrong: isCorrect ? 0 : 1,
          currentDifficulty: 'EASY',
        },
      });
    }
  }

  /**
   * Calculate new difficulty based on performance - synchronous version
   */
  private calculateNewDifficulty(
    currentProgress: {
      currentDifficulty: DifficultyLevel;
      consecutiveCorrect: number;
      consecutiveWrong: number;
    } | null,
    wasCorrect: boolean
  ): DifficultyLevel {
    if (!currentProgress) return 'EASY';

    const current = currentProgress.currentDifficulty;
    const difficulties: DifficultyLevel[] = ['EASY', 'MEDIUM', 'HARD'];
    const currentIndex = difficulties.indexOf(current);

    if (wasCorrect && currentProgress.consecutiveCorrect >= 2) {
      // Level up after 3 correct in a row
      return difficulties[Math.min(currentIndex + 1, 2)];
    } else if (!wasCorrect && currentProgress.consecutiveWrong >= 1) {
      // Level down after 2 wrong in a row
      return difficulties[Math.max(currentIndex - 1, 0)];
    }

    return current;
  }

  /**
   * End a practice session - OPTIMIZED
   */
  async endSession(sessionId: string) {
    const session = await prisma.studySession.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        startedAt: true,
        totalQuestions: true,
        correctAnswers: true,
      },
    });

    if (!session) {
      throw new AppError('Session not found', 404);
    }

    const duration = Math.floor(
      (new Date().getTime() - new Date(session.startedAt).getTime()) / 1000
    );

    const averageTime = session.totalQuestions > 0 ? duration / session.totalQuestions : 0;
    const accuracyRate =
      session.totalQuestions > 0 ? (session.correctAnswers / session.totalQuestions) * 100 : 0;

    const updatedSession = await prisma.studySession.update({
      where: { id: sessionId },
      data: {
        endedAt: new Date(),
        totalDuration: duration,
        averageTime,
        accuracyRate,
      },
    });

    return {
      session: updatedSession,
      summary: {
        totalQuestions: session.totalQuestions,
        correctAnswers: session.correctAnswers,
        accuracyRate: Math.round(accuracyRate),
        totalDuration: duration,
        averageTime: Math.round(averageTime),
      },
    };
  }

  /**
   * Get session statistics - OPTIMIZED
   */
  async getSessionStats(sessionId: string) {
    const session = await prisma.studySession.findUnique({
      where: { id: sessionId },
      select: {
        totalQuestions: true,
        correctAnswers: true,
        _count: { select: { responses: true } },
      },
    });

    if (!session) {
      throw new AppError('Session not found', 404);
    }

    return {
      totalQuestions: session.totalQuestions,
      correctAnswers: session.correctAnswers,
      accuracy:
        session.totalQuestions > 0 ? (session.correctAnswers / session.totalQuestions) * 100 : 0,
      responsesCount: session._count.responses,
    };
  }

  /**
   * Invalidate question cache for a unit
   */
  invalidateCache(unitId: string) {
    for (const key of questionCache.keys()) {
      if (key.startsWith(unitId)) {
        questionCache.delete(key);
      }
    }
  }
}

export default new PracticeSessionService();