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
  unit?: { id: string; name: string; unitNumber: number; color: string | null } | null;
}

// Cache entry type
interface CacheEntry {
  questions: CachedQuestion[];
  timestamp: number;
}

// In-memory cache for questions (per unit)
const questionCache: Map<string, CacheEntry> = new Map();

// In-memory cache for mixed mode session progress (sessionId -> progress)
const mixedSessionProgress: Map<string, {
  currentDifficulty: DifficultyLevel;
  consecutiveCorrect: number;
  consecutiveWrong: number;
  totalAttempts: number;
  correctAttempts: number;
  masteryLevel: number;
}> = new Map();

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export class PracticeSessionService {
  private readonly QUESTIONS_PER_SESSION = 40;
  
  // Difficulty progression constants
  private readonly CORRECT_STREAK_TO_ADVANCE = 3;
  private readonly WRONG_STREAK_TO_DECREASE = 2;

  /**
   * Get cached questions for a unit or all units (mixed mode)
   */
  private async getCachedQuestions(unitId?: string, topicId?: string): Promise<CachedQuestion[]> {
    const cacheKey = `${unitId || 'all'}_${topicId || 'all'}`;
    const cached = questionCache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.questions;
    }

    const where: {
      unitId?: string;
      approved: boolean;
      isActive: boolean;
      topicId?: string;
    } = {
      approved: true,
      isActive: true,
    };

    if (unitId) {
      where.unitId = unitId;
    }

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
        unit: { select: { id: true, name: true, unitNumber: true, color: true } },
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
   * Calculate new difficulty based on performance
   */
  private calculateNewDifficulty(
    currentDifficulty: DifficultyLevel,
    consecutiveCorrect: number,
    consecutiveWrong: number,
    wasCorrect: boolean
  ): DifficultyLevel {
    const difficulties: DifficultyLevel[] = ['EASY', 'MEDIUM', 'HARD'];
    const currentIndex = difficulties.indexOf(currentDifficulty);

    const newConsecutiveCorrect = wasCorrect ? consecutiveCorrect + 1 : 0;
    const newConsecutiveWrong = wasCorrect ? 0 : consecutiveWrong + 1;

    // Level UP: 3 correct in a row
    if (newConsecutiveCorrect >= this.CORRECT_STREAK_TO_ADVANCE && currentIndex < 2) {
      const newLevel = difficulties[currentIndex + 1];
      console.log(`📈 LEVEL UP: ${currentDifficulty} → ${newLevel} (${newConsecutiveCorrect} correct in a row)`);
      return newLevel;
    }

    // Level DOWN: 2 wrong in a row
    if (newConsecutiveWrong >= this.WRONG_STREAK_TO_DECREASE && currentIndex > 0) {
      const newLevel = difficulties[currentIndex - 1];
      console.log(`📉 LEVEL DOWN: ${currentDifficulty} → ${newLevel} (${newConsecutiveWrong} wrong in a row)`);
      return newLevel;
    }

    return currentDifficulty;
  }

  /**
   * Get or create mixed session progress
   */
  private getMixedSessionProgress(sessionId: string) {
    if (!mixedSessionProgress.has(sessionId)) {
      mixedSessionProgress.set(sessionId, {
        currentDifficulty: 'EASY',
        consecutiveCorrect: 0,
        consecutiveWrong: 0,
        totalAttempts: 0,
        correctAttempts: 0,
        masteryLevel: 0,
      });
    }
    return mixedSessionProgress.get(sessionId)!;
  }

  /**
   * Update mixed session progress after answering
   */
  private updateMixedSessionProgress(sessionId: string, isCorrect: boolean) {
    const progress = this.getMixedSessionProgress(sessionId);
    
    const newConsecutiveCorrect = isCorrect ? progress.consecutiveCorrect + 1 : 0;
    const newConsecutiveWrong = isCorrect ? 0 : progress.consecutiveWrong + 1;
    const newTotalAttempts = progress.totalAttempts + 1;
    const newCorrectAttempts = progress.correctAttempts + (isCorrect ? 1 : 0);
    
    // Calculate new difficulty
    const newDifficulty = this.calculateNewDifficulty(
      progress.currentDifficulty,
      progress.consecutiveCorrect,
      progress.consecutiveWrong,
      isCorrect
    );

    // Calculate mastery level
    const accuracy = newTotalAttempts > 0 ? (newCorrectAttempts / newTotalAttempts) * 100 : 0;
    const newMasteryLevel = Math.min(100, Math.round(accuracy));

    // Update progress
    const updatedProgress = {
      currentDifficulty: newDifficulty,
      consecutiveCorrect: newConsecutiveCorrect,
      consecutiveWrong: newConsecutiveWrong,
      totalAttempts: newTotalAttempts,
      correctAttempts: newCorrectAttempts,
      masteryLevel: newMasteryLevel,
    };

    mixedSessionProgress.set(sessionId, updatedProgress);

    console.log('📊 Mixed Session Progress Updated:', {
      sessionId,
      isCorrect,
      streak: isCorrect ? `${newConsecutiveCorrect} ✓` : `${newConsecutiveWrong} ✗`,
      difficulty: newDifficulty,
      mastery: `${newMasteryLevel}%`,
    });

    return updatedProgress;
  }

  /**
   * Start a new practice session
   */
  async startSession(
    userId: string,
    unitId?: string,
    topicId?: string,
    userEmail?: string,
    userName?: string,
    targetQuestions: number = 40,
    mixed: boolean = false
  ) {
    if (mixed) {
      const [, questions] = await Promise.all([
        this.ensureUserExists(userId, userEmail, userName),
        this.getCachedQuestions(undefined, undefined),
      ]);

      if (questions.length === 0) {
        throw new AppError(
          'No approved questions available. Please contact your administrator to add questions.',
          404
        );
      }

      const session = await prisma.studySession.create({
        data: {
          userId,
          unitId: null,
          topicId: null,
          sessionType: 'PRACTICE',
          totalQuestions: 0,
          correctAnswers: 0,
          targetQuestions,
        },
      });

      // Initialize mixed session progress - ALWAYS start at EASY
      mixedSessionProgress.set(session.id, {
        currentDifficulty: 'EASY',
        consecutiveCorrect: 0,
        consecutiveWrong: 0,
        totalAttempts: 0,
        correctAttempts: 0,
        masteryLevel: 0,
      });

      // Get first question - MUST be EASY
      const easyQuestions = questions.filter((q) => q.difficulty === 'EASY');
      let question: CachedQuestion;
      
      if (easyQuestions.length > 0) {
        question = easyQuestions[Math.floor(Math.random() * easyQuestions.length)];
        console.log('🎯 Mixed session started - First EASY question selected');
      } else {
        // Fallback if no EASY questions (shouldn't happen normally)
        question = questions[Math.floor(Math.random() * questions.length)];
        console.log('⚠️ No EASY questions available, using random:', question.difficulty);
      }

      const counts = {
        total: questions.length,
        easy: questions.filter((q) => q.difficulty === 'EASY').length,
        medium: questions.filter((q) => q.difficulty === 'MEDIUM').length,
        hard: questions.filter((q) => q.difficulty === 'HARD').length,
      };

      const uniqueUnits = new Set(questions.map(q => q.unit?.id).filter(Boolean));

      return {
        sessionId: session.id,
        session,
        question,
        recommendedDifficulty: 'EASY',
        currentDifficulty: 'EASY',
        questionsRemaining: targetQuestions - 1,
        totalQuestions: targetQuestions,
        questionCounts: counts,
        isMixedMode: true,
        unitsCount: uniqueUnits.size,
        progress: {
          currentDifficulty: 'EASY',
          consecutiveCorrect: 0,
          consecutiveWrong: 0,
          totalAttempts: 0,
          correctAttempts: 0,
          masteryLevel: 0,
        },
      };
    }

    // Regular mode - requires unitId
    if (!unitId) {
      throw new AppError('unitId is required for non-mixed practice sessions', 400);
    }

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

    const progress = await prisma.progress.findFirst({
      where: { userId, unitId, topicId: topicId ?? null },
      select: { currentDifficulty: true },
    });

    const studentLevel = progress?.currentDifficulty || 'EASY';

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

    const questionsAtLevel = questions.filter((q) => q.difficulty === studentLevel);
    const question =
      questionsAtLevel.length > 0
        ? questionsAtLevel[Math.floor(Math.random() * questionsAtLevel.length)]
        : questions[Math.floor(Math.random() * questions.length)];

    const counts = {
      total: questions.length,
      easy: questions.filter((q) => q.difficulty === 'EASY').length,
      medium: questions.filter((q) => q.difficulty === 'MEDIUM').length,
      hard: questions.filter((q) => q.difficulty === 'HARD').length,
    };

    return {
      sessionId: session.id,
      session,
      question,
      recommendedDifficulty: studentLevel,
      currentDifficulty: studentLevel,
      questionsRemaining: targetQuestions - 1,
      totalQuestions: targetQuestions,
      questionCounts: counts,
      isMixedMode: false,
    };
  }

  /**
   * Get next question - RESPECTS DIFFICULTY FOR MIXED MODE
   */
  async getNextQuestion(
    userId: string,
    sessionId: string,
    unitId?: string,
    answeredQuestionIds: string[] = [],
    topicId?: string,
    mixed: boolean = false,
    requestedDifficulty?: string
  ): Promise<{ question: CachedQuestion | null; currentDifficulty: DifficultyLevel }> {
    const session = await prisma.studySession.findUnique({
      where: { id: sessionId },
      select: { totalQuestions: true, targetQuestions: true, unitId: true },
    });

    if (!session) {
      throw new AppError('Session not found', 404);
    }

    const targetQuestions = session.targetQuestions || this.QUESTIONS_PER_SESSION;
    if (session.totalQuestions >= targetQuestions) {
      return { question: null, currentDifficulty: 'EASY' };
    }

    const isMixedMode = mixed || !session.unitId;
    let studentLevel: DifficultyLevel;

    if (isMixedMode) {
      // For mixed mode, use session-specific progress
      const mixedProgress = this.getMixedSessionProgress(sessionId);
      studentLevel = (requestedDifficulty as DifficultyLevel) || mixedProgress.currentDifficulty;
      
      console.log('📊 Mixed Mode - getNextQuestion:', {
        sessionId,
        requestedDifficulty,
        progressDifficulty: mixedProgress.currentDifficulty,
        finalDifficulty: studentLevel,
        consecutiveCorrect: mixedProgress.consecutiveCorrect,
        consecutiveWrong: mixedProgress.consecutiveWrong,
      });
    } else {
      // For regular mode, use database progress
      const progress = unitId
        ? await prisma.progress.findFirst({
            where: { userId, unitId, topicId: topicId ?? null },
            select: { currentDifficulty: true },
          })
        : null;
      studentLevel = (requestedDifficulty as DifficultyLevel) || progress?.currentDifficulty || 'EASY';
    }

    // Get questions from cache
    const allQuestions = await this.getCachedQuestions(
      isMixedMode ? undefined : (unitId || session.unitId || undefined),
      topicId
    );

    // Filter out answered questions
    const answeredSet = new Set(answeredQuestionIds);
    const availableQuestions = allQuestions.filter((q) => !answeredSet.has(q.id));

    if (availableQuestions.length === 0) {
      return { question: null, currentDifficulty: studentLevel };
    }

    // Try to get question at student's level
    const questionsAtLevel = availableQuestions.filter((q) => q.difficulty === studentLevel);

    console.log(`📝 Questions available at ${studentLevel}: ${questionsAtLevel.length} / ${availableQuestions.length} total`);

    if (questionsAtLevel.length > 0) {
      const selected = questionsAtLevel[Math.floor(Math.random() * questionsAtLevel.length)];
      console.log(`✅ Selected ${studentLevel} question from Unit ${selected.unit?.unitNumber}`);
      return { question: selected, currentDifficulty: studentLevel };
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
        const selected = fallbackQuestions[Math.floor(Math.random() * fallbackQuestions.length)];
        console.log(`⚠️ Fallback to ${difficulties[index]} question`);
        return { question: selected, currentDifficulty: studentLevel };
      }
    }

    // Last resort: any available question
    const selected = availableQuestions[Math.floor(Math.random() * availableQuestions.length)];
    console.log(`🔄 Last resort - any question: ${selected.difficulty}`);
    return { question: selected, currentDifficulty: studentLevel };
  }

  /**
   * Submit answer - HANDLES MIXED MODE PROGRESS SEPARATELY
   */
  async submitAnswer(
    userId: string,
    sessionId: string,
    questionId: string,
    userAnswer: string,
    timeSpent?: number
  ) {
    const session = await prisma.studySession.findUnique({
      where: { id: sessionId },
      select: { unitId: true, topicId: true },
    });

    if (!session) {
      throw new AppError('Session not found', 404);
    }

    const isMixedMode = !session.unitId;

    // Get question
    const allQuestions = await this.getCachedQuestions(
      isMixedMode ? undefined : session.unitId!,
      session.topicId ?? undefined
    );

    let question = allQuestions.find((q) => q.id === questionId);

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
          unitId: true,
          topic: { select: { id: true, name: true } },
          unit: { select: { id: true, name: true, unitNumber: true, color: true } },
        },
      });

      if (!dbQuestion) {
        throw new AppError('Question not found', 404);
      }

      question = dbQuestion;
    }

    const isCorrect =
      userAnswer.trim().toLowerCase() === question.correctAnswer.trim().toLowerCase();

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📝 Answer Submission:', {
      isMixedMode,
      questionDifficulty: question.difficulty,
      isCorrect,
      unit: question.unit?.unitNumber,
    });

    // Save response
    await prisma.questionResponse.create({
      data: {
        userId,
        questionId,
        sessionId,
        userAnswer,
        isCorrect,
        timeSpent,
        difficultyAtTime: question.difficulty,
      },
    });

    // Update session
    const updatedSession = await prisma.studySession.update({
      where: { id: sessionId },
      data: {
        totalQuestions: { increment: 1 },
        ...(isCorrect && { correctAnswers: { increment: 1 } }),
      },
    });

    let progressData;

    if (isMixedMode) {
      // For mixed mode, use session-specific progress
      progressData = this.updateMixedSessionProgress(sessionId, isCorrect);
      
      console.log('📊 Mixed Mode Progress:', {
        difficulty: progressData.currentDifficulty,
        streak: isCorrect 
          ? `${progressData.consecutiveCorrect} correct` 
          : `${progressData.consecutiveWrong} wrong`,
        mastery: `${progressData.masteryLevel}%`,
      });
    } else {
      // For regular mode, update database progress
      const progressUnitId = session.unitId || (question as any).unit?.id;
      
      if (progressUnitId) {
        const existingProgress = await prisma.progress.findFirst({
          where: { userId, unitId: progressUnitId, topicId: session.topicId },
        });

        if (existingProgress) {
          const newDifficulty = this.calculateNewDifficulty(
            existingProgress.currentDifficulty,
            existingProgress.consecutiveCorrect,
            existingProgress.consecutiveWrong,
            isCorrect
          );

          progressData = await prisma.progress.update({
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
          progressData = await prisma.progress.create({
            data: {
              userId,
              unitId: progressUnitId,
              topicId: session.topicId,
              totalAttempts: 1,
              correctAttempts: isCorrect ? 1 : 0,
              consecutiveCorrect: isCorrect ? 1 : 0,
              consecutiveWrong: isCorrect ? 0 : 1,
              currentDifficulty: 'EASY',
              masteryLevel: 0,
            },
          });
        }
      }
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    return {
      isCorrect,
      correctAnswer: question.correctAnswer,
      explanation: question.explanation,
      userAnswer,
      session: updatedSession,
      progress: progressData || {
        currentDifficulty: 'EASY',
        consecutiveCorrect: isCorrect ? 1 : 0,
        consecutiveWrong: isCorrect ? 0 : 1,
        masteryLevel: 0,
        totalAttempts: 1,
      },
    };
  }

  /**
   * End a practice session
   */
  async endSession(sessionId: string) {
    const session = await prisma.studySession.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        startedAt: true,
        totalQuestions: true,
        correctAnswers: true,
        unitId: true,
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

    // Clean up mixed session progress
    mixedSessionProgress.delete(sessionId);

    return {
      session: updatedSession,
      summary: {
        totalQuestions: session.totalQuestions,
        correctAnswers: session.correctAnswers,
        incorrectAnswers: session.totalQuestions - session.correctAnswers,
        accuracy: Math.round(accuracyRate),
        accuracyRate: Math.round(accuracyRate),
        totalDuration: duration,
        averageTime: Math.round(averageTime),
        isMixedMode: !session.unitId,
      },
    };
  }

  /**
   * Get session statistics
   */
  async getSessionStats(sessionId: string) {
    const session = await prisma.studySession.findUnique({
      where: { id: sessionId },
      select: {
        totalQuestions: true,
        correctAnswers: true,
        unitId: true,
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
      isMixedMode: !session.unitId,
    };
  }

  /**
   * Invalidate question cache
   */
  invalidateCache(unitId?: string) {
    if (unitId) {
      for (const key of questionCache.keys()) {
        if (key.startsWith(unitId)) {
          questionCache.delete(key);
        }
      }
    } else {
      questionCache.clear();
    }
  }
}

export default new PracticeSessionService();