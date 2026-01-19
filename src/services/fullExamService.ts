import prisma from '../config/database.js';
import examBankService from './examBankService.js';
import { AppError } from '../middleware/errorHandler.js';
import { Prisma } from '@prisma/client';

export class FullExamService {
  /**
   * Start a new full exam attempt - OPTIMIZED
   * Uses parallel queries and bulk inserts for speed
   */
  async startExam(userId: string) {
    console.log('🎓 Starting full exam for user:', userId);
    const startTime = Date.now();

    try {
      // Run ALL independent queries in parallel
      const [previousAttempts, mcqQuestions, frqQuestions] = await Promise.all([
        // Get attempt count
        prisma.fullExamAttempt.count({ where: { userId } }),
        // Get random MCQ questions (uses cache from examBankService)
        examBankService.getRandomMCQForExam(),
        // Get random FRQ questions
        examBankService.getFRQForExam(),
      ]);

      console.log(`⏱️ Parallel queries completed in ${Date.now() - startTime}ms`);

      const attemptNumber = previousAttempts + 1;
      console.log(`📊 This is attempt #${attemptNumber} for user ${userId}`);
      console.log(`✅ Selected ${mcqQuestions.length} MCQ and ${frqQuestions.length} FRQ questions`);

      if (mcqQuestions.length === 0) {
        throw new AppError('No MCQ questions available. Please add questions to the question bank first.', 400);
      }

      // Create exam attempt and all responses in a SINGLE transaction with createMany
      const createStart = Date.now();

      const examAttempt = await prisma.$transaction(async (tx) => {
        // Create the exam attempt
        const attempt = await tx.fullExamAttempt.create({
          data: {
            userId,
            status: 'IN_PROGRESS',
            attemptNumber,
          },
        });

        // Bulk create MCQ responses (MUCH faster than Promise.all with individual creates)
        if (mcqQuestions.length > 0) {
          await tx.examAttemptMCQ.createMany({
            data: mcqQuestions.map((question, index) => ({
              examAttemptId: attempt.id,
              practiceQuestionId: question.id,
              orderIndex: index + 1,
            })),
          });
        }

        // Bulk create FRQ responses
        if (frqQuestions.length > 0) {
          await tx.examAttemptFRQ.createMany({
            data: frqQuestions.map((question, index) => ({
              examAttemptId: attempt.id,
              questionId: question.id,
              frqNumber: index + 1,
            })),
          });
        }

        return attempt;
      });

      console.log(`⏱️ Database inserts completed in ${Date.now() - createStart}ms`);
      console.log(`✅ Exam attempt created: ${examAttempt.id}`);
      console.log(`🚀 Total start time: ${Date.now() - startTime}ms`);

      // Return pre-formatted response (no additional queries needed)
      return {
        examAttemptId: examAttempt.id,
        attemptNumber,
        mcqQuestions: mcqQuestions.map((q, i) => ({
          id: q.id,
          questionText: q.questionText,
          options: q.options,
          unit: q.unit,
          topic: q.topic,
          orderIndex: i + 1,
        })),
        frqQuestions: frqQuestions.map((q, i) => ({
          id: q.id,
          questionText: q.questionText,
          promptText: q.promptText,
          starterCode: q.starterCode,
          frqParts: q.frqParts,
          maxPoints: q.maxPoints,
          unit: q.unit,
          frqNumber: i + 1,
        })),
        startedAt: examAttempt.startedAt,
      };
    } catch (error) {
      console.error('❌ Error starting exam:', error);
      throw error;
    }
  }

  /**
   * Get user's exam attempt history
   */
  async getUserExamHistory(userId: string) {
    const attempts = await prisma.fullExamAttempt.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        attemptNumber: true,
        status: true,
        mcqScore: true,
        mcqPercentage: true,
        predictedAPScore: true,
        percentageScore: true,
        createdAt: true,
        submittedAt: true,
        totalTimeSpent: true,
      },
    });

    return attempts;
  }

  /**
   * Submit MCQ answer - OPTIMIZED with findFirst then update
   */
  async submitMCQAnswer(
    examAttemptId: string,
    orderIndex: number,
    userAnswer: string,
    timeSpent?: number
  ) {
    // Use a single query with nested select for efficiency
    const mcqResponse = await prisma.examAttemptMCQ.findFirst({
      where: {
        examAttemptId,
        orderIndex,
      },
      select: {
        id: true,
        practiceQuestion: {
          select: { correctAnswer: true },
        },
        question: {
          select: { correctAnswer: true },
        },
      },
    });

    if (!mcqResponse) {
      throw new AppError('MCQ response not found', 404);
    }

    const correctAnswer = mcqResponse.practiceQuestion?.correctAnswer ||
                          mcqResponse.question?.correctAnswer;

    if (!correctAnswer) {
      throw new AppError('Question not found', 404);
    }

    const isCorrect = userAnswer.toUpperCase() === correctAnswer.toUpperCase();

    await prisma.examAttemptMCQ.update({
      where: { id: mcqResponse.id },
      data: {
        userAnswer: userAnswer.toUpperCase(),
        isCorrect,
        timeSpent,
      },
    });

    return {
      saved: true,
      orderIndex,
      timeSpent,
    };
  }

  /**
   * Submit FRQ answer
   */
  async submitFRQAnswer(
    examAttemptId: string,
    frqNumber: number,
    userCode: string,
    partResponses?: any[],
    timeSpent?: number
  ) {
    const frqResponse = await prisma.examAttemptFRQ.findFirst({
      where: {
        examAttemptId,
        frqNumber,
      },
      select: { id: true },
    });

    if (!frqResponse) {
      throw new AppError('FRQ response not found', 404);
    }

    await prisma.examAttemptFRQ.update({
      where: { id: frqResponse.id },
      data: {
        userCode,
        partResponses: partResponses ? (partResponses as Prisma.InputJsonValue) : Prisma.JsonNull,
        timeSpent,
      },
    });

    return {
      saved: true,
      frqNumber,
      timeSpent,
    };
  }

  /**
   * Get exam attempt with all responses - OPTIMIZED with selective fields
   */
  async getExamAttempt(examAttemptId: string) {
    const examAttempt = await prisma.fullExamAttempt.findUnique({
      where: { id: examAttemptId },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
        mcqResponses: {
          select: {
            id: true,
            orderIndex: true,
            userAnswer: true,
            isCorrect: true,
            flaggedForReview: true,
            timeSpent: true,
            practiceQuestion: {
              select: {
                id: true,
                questionText: true,
                options: true,
                correctAnswer: true,
                explanation: true,
                unitId: true,
                unit: {
                  select: { id: true, unitNumber: true, name: true },
                },
                topic: {
                  select: { id: true, name: true },
                },
              },
            },
            question: {
              select: {
                id: true,
                questionText: true,
                options: true,
                correctAnswer: true,
                explanation: true,
                unitId: true,
                unit: {
                  select: { id: true, unitNumber: true, name: true },
                },
              },
            },
          },
          orderBy: { orderIndex: 'asc' },
        },
        frqResponses: {
          select: {
            id: true,
            frqNumber: true,
            userCode: true,
            partResponses: true,
            timeSpent: true,
            question: {
              select: {
                id: true,
                questionText: true,
                promptText: true,
                starterCode: true,
                frqParts: true,
                maxPoints: true,
                explanation: true,
                unitId: true,
                unit: {
                  select: { id: true, unitNumber: true, name: true },
                },
              },
            },
          },
          orderBy: { frqNumber: 'asc' },
        },
      },
    });

    if (!examAttempt) {
      throw new AppError('Exam attempt not found', 404);
    }

    // Transform MCQ responses to have unified question field
    const transformedMcqResponses = examAttempt.mcqResponses.map((mcq: any) => {
      const questionData = mcq.practiceQuestion || mcq.question;
      return {
        ...mcq,
        question: questionData,
      };
    });

    return {
      ...examAttempt,
      mcqResponses: transformedMcqResponses,
    };
  }

  /**
   * Flag MCQ question for review
   */
  async flagMCQForReview(examAttemptId: string, orderIndex: number, flagged: boolean) {
    const result = await prisma.examAttemptMCQ.updateMany({
      where: {
        examAttemptId,
        orderIndex,
      },
      data: {
        flaggedForReview: flagged,
      },
    });

    if (result.count === 0) {
      throw new AppError('MCQ response not found', 404);
    }

    return { success: true };
  }

  /**
   * Submit entire exam - OPTIMIZED with parallel calculations
   */
  async submitExam(examAttemptId: string, totalTimeSpent: number) {
    console.log('📝 Submitting exam:', examAttemptId);
    const startTime = Date.now();

    // Get only what we need for grading
    const examAttempt = await prisma.fullExamAttempt.findUnique({
      where: { id: examAttemptId },
      select: {
        id: true,
        mcqResponses: {
          select: {
            isCorrect: true,
            practiceQuestion: {
              select: {
                unitId: true,
                unit: { select: { name: true, unitNumber: true } },
              },
            },
            question: {
              select: {
                unitId: true,
                unit: { select: { name: true, unitNumber: true } },
              },
            },
          },
        },
      },
    });

    if (!examAttempt) {
      throw new AppError('Exam attempt not found', 404);
    }

    // Transform for consistent access
    const mcqResponses = examAttempt.mcqResponses.map((mcq: any) => ({
      isCorrect: mcq.isCorrect,
      question: mcq.practiceQuestion || mcq.question,
    }));

    // Calculate MCQ score
    const mcqCorrect = mcqResponses.filter((r: any) => r.isCorrect).length;
    const mcqTotal = mcqResponses.length;
    const mcqPercentage = mcqTotal > 0 ? (mcqCorrect / mcqTotal) * 100 : 0;

    console.log(`📊 MCQ Score: ${mcqCorrect}/${mcqTotal} (${mcqPercentage.toFixed(1)}%)`);

    // Calculate unit breakdown
    const unitBreakdown = this.generateUnitBreakdownFast(mcqResponses);

    // Generate strengths and weaknesses
    const { strengths, weaknesses } = this.generateStrengthsAndWeaknessesFast(unitBreakdown);

    // Generate recommendations
    const recommendations = this.generateRecommendations(mcqCorrect, mcqTotal, strengths, weaknesses);

    // Calculate predicted AP score
    const predictedAPScore = this.calculateAPScoreFromMCQ(mcqPercentage);

    // Update exam in single query
    await prisma.fullExamAttempt.update({
      where: { id: examAttemptId },
      data: {
        submittedAt: new Date(),
        status: 'GRADED',
        totalTimeSpent,
        mcqScore: mcqCorrect,
        mcqPercentage,
        predictedAPScore,
        unitBreakdown: unitBreakdown as Prisma.InputJsonValue,
        strengths,
        weaknesses,
        recommendations: recommendations as Prisma.InputJsonValue,
      },
    });

    console.log(`✅ Exam graded in ${Date.now() - startTime}ms`);

    return {
      examAttemptId,
      mcqScore: mcqCorrect,
      mcqTotal,
      mcqPercentage,
      predictedAPScore,
      status: 'GRADED',
      message: 'Exam submitted successfully. Review your FRQ solutions below.',
    };
  }

  /**
   * Generate unit breakdown - OPTIMIZED version
   */
  private generateUnitBreakdownFast(mcqResponses: any[]) {
    const unitStats: Record<string, any> = {};

    for (const mcqResponse of mcqResponses) {
      const question = mcqResponse.question;
      if (!question) continue;

      const unitId = question.unitId;
      
      if (!unitStats[unitId]) {
        unitStats[unitId] = {
          unitId,
          unitName: question.unit?.name || 'Unknown Unit',
          unitNumber: question.unit?.unitNumber || 0,
          mcqTotal: 0,
          mcqCorrect: 0,
          mcqPercentage: 0,
        };
      }

      unitStats[unitId].mcqTotal++;
      if (mcqResponse.isCorrect) {
        unitStats[unitId].mcqCorrect++;
      }
    }

    // Calculate percentages
    for (const unitId in unitStats) {
      const unit = unitStats[unitId];
      unit.mcqPercentage = unit.mcqTotal > 0 ? (unit.mcqCorrect / unit.mcqTotal) * 100 : 0;
    }

    return unitStats;
  }

  /**
   * Generate strengths and weaknesses - OPTIMIZED version
   */
  private generateStrengthsAndWeaknessesFast(unitBreakdown: Record<string, any>) {
    const strengths: string[] = [];
    const weaknesses: string[] = [];

    const sortedUnits = Object.values(unitBreakdown).sort(
      (a: any, b: any) => b.mcqPercentage - a.mcqPercentage
    );

    // Top performing units are strengths
    for (const unit of sortedUnits) {
      if (strengths.length >= 3) break;
      if (unit.mcqPercentage >= 70 && unit.mcqTotal >= 2) {
        strengths.push(`Strong in ${unit.unitName} (${unit.mcqPercentage.toFixed(0)}%)`);
      }
    }

    // Bottom performing units are weaknesses
    for (let i = sortedUnits.length - 1; i >= 0 && weaknesses.length < 3; i--) {
      const unit = sortedUnits[i];
      if (unit.mcqPercentage < 60 && unit.mcqTotal >= 2) {
        weaknesses.push(`Needs work on ${unit.unitName} (${unit.mcqPercentage.toFixed(0)}%)`);
      }
    }

    if (strengths.length === 0) {
      strengths.push('Completed all exam sections');
    }

    if (weaknesses.length === 0) {
      weaknesses.push('Keep practicing to maintain performance');
    }

    return { strengths, weaknesses };
  }

  /**
   * Generate unit breakdown (legacy - for compatibility)
   */
  generateUnitBreakdown(examAttempt: any) {
    return this.generateUnitBreakdownFast(examAttempt.mcqResponses);
  }

  /**
   * Generate strengths and weaknesses (legacy - for compatibility)
   */
  generateStrengthsAndWeaknesses(examAttempt: any, unitBreakdown: any) {
    return this.generateStrengthsAndWeaknessesFast(unitBreakdown);
  }

  /**
   * Generate personalized recommendations
   */
  generateRecommendations(
    mcqScore: number,
    mcqTotal: number,
    strengths: string[],
    weaknesses: string[]
  ) {
    const mcqPercentage = mcqTotal > 0 ? (mcqScore / mcqTotal) * 100 : 0;

    const recommendations: any = {
      overall: '',
      studyFocus: [],
      nextSteps: [],
    };

    if (mcqPercentage >= 85) {
      recommendations.overall = 'Excellent performance! You\'re well-prepared for the AP exam.';
    } else if (mcqPercentage >= 70) {
      recommendations.overall = 'Strong foundation. Focus on weak areas to push into the 5 range.';
    } else if (mcqPercentage >= 60) {
      recommendations.overall = 'Good progress. More practice will help solidify your understanding.';
    } else if (mcqPercentage >= 50) {
      recommendations.overall = 'You\'re getting there. Focus on fundamentals and practice consistently.';
    } else {
      recommendations.overall = 'Focus on core concepts. Consider reviewing unit content before more practice.';
    }

    recommendations.studyFocus = weaknesses.map((w: string) =>
      w.replace('Needs work on ', 'Review: ')
    );

    recommendations.nextSteps = [
      'Review incorrect MCQ answers and explanations',
      'Practice FRQ questions separately',
      'Take another full exam after studying weak areas',
      'Schedule a tutoring session for challenging topics',
    ];

    return recommendations;
  }

  /**
   * Calculate estimated AP score from MCQ percentage
   */
  calculateAPScoreFromMCQ(mcqPercentage: number): number {
    const estimatedTotal = (mcqPercentage * 0.5) + (60 * 0.5);

    if (estimatedTotal >= 70) return 5;
    if (estimatedTotal >= 58) return 4;
    if (estimatedTotal >= 45) return 3;
    if (estimatedTotal >= 33) return 2;
    return 1;
  }

  /**
   * Calculate estimated AP score range based on MCQ only
   */
  calculateEstimatedAPRange(mcqScore: number, mcqTotal: number = 42) {
    const mcqPercentage = mcqTotal > 0 ? (mcqScore / mcqTotal) * 100 : 0;
    const mcqWeighted = mcqPercentage * 0.5;

    const scenarios = [
      { frqPercent: 90, label: 'Excellent FRQ (90%)', weightedScore: mcqWeighted + (90 * 0.5) },
      { frqPercent: 75, label: 'Good FRQ (75%)', weightedScore: mcqWeighted + (75 * 0.5) },
      { frqPercent: 60, label: 'Average FRQ (60%)', weightedScore: mcqWeighted + (60 * 0.5) },
      { frqPercent: 45, label: 'Below Average FRQ (45%)', weightedScore: mcqWeighted + (45 * 0.5) },
      { frqPercent: 30, label: 'Weak FRQ (30%)', weightedScore: mcqWeighted + (30 * 0.5) },
    ];

    return scenarios.map(s => ({
      ...s,
      apScore: this.calculateAPScoreFromPercentage(s.weightedScore),
    }));
  }

  /**
   * Calculate AP Score from percentage
   */
  calculateAPScoreFromPercentage(percentage: number): number {
    if (percentage >= 70) return 5;
    if (percentage >= 58) return 4;
    if (percentage >= 45) return 3;
    if (percentage >= 33) return 2;
    return 1;
  }

  /**
   * Get exam results with full details
   */
  async getExamResults(examAttemptId: string) {
    const examAttempt = await this.getExamAttempt(examAttemptId);

    if (examAttempt.status === 'IN_PROGRESS') {
      throw new AppError('Exam has not been submitted yet', 400);
    }

    const apScoreRange = this.calculateEstimatedAPRange(
      examAttempt.mcqScore || 0,
      examAttempt.mcqResponses.length
    );

    return {
      ...examAttempt,
      apScoreRange,
    };
  }

  /**
   * ADMIN: Get all exam attempts with filters - OPTIMIZED
   */
  async getAllExamAttempts(filters: {
    userId?: string;
    status?: string;
    limit?: number;
    offset?: number;
  }) {
    const where: any = {};
    if (filters.userId) where.userId = filters.userId;
    if (filters.status) where.status = filters.status;

    const [attempts, total] = await Promise.all([
      prisma.fullExamAttempt.findMany({
        where,
        select: {
          id: true,
          attemptNumber: true,
          status: true,
          mcqScore: true,
          mcqPercentage: true,
          predictedAPScore: true,
          totalTimeSpent: true,
          createdAt: true,
          submittedAt: true,
          user: {
            select: {
              id: true,
              email: true,
              name: true,
            },
          },
          _count: {
            select: {
              mcqResponses: true,
              frqResponses: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: filters.limit || 50,
        skip: filters.offset || 0,
      }),
      prisma.fullExamAttempt.count({ where }),
    ]);

    return { attempts, total };
  }

  /**
   * ADMIN: Get exam statistics - OPTIMIZED with parallel queries
   */
  async getExamStatistics() {
    const [
      totalAttempts,
      completedAttempts,
      inProgressAttempts,
      averageScore,
      scoreDistribution,
    ] = await Promise.all([
      prisma.fullExamAttempt.count(),
      prisma.fullExamAttempt.count({ where: { status: 'GRADED' } }),
      prisma.fullExamAttempt.count({ where: { status: 'IN_PROGRESS' } }),
      prisma.fullExamAttempt.aggregate({
        where: { status: 'GRADED' },
        _avg: { mcqPercentage: true },
      }),
      prisma.fullExamAttempt.groupBy({
        by: ['predictedAPScore'],
        where: {
          status: 'GRADED',
          predictedAPScore: { not: null },
        },
        _count: true,
      }),
    ]);

    return {
      totalAttempts,
      completedAttempts,
      inProgressAttempts,
      averageMCQPercentage: averageScore._avg.mcqPercentage || 0,
      scoreDistribution: scoreDistribution.reduce((acc: any, item) => {
        acc[`score${item.predictedAPScore}`] = item._count;
        return acc;
      }, {}),
    };
  }

  /**
   * ADMIN: Get all users who have taken exams
   */
  async getExamUsers() {
    const users = await prisma.user.findMany({
      where: {
        fullExamAttempts: {
          some: {},
        },
      },
      select: {
        id: true,
        email: true,
        name: true,
        _count: {
          select: {
            fullExamAttempts: true,
          },
        },
        fullExamAttempts: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            mcqPercentage: true,
            predictedAPScore: true,
            createdAt: true,
          },
        },
      },
      orderBy: {
        fullExamAttempts: {
          _count: 'desc',
        },
      },
    });

    return users.map(user => ({
      id: user.id,
      email: user.email,
      name: user.name,
      attemptCount: user._count.fullExamAttempts,
      lastAttempt: user.fullExamAttempts[0] || null,
    }));
  }

  /**
   * ADMIN: Get student's exam history
   */
  async getStudentExamHistory(userId: string) {
    const [user, attempts] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          name: true,
        },
      }),
      prisma.fullExamAttempt.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          attemptNumber: true,
          status: true,
          mcqScore: true,
          mcqPercentage: true,
          predictedAPScore: true,
          totalTimeSpent: true,
          createdAt: true,
          submittedAt: true,
        },
      }),
    ]);

    if (!user) {
      throw new AppError('User not found', 404);
    }

    const completedAttempts = attempts.filter(a => a.status === 'GRADED');

    return {
      user,
      attempts,
      summary: {
        totalAttempts: attempts.length,
        completedAttempts: completedAttempts.length,
        bestScore: completedAttempts.length > 0 
          ? Math.max(...completedAttempts.map(a => a.mcqPercentage || 0))
          : 0,
        averageScore: completedAttempts.length > 0
          ? completedAttempts.reduce((sum, a) => sum + (a.mcqPercentage || 0), 0) / completedAttempts.length
          : 0,
      },
    };
  }

  /**
   * ADMIN: Get detailed exam attempt
   */
  async getExamAttemptAdmin(examAttemptId: string) {
    return this.getExamAttempt(examAttemptId);
  }
}

export default new FullExamService();