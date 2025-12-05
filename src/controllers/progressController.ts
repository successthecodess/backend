import { Request, Response, NextFunction } from 'express';
import prisma from '../config/database.js';
import adaptiveLearningService from '../services/adaptiveLearningService.js';
import { AppError } from '../middleware/errorHandler.js';

export const progressController = {
  /**
   * Get user progress for a specific unit
   */
  async getUserProgress(req: Request, res: Response, next: NextFunction) {
    try {
      const { userId, unitId } = req.params;
      const { topicId } = req.query;

      const progress = await adaptiveLearningService.getProgress(
        userId,
        unitId,
        topicId as string | undefined
      );

      if (!progress) {
        return res.json({
          success: true,
          data: { progress: null },
          message: 'No progress found for this unit',
        });
      }

      res.json({
        success: true,
        data: { progress },
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * Get learning insights for a user in a specific unit
   */
  async getLearningInsights(req: Request, res: Response, next: NextFunction) {
    try {
      const { userId, unitId } = req.params;

      const insights = await adaptiveLearningService.getLearningInsights(userId, unitId);

      res.json({
        success: true,
        data: { insights },
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * Get dashboard overview with all user stats
   */
  async getDashboardOverview(req: Request, res: Response, next: NextFunction) {
    try {
      const { userId } = req.params;

      // Get all progress records for user
      const allProgress = await prisma.progress.findMany({
        where: { userId },
        include: {
          unit: {
            select: {
              id: true,
              unitNumber: true,
              name: true,
              color: true,
            },
          },
        },
        orderBy: { updatedAt: 'desc' },
      });

      // Get total questions attempted across all units
      const totalQuestions = await prisma.questionResponse.count({
        where: { userId },
      });

      // Get correct answers
      const correctAnswers = await prisma.questionResponse.count({
        where: { userId, isCorrect: true },
      });

      // Calculate overall accuracy
      const overallAccuracy = totalQuestions > 0 
        ? Math.round((correctAnswers / totalQuestions) * 100) 
        : 0;

      // Get total study time (in seconds)
      const totalTimeData = await prisma.questionResponse.aggregate({
        where: { userId },
        _sum: { timeSpent: true },
      });
      const totalStudyTime = totalTimeData._sum.timeSpent || 0;

      // Get units mastered (>= 80% mastery)
      const unitsMastered = allProgress.filter(p => p.masteryLevel >= 80).length;

      // Get recent activity (last 7 days)
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const recentActivity = await prisma.questionResponse.count({
        where: {
          userId,
          createdAt: { gte: sevenDaysAgo },
        },
      });

      res.json({
        success: true,
        data: {
          overview: {
            totalQuestions,
            correctAnswers,
            overallAccuracy,
            totalStudyTime: Math.round(totalStudyTime / 60), // Convert to minutes
            unitsMastered,
            recentActivity,
          },
          unitProgress: allProgress.map(p => ({
            unitId: p.unitId,
            unitNumber: p.unit.unitNumber,
            unitName: p.unit.name,
            unitColor: p.unit.color,
            masteryLevel: p.masteryLevel,
            currentDifficulty: p.currentDifficulty,
            totalAttempts: p.totalAttempts,
            correctAttempts: p.correctAttempts,
            accuracy: p.totalAttempts > 0 
              ? Math.round((p.correctAttempts / p.totalAttempts) * 100) 
              : 0,
            lastPracticed: p.lastPracticed,
          })),
        },
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * Get performance history over time
   */
  async getPerformanceHistory(req: Request, res: Response, next: NextFunction) {
    try {
      const { userId } = req.params;
      const { days = '30', unitId } = req.query;

      const daysAgo = new Date();
      daysAgo.setDate(daysAgo.getDate() - parseInt(days as string));

      // Build where clause
      const whereClause: any = {
        userId,
        createdAt: { gte: daysAgo },
      };

      if (unitId) {
        whereClause.question = { unitId: unitId as string };
      }

      // Get responses grouped by day
      const responses = await prisma.questionResponse.findMany({
        where: whereClause,
        include: {
          question: {
            select: {
              unitId: true,
              difficulty: true,
            },
          },
        },
        orderBy: { createdAt: 'asc' },
      });

      // Group by date
      const dailyStats: Record<string, any> = {};

      responses.forEach(response => {
        const date = response.createdAt.toISOString().split('T')[0];
        
        if (!dailyStats[date]) {
          dailyStats[date] = {
            date,
            total: 0,
            correct: 0,
            timeSpent: 0,
          };
        }

        dailyStats[date].total++;
        if (response.isCorrect) dailyStats[date].correct++;
        dailyStats[date].timeSpent += response.timeSpent || 0;
      });

      // Convert to array and calculate accuracy
      const performanceHistory = Object.values(dailyStats).map((day: any) => ({
        date: day.date,
        questionsAttempted: day.total,
        correctAnswers: day.correct,
        accuracy: Math.round((day.correct / day.total) * 100),
        averageTime: Math.round(day.timeSpent / day.total),
      }));

      res.json({
        success: true,
        data: { performanceHistory },
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * Get user streaks (current and longest)
   */
  async getStreaks(req: Request, res: Response, next: NextFunction) {
    try {
      const { userId } = req.params;

      // Get all study sessions
      const sessions = await prisma.studySession.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        select: {
          createdAt: true,
          totalQuestions: true,
        },
      });

      if (sessions.length === 0) {
        return res.json({
          success: true,
          data: {
            currentStreak: 0,
            longestStreak: 0,
            totalDaysActive: 0,
            lastActiveDate: null,
          },
        });
      }

      // Get unique dates
      const uniqueDates = new Set(
        sessions.map(s => s.createdAt.toISOString().split('T')[0])
      );

      const sortedDates = Array.from(uniqueDates).sort().reverse();
      
      // Calculate current streak
      let currentStreak = 0;
      const today = new Date().toISOString().split('T')[0];
      const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

      if (sortedDates[0] === today || sortedDates[0] === yesterday) {
        currentStreak = 1;
        let checkDate = new Date(sortedDates[0]);

        for (let i = 1; i < sortedDates.length; i++) {
          checkDate.setDate(checkDate.getDate() - 1);
          const expectedDate = checkDate.toISOString().split('T')[0];
          
          if (sortedDates[i] === expectedDate) {
            currentStreak++;
          } else {
            break;
          }
        }
      }

      // Calculate longest streak
      let longestStreak = 0;
      let tempStreak = 1;

      for (let i = 0; i < sortedDates.length - 1; i++) {
        const currentDate = new Date(sortedDates[i]);
        const nextDate = new Date(sortedDates[i + 1]);
        const dayDiff = Math.floor(
          (currentDate.getTime() - nextDate.getTime()) / 86400000
        );

        if (dayDiff === 1) {
          tempStreak++;
          longestStreak = Math.max(longestStreak, tempStreak);
        } else {
          tempStreak = 1;
        }
      }
      longestStreak = Math.max(longestStreak, tempStreak);

      res.json({
        success: true,
        data: {
          currentStreak,
          longestStreak,
          totalDaysActive: uniqueDates.size,
          lastActiveDate: sortedDates[0],
        },
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * Get user achievements based on real accomplishments
   */
  async getAchievements(req: Request, res: Response, next: NextFunction) {
    try {
      const { userId } = req.params;

      // Get user stats
      const totalQuestions = await prisma.questionResponse.count({
        where: { userId },
      });

      const correctAnswers = await prisma.questionResponse.count({
        where: { userId, isCorrect: true },
      });

      const progress = await prisma.progress.findMany({
        where: { userId },
      });

      const unitsMastered = progress.filter(p => p.masteryLevel >= 80).length;
      const unitsStarted = progress.length;

      // Get streak data
      const sessions = await prisma.studySession.findMany({
        where: { userId },
        select: { createdAt: true },
      });

      const uniqueDates = new Set(
        sessions.map(s => s.createdAt.toISOString().split('T')[0])
      );

      const achievements = [];

      // Question milestones
      if (totalQuestions >= 10) {
        achievements.push({
          id: 'q10',
          name: 'Getting Started',
          description: 'Answered 10 questions',
          icon: '🎯',
          unlocked: true,
        });
      }
      if (totalQuestions >= 50) {
        achievements.push({
          id: 'q50',
          name: 'Dedicated Learner',
          description: 'Answered 50 questions',
          icon: '📚',
          unlocked: true,
        });
      }
      if (totalQuestions >= 100) {
        achievements.push({
          id: 'q100',
          name: 'Century Mark',
          description: 'Answered 100 questions',
          icon: '💯',
          unlocked: true,
        });
      }
      if (totalQuestions >= 500) {
        achievements.push({
          id: 'q500',
          name: 'Master Student',
          description: 'Answered 500 questions',
          icon: '🏆',
          unlocked: true,
        });
      }

      // Accuracy achievements
      const accuracy = totalQuestions > 0 ? (correctAnswers / totalQuestions) * 100 : 0;
      if (accuracy >= 70 && totalQuestions >= 20) {
        achievements.push({
          id: 'acc70',
          name: 'Sharp Mind',
          description: '70%+ accuracy with 20+ questions',
          icon: '🎓',
          unlocked: true,
        });
      }
      if (accuracy >= 85 && totalQuestions >= 50) {
        achievements.push({
          id: 'acc85',
          name: 'Excellent Student',
          description: '85%+ accuracy with 50+ questions',
          icon: '⭐',
          unlocked: true,
        });
      }
      if (accuracy >= 95 && totalQuestions >= 100) {
        achievements.push({
          id: 'acc95',
          name: 'Nearly Perfect',
          description: '95%+ accuracy with 100+ questions',
          icon: '💎',
          unlocked: true,
        });
      }

      // Unit mastery achievements
      if (unitsMastered >= 1) {
        achievements.push({
          id: 'u1',
          name: 'First Mastery',
          description: 'Mastered your first unit (80%+)',
          icon: '🥉',
          unlocked: true,
        });
      }
      if (unitsMastered >= 3) {
        achievements.push({
          id: 'u3',
          name: 'Triple Threat',
          description: 'Mastered 3 units',
          icon: '🥈',
          unlocked: true,
        });
      }
      if (unitsMastered >= 5) {
        achievements.push({
          id: 'u5',
          name: 'Unit Champion',
          description: 'Mastered 5 units',
          icon: '🥇',
          unlocked: true,
        });
      }
      if (unitsMastered >= 10) {
        achievements.push({
          id: 'u10',
          name: 'Complete Mastery',
          description: 'Mastered all 10 units',
          icon: '👑',
          unlocked: true,
        });
      }

      // Streak achievements
      if (uniqueDates.size >= 3) {
        achievements.push({
          id: 's3',
          name: 'Getting Consistent',
          description: 'Practiced for 3 different days',
          icon: '🔥',
          unlocked: true,
        });
      }
      if (uniqueDates.size >= 7) {
        achievements.push({
          id: 's7',
          name: 'Week Warrior',
          description: 'Practiced for 7 different days',
          icon: '💪',
          unlocked: true,
        });
      }
      if (uniqueDates.size >= 30) {
        achievements.push({
          id: 's30',
          name: 'Month Master',
          description: 'Practiced for 30 different days',
          icon: '🌟',
          unlocked: true,
        });
      }

      res.json({
        success: true,
        data: {
          achievements,
          stats: {
            totalQuestions,
            correctAnswers,
            accuracy: Math.round(accuracy),
            unitsMastered,
            unitsStarted,
            daysActive: uniqueDates.size,
          },
        },
      });
    } catch (error) {
      next(error);
    }
  },
};