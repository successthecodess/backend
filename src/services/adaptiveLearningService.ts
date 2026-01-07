import prisma from '../config/database.js';
import { DifficultyLevel, Prisma } from '@prisma/client';
import { AppError } from '../middleware/errorHandler.js';

interface ProgressMetrics {
  currentDifficulty: DifficultyLevel;
  consecutiveCorrect: number;
  consecutiveWrong: number;
  totalAttempts: number;
  correctAttempts: number;
  masteryLevel: number;
  nextReviewDate?: Date;
  easeFactor?: number;
}

interface PerformancePattern {
  weakTopics: string[];
  strongTopics: string[];
  commonMistakes: Record<string, number>;
  timePatterns: {
    averageTimePerQuestion: number;
    fastestCorrect: number;
    slowestCorrect: number;
  };
}

export class AdaptiveLearningService {
  // Difficulty progression rules
  private readonly CORRECT_STREAK_TO_ADVANCE = 3; // 3 correct in a row
  private readonly WRONG_STREAK_TO_DECREASE = 2; // 2 wrong in a row
  private readonly MASTERY_THRESHOLD_TO_ADVANCE = 70; // 70% mastery to advance
  private readonly MASTERY_THRESHOLD_TO_DECREASE = 50; // Below 50% to decrease
  private readonly MIN_ATTEMPTS_FOR_ADVANCEMENT = 5; // At least 5 attempts before advancing
  private readonly MIN_ATTEMPTS_FOR_DECREASE = 3; // Can decrease after 3 attempts

  // Spaced repetition constants (SM-2 Algorithm)
  private readonly MIN_EASE_FACTOR = 1.3;
  private readonly DEFAULT_EASE_FACTOR = 2.5;
  private readonly MAX_EASE_FACTOR = 3.0;
  private readonly MAX_INTERVAL_DAYS = 365;

  /**
   * Find progress using composite key
   */
  private async findProgress(userId: string, unitId: string, topicId?: string) {
    const topicIdValue = topicId === undefined ? null : topicId;
    
    return await prisma.progress.findFirst({
      where: {
        userId,
        unitId,
        topicId: topicIdValue,
      },
    });
  }

  /**
   * Determine next difficulty based on performance - STRICT REQUIREMENTS
   */
  getNextDifficulty(
    currentDifficulty: DifficultyLevel,
    consecutiveCorrect: number,
    consecutiveWrong: number,
    masteryLevel: number,
    totalAttempts: number,
    recentAccuracy: number
  ): DifficultyLevel {
    const difficulties: DifficultyLevel[] = ['EASY', 'MEDIUM', 'HARD'];
    const currentIndex = difficulties.indexOf(currentDifficulty);

    console.log('\n🎯 Difficulty Analysis:', {
      current: currentDifficulty,
      consecutiveCorrect,
      consecutiveWrong,
      masteryLevel,
      totalAttempts,
      recentAccuracy,
    });

    // CRITICAL: Need minimum attempts before ANY change
    if (totalAttempts < 3) {
      console.log('⏳ Too few attempts (need 3+), staying at', currentDifficulty);
      return currentDifficulty;
    }

    // DECREASE difficulty (help struggling students)
    const shouldDecrease = 
      consecutiveWrong >= this.WRONG_STREAK_TO_DECREASE ||
      (masteryLevel < this.MASTERY_THRESHOLD_TO_DECREASE && totalAttempts >= 5) ||
      (recentAccuracy < 40 && totalAttempts >= this.MIN_ATTEMPTS_FOR_DECREASE);

    if (shouldDecrease && currentIndex > 0) {
      console.log(`📉 Decreasing: ${currentDifficulty} → ${difficulties[currentIndex - 1]}`);
      console.log(`   Reason: ${consecutiveWrong >= 2 ? '2+ wrong in a row' : masteryLevel < 50 ? 'Low mastery' : 'Low recent accuracy'}`);
      return difficulties[currentIndex - 1];
    }

    // INCREASE difficulty - VERY STRICT REQUIREMENTS
    const shouldAdvance = 
      consecutiveCorrect >= this.CORRECT_STREAK_TO_ADVANCE && // Need 3 in a row
      masteryLevel >= this.MASTERY_THRESHOLD_TO_ADVANCE && // Need 70% mastery
      recentAccuracy >= 70 && // Need 70% recent accuracy
      totalAttempts >= this.MIN_ATTEMPTS_FOR_ADVANCEMENT; // Need 5+ total attempts

    if (shouldAdvance && currentIndex < difficulties.length - 1) {
      console.log(`🎯 Advancing: ${currentDifficulty} → ${difficulties[currentIndex + 1]}`);
      console.log(`   Requirements met: ${consecutiveCorrect}/${this.CORRECT_STREAK_TO_ADVANCE} streak, ${masteryLevel}%/${this.MASTERY_THRESHOLD_TO_ADVANCE}% mastery, ${recentAccuracy}%/70% recent, ${totalAttempts}/${this.MIN_ATTEMPTS_FOR_ADVANCEMENT} attempts`);
      return difficulties[currentIndex + 1];
    } else if (currentIndex < difficulties.length - 1 && (consecutiveCorrect > 0 || masteryLevel > 50)) {
      // Log why we're NOT advancing (helpful for debugging)
      console.log(`❌ Not advancing yet:`);
      if (consecutiveCorrect < this.CORRECT_STREAK_TO_ADVANCE) {
        console.log(`   - Need ${this.CORRECT_STREAK_TO_ADVANCE - consecutiveCorrect} more correct in a row`);
      }
      if (masteryLevel < this.MASTERY_THRESHOLD_TO_ADVANCE) {
        console.log(`   - Need ${this.MASTERY_THRESHOLD_TO_ADVANCE - masteryLevel}% more mastery`);
      }
      if (recentAccuracy < 70) {
        console.log(`   - Recent accuracy too low (${recentAccuracy}%/70%)`);
      }
      if (totalAttempts < this.MIN_ATTEMPTS_FOR_ADVANCEMENT) {
        console.log(`   - Need ${this.MIN_ATTEMPTS_FOR_ADVANCEMENT - totalAttempts} more attempts`);
      }
    }

    // Fast track from EASY if exceptional (still strict)
    if (currentIndex === 0 && recentAccuracy >= 90 && totalAttempts >= 5 && consecutiveCorrect >= 4) {
      console.log(`⚡ Fast-tracking: EASY → MEDIUM (exceptional performance)`);
      return difficulties[1];
    }

     // Drop from HARD if struggling
  if (currentIndex === 2 && recentAccuracy < 55 && totalAttempts >= 8) {
    console.log(`📉 Dropping from HARD (sustained struggles)`);
    return difficulties[currentIndex - 1];
  }

    console.log(`✓ Staying at ${currentDifficulty}`);
    return currentDifficulty;
  }

  /**
   * Calculate mastery level
   */
  calculateMasteryLevel(
    currentMastery: number,
    correctAttempts: number,
    totalAttempts: number,
    isCorrect: boolean
  ): number {
    if (totalAttempts === 0) return 0;
    
    const overallAccuracy = (correctAttempts / totalAttempts) * 100;
    const recentImpact = isCorrect ? 100 : 0;
    const alpha = 0.25;
    const recentMastery = (alpha * recentImpact) + ((1 - alpha) * currentMastery);
    const blendedMastery = (overallAccuracy * 0.6) + (recentMastery * 0.4);
    
    return Math.min(100, Math.max(0, Math.round(blendedMastery)));
  }

  /**
   * Calculate recent accuracy (last 8 attempts)
   */
  private async calculateRecentAccuracy(userId: string, unitId: string): Promise<number> {
    const recentResponses = await prisma.questionResponse.findMany({
      where: {
        userId,
        question: { unitId },
      },
      orderBy: { createdAt: 'desc' },
      take: 8,
    });

    if (recentResponses.length === 0) return 0;

    const correctCount = recentResponses.filter(r => r.isCorrect).length;
    return Math.round((correctCount / recentResponses.length) * 100);
  }

  /**
   * Spaced Repetition: Calculate next review date
   */
  calculateNextReview(
    currentInterval: number,
    easeFactor: number,
    quality: number
  ): { nextInterval: number; nextEaseFactor: number; nextReviewDate: Date } {
    let newEaseFactor = easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
    newEaseFactor = Math.max(this.MIN_EASE_FACTOR, Math.min(newEaseFactor, this.MAX_EASE_FACTOR));

    let nextInterval: number;
    if (quality < 3) {
      nextInterval = 1;
    } else {
      if (currentInterval === 0) {
        nextInterval = 1;
      } else if (currentInterval === 1) {
        nextInterval = 6;
      } else {
        nextInterval = Math.round(currentInterval * newEaseFactor);
      }
    }

    nextInterval = Math.min(nextInterval, this.MAX_INTERVAL_DAYS);

    const nextReviewDate = new Date();
    nextReviewDate.setDate(nextReviewDate.getDate() + nextInterval);

    return {
      nextInterval,
      nextEaseFactor: newEaseFactor,
      nextReviewDate,
    };
  }

  /**
   * Convert answer correctness and time to SM-2 quality
   */
  private calculateQuality(isCorrect: boolean, timeSpent?: number, averageTime?: number): number {
    if (!isCorrect) return 0;

    let quality = 4;

    if (timeSpent && averageTime) {
      const timeRatio = timeSpent / averageTime;
      if (timeRatio < 0.5) {
        quality = 5;
      } else if (timeRatio < 0.8) {
        quality = 4;
      } else if (timeRatio > 1.5) {
        quality = 3;
      }
    }

    return quality;
  }

  /**
   * Track performance patterns
   */
  async analyzePerformancePatterns(userId: string, unitId: string): Promise<PerformancePattern> {
    const responses = await prisma.questionResponse.findMany({
      where: {
        userId,
        question: { unitId },
      },
      include: {
        question: {
          include: { topic: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    const topicPerformance: Record<string, { correct: number; total: number }> = {};
    const mistakeTypes: Record<string, number> = {};
    const times: number[] = [];

    for (const response of responses) {
      const topicName = response.question.topic?.name || 'General';
      
      if (!topicPerformance[topicName]) {
        topicPerformance[topicName] = { correct: 0, total: 0 };
      }
      
      topicPerformance[topicName].total++;
      if (response.isCorrect) {
        topicPerformance[topicName].correct++;
      } else {
        const difficulty = response.question.difficulty;
        mistakeTypes[difficulty] = (mistakeTypes[difficulty] || 0) + 1;
      }

      if (response.timeSpent) {
        times.push(response.timeSpent);
      }
    }

    const weakTopics: string[] = [];
    const strongTopics: string[] = [];

    for (const [topic, perf] of Object.entries(topicPerformance)) {
      const accuracy = (perf.correct / perf.total) * 100;
      if (accuracy < 60 && perf.total >= 3) {
        weakTopics.push(topic);
      } else if (accuracy >= 85 && perf.total >= 3) {
        strongTopics.push(topic);
      }
    }

    const avgTime = times.length > 0 
      ? times.reduce((a, b) => a + b, 0) / times.length 
      : 0;
    const fastestCorrect = times.length > 0 ? Math.min(...times) : 0;
    const slowestCorrect = times.length > 0 ? Math.max(...times) : 0;

    return {
      weakTopics,
      strongTopics,
      commonMistakes: mistakeTypes,
      timePatterns: {
        averageTimePerQuestion: Math.round(avgTime),
        fastestCorrect: Math.round(fastestCorrect),
        slowestCorrect: Math.round(slowestCorrect),
      },
    };
  }

  /**
   * Update user progress after answering a question
   */
async updateProgress(
  userId: string,
  questionId: string,
  isCorrect: boolean,
  timeSpent?: number
) {
  console.log('📊 Updating progress:', { userId, questionId, isCorrect });

  try {
    const question = await prisma.question.findUnique({
      where: { id: questionId },
      include: {
        unit: true,
        topic: true,
      },
    });

    if (!question) {
      console.error('❌ Question not found:', questionId);
      throw new AppError('Question not found', 404);
    }

    const unitId = question.unitId;
    // CRITICAL FIX: Always use unit-level tracking (topicId = undefined)
    const topicId = undefined; // <-- CHANGED FROM: question.topicId || undefined;

    console.log('📚 Question Details:');
    console.log('   - Unit ID:', unitId);
    console.log('   - Unit Name:', question.unit?.name);
    console.log('   - Tracking at UNIT level (no topic)');

    let progress = await this.findProgress(userId, unitId, topicId);

    if (!progress) {
      console.log('🆕 Creating new progress record (starting at EASY)...');
      progress = await prisma.progress.create({
        data: {
          userId,
          unitId,
          topicId: null, // <-- EXPLICITLY NULL for unit-level tracking
          currentDifficulty: 'EASY',
          totalAttempts: 0,
          correctAttempts: 0,
          consecutiveCorrect: 0,
          consecutiveWrong: 0,
          masteryLevel: 0,
          easeFactor: this.DEFAULT_EASE_FACTOR,
          interval: 0,
          totalTimeSpent: 0,
          averageTimePerQuestion: 0,
        },
      });
    }


      const newConsecutiveCorrect = isCorrect ? progress.consecutiveCorrect + 1 : 0;
      const newConsecutiveWrong = !isCorrect ? progress.consecutiveWrong + 1 : 0;
      const newTotalAttempts = progress.totalAttempts + 1;
      const newCorrectAttempts = progress.correctAttempts + (isCorrect ? 1 : 0);

      const newMasteryLevel = this.calculateMasteryLevel(
        progress.masteryLevel,
        newCorrectAttempts,
        newTotalAttempts,
        isCorrect
      );

      const recentAccuracy = await this.calculateRecentAccuracy(userId, unitId);

      console.log('📊 Stats:', {
        streak: isCorrect ? `${newConsecutiveCorrect} ✓` : `${newConsecutiveWrong} ✗`,
        mastery: `${newMasteryLevel}%`,
        recent: `${recentAccuracy}%`,
        overall: `${Math.round((newCorrectAttempts / newTotalAttempts) * 100)}%`,
      });

      const newDifficulty = this.getNextDifficulty(
        progress.currentDifficulty,
        newConsecutiveCorrect,
        newConsecutiveWrong,
        newMasteryLevel,
        newTotalAttempts,
        recentAccuracy
      );

      const quality = this.calculateQuality(isCorrect, timeSpent, progress.averageTimePerQuestion || undefined);
      const { nextInterval, nextEaseFactor, nextReviewDate } = this.calculateNextReview(
        progress.interval,
        progress.easeFactor,
        quality
      );

      const newTotalTimeSpent = progress.totalTimeSpent + (timeSpent || 0);
      const newAverageTime = newTotalAttempts > 0 
        ? newTotalTimeSpent / newTotalAttempts 
        : 0;

      const patterns = await this.analyzePerformancePatterns(userId, unitId);

      const updatedProgress = await prisma.progress.update({
        where: { id: progress.id },
        data: {
          currentDifficulty: newDifficulty,
          consecutiveCorrect: newConsecutiveCorrect,
          consecutiveWrong: newConsecutiveWrong,
          totalAttempts: newTotalAttempts,
          correctAttempts: newCorrectAttempts,
          masteryLevel: newMasteryLevel,
          lastPracticed: new Date(),
          totalTimeSpent: newTotalTimeSpent,
          averageTimePerQuestion: newAverageTime,
          easeFactor: nextEaseFactor,
          interval: nextInterval,
          nextReviewDate: nextReviewDate,
          strugglingTopics: patterns.weakTopics.length > 0 ? patterns.weakTopics : undefined,
          commonMistakes: Object.keys(patterns.commonMistakes).length > 0 ? patterns.commonMistakes : undefined,
        },
      });

      console.log('✅ Updated:', {
        difficulty: updatedProgress.currentDifficulty,
        mastery: `${updatedProgress.masteryLevel}%`,
      });
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

      return {
        currentDifficulty: updatedProgress.currentDifficulty,
        consecutiveCorrect: updatedProgress.consecutiveCorrect,
        consecutiveWrong: updatedProgress.consecutiveWrong,
        totalAttempts: updatedProgress.totalAttempts,
        correctAttempts: updatedProgress.correctAttempts,
        masteryLevel: updatedProgress.masteryLevel,
        nextReviewDate: updatedProgress.nextReviewDate || undefined,
        easeFactor: updatedProgress.easeFactor,
      };
    } catch (error) {
      console.error('❌ Error updating progress:', error);
      throw error;
    }
  }

  async getProgress(userId: string, unitId: string, topicId?: string): Promise<ProgressMetrics | null> {
    const progress = await this.findProgress(userId, unitId, topicId);

    if (!progress) return null;

    return {
      currentDifficulty: progress.currentDifficulty,
      consecutiveCorrect: progress.consecutiveCorrect,
      consecutiveWrong: progress.consecutiveWrong,
      totalAttempts: progress.totalAttempts,
      correctAttempts: progress.correctAttempts,
      masteryLevel: progress.masteryLevel,
      nextReviewDate: progress.nextReviewDate || undefined,
      easeFactor: progress.easeFactor,
    };
  }

  /**
   * Get recommended difficulty - returns student's current level
   */
 /**
 * Get recommended difficulty - returns student's current level
 */
async getRecommendedDifficulty(userId: string, unitId: string, topicId?: string): Promise<DifficultyLevel> {
  console.log('   → Checking progress for user:', userId);
  
  const progress = await this.getProgress(userId, unitId, topicId);
  
  // New students start at EASY
  if (!progress) {
    console.log('   → No progress found - New student');
    console.log('   → Returning: EASY');
    return 'EASY';
  }

  console.log('   → Progress found:');
  console.log('      - Current Difficulty:', progress.currentDifficulty);
  console.log('      - Total Attempts:', progress.totalAttempts);
  console.log('      - Mastery:', progress.masteryLevel + '%');
  console.log('      - Consecutive Correct:', progress.consecutiveCorrect);
  console.log('      - Consecutive Wrong:', progress.consecutiveWrong);

  // Check if review is needed (spaced repetition)
  if (progress.nextReviewDate && new Date() >= progress.nextReviewDate) {
    console.log('   → Review needed - dropping one level');
    const difficulties: DifficultyLevel[] = ['EASY', 'MEDIUM', 'HARD'];
    const currentIndex = difficulties.indexOf(progress.currentDifficulty);
    const reviewLevel = currentIndex > 0 ? difficulties[currentIndex - 1] : progress.currentDifficulty;
    console.log('   → Returning:', reviewLevel);
    return reviewLevel;
  }

  console.log('   → Returning:', progress.currentDifficulty);
  return progress.currentDifficulty;
}

  async getLearningInsights(userId: string, unitId: string) {
    const progress = await this.findProgress(userId, unitId);
    const patterns = await this.analyzePerformancePatterns(userId, unitId);

    if (!progress) {
      return {
        status: 'new',
        message: 'Start practicing to see your insights!',
      };
    }

    const accuracy = progress.totalAttempts > 0 
      ? Math.round((progress.correctAttempts / progress.totalAttempts) * 100)
      : 0;

    const insights = {
      masteryLevel: progress.masteryLevel,
      currentDifficulty: progress.currentDifficulty,
      accuracy,
      totalAttempts: progress.totalAttempts,
      averageTimePerQuestion: Math.round(progress.averageTimePerQuestion || 0),
      nextReviewDate: progress.nextReviewDate,
      weakTopics: patterns.weakTopics,
      strongTopics: patterns.strongTopics,
      recommendations: this.generateRecommendations(progress, patterns),
    };

    return insights;
  }

  private generateRecommendations(progress: any, patterns: PerformancePattern): string[] {
    const recommendations: string[] = [];

    if (progress.masteryLevel < 50) {
      recommendations.push('Focus on fundamentals - review basic concepts');
    } else if (progress.masteryLevel < 75) {
      recommendations.push('Good progress! Practice more to solidify understanding');
    } else if (progress.masteryLevel >= 85) {
      recommendations.push('Excellent mastery! Try more challenging problems');
    }

    if (patterns.weakTopics.length > 0) {
      recommendations.push(`Review these topics: ${patterns.weakTopics.join(', ')}`);
    }

    if (patterns.timePatterns.averageTimePerQuestion > 180) {
      recommendations.push('Try to improve response time with timed practice');
    }

    if (progress.consecutiveWrong >= 2) {
      recommendations.push('Take a short break and review explanations carefully');
    }

    return recommendations;
  }

  async getUnitsNeedingReview(userId: string): Promise<string[]> {
    const now = new Date();
    const progressRecords = await prisma.progress.findMany({
      where: {
        userId,
        nextReviewDate: {
          lte: now,
        },
      },
      include: {
        unit: true,
      },
    });

    return progressRecords.map(p => p.unit.name);
  }
}

export default new AdaptiveLearningService();