import prisma from '../config/database.js';
import examBankService from './examBankService.js';
import { AppError } from '../middleware/errorHandler.js';
import { Prisma } from '@prisma/client';

export class FullExamService {
  /**
   * Start a new full exam attempt
   */
  async startExam(userId: string) {
    console.log('🎓 Starting full exam for user:', userId);

    try {
      // Get 42 MCQ questions
      const mcqQuestions = await examBankService.getRandomMCQForExam();
      console.log(`✅ Selected ${mcqQuestions.length} MCQ questions`);

      // Get 4 FRQ questions
      const frqQuestions = await examBankService.getFRQForExam();
      console.log(`✅ Selected ${frqQuestions.length} FRQ questions`);

      // Create exam attempt
      const examAttempt = await prisma.fullExamAttempt.create({
        data: {
          userId,
          status: 'IN_PROGRESS',
        },
      });

      // Create MCQ responses (empty initially)
      await Promise.all(
        mcqQuestions.map((question, index) =>
          prisma.examAttemptMCQ.create({
            data: {
              examAttemptId: examAttempt.id,
              questionId: question.id,
              orderIndex: index + 1,
            },
          })
        )
      );

      // Create FRQ responses (empty initially)
      await Promise.all(
        frqQuestions.map((question, index) =>
          prisma.examAttemptFRQ.create({
            data: {
              examAttemptId: examAttempt.id,
              questionId: question.id,
              frqNumber: index + 1,
            },
          })
        )
      );

      console.log('✅ Exam attempt created:', examAttempt.id);

      return {
        examAttemptId: examAttempt.id,
        mcqQuestions: mcqQuestions.map((q, i) => ({
          ...q,
          orderIndex: i + 1,
          options: q.options,
          // Don't send correct answer to frontend
          correctAnswer: undefined,
        })),
        frqQuestions: frqQuestions.map((q, i) => ({
          ...q,
          frqNumber: i + 1,
          // Don't send sample solution to frontend yet
          sampleSolution: undefined,
        })),
        startedAt: examAttempt.startedAt,
      };
    } catch (error) {
      console.error('❌ Error starting exam:', error);
      throw error;
    }
  }

  /**
   * Submit MCQ answer
   */
  async submitMCQAnswer(
    examAttemptId: string,
    orderIndex: number,
    userAnswer: string,
    timeSpent?: number
  ) {
    const mcqResponse = await prisma.examAttemptMCQ.findFirst({
      where: {
        examAttemptId,
        orderIndex,
      },
      include: {
        question: true,
      },
    });

    if (!mcqResponse) {
      throw new AppError('MCQ response not found', 404);
    }

    const isCorrect = userAnswer.toUpperCase() === mcqResponse.question.correctAnswer?.toUpperCase();

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
   * Get exam attempt with all responses
   */
  async getExamAttempt(examAttemptId: string) {
    const examAttempt = await prisma.fullExamAttempt.findUnique({
      where: { id: examAttemptId },
      include: {
        mcqResponses: {
          include: {
            question: {
              include: {
                unit: true,
              },
            },
          },
          orderBy: { orderIndex: 'asc' },
        },
        frqResponses: {
          include: {
            question: true,
          },
          orderBy: { frqNumber: 'asc' },
        },
      },
    });

    if (!examAttempt) {
      throw new AppError('Exam attempt not found', 404);
    }

    return examAttempt;
  }

  /**
   * Flag MCQ question for review
   */
  async flagMCQForReview(examAttemptId: string, orderIndex: number, flagged: boolean) {
    const mcqResponse = await prisma.examAttemptMCQ.findFirst({
      where: {
        examAttemptId,
        orderIndex,
      },
    });

    if (!mcqResponse) {
      throw new AppError('MCQ response not found', 404);
    }

    await prisma.examAttemptMCQ.update({
      where: { id: mcqResponse.id },
      data: {
        flaggedForReview: flagged,
      },
    });

    return { success: true };
  }

  /**
   * Submit entire exam - instant results (MCQ only grading)
   */
  async submitExam(examAttemptId: string, totalTimeSpent: number) {
    console.log('📝 Submitting exam:', examAttemptId);

    const examAttempt = await this.getExamAttempt(examAttemptId);

    // Calculate MCQ score
    const mcqCorrect = examAttempt.mcqResponses.filter(r => r.isCorrect).length;
    const mcqScore = mcqCorrect;
    const mcqPercentage = (mcqCorrect / 42) * 100;

    console.log(`📊 MCQ Score: ${mcqCorrect}/42 (${mcqPercentage.toFixed(1)}%)`);

    // Calculate unit breakdown
    const unitBreakdown = await this.generateUnitBreakdown(examAttempt);

    // Generate strengths and weaknesses based on MCQ only
    const { strengths, weaknesses } = this.generateStrengthsAndWeaknesses(
      examAttempt,
      unitBreakdown
    );

    // Generate recommendations
    const recommendations = this.generateRecommendations(
      mcqScore,
      strengths,
      weaknesses
    );

    // Calculate weighted scores based on MCQ only
    const mcqWeighted = (mcqScore / 42) * 55;
    
    // No FRQ grading - mark as completed immediately
    await prisma.fullExamAttempt.update({
      where: { id: examAttemptId },
      data: {
        submittedAt: new Date(),
        status: 'GRADED',
        totalTimeSpent,
        mcqScore,
        mcqPercentage,
        unitBreakdown: unitBreakdown as Prisma.InputJsonValue,
        strengths,
        weaknesses,
        recommendations: recommendations as Prisma.InputJsonValue,
      },
    });

    console.log('✅ Exam submitted and graded (MCQ only)');

    return {
      examAttemptId,
      mcqScore,
      mcqPercentage,
      status: 'GRADED',
      message: 'Exam submitted successfully. Review your FRQ solutions below.',
    };
  }

  /**
   * Generate unit breakdown
   */
  async generateUnitBreakdown(examAttempt: any) {
    const unitStats: any = {};

    for (const mcqResponse of examAttempt.mcqResponses) {
      const unitId = mcqResponse.question.unitId;
      const unitName = mcqResponse.question.unit?.name || 'Unknown Unit';

      if (!unitStats[unitId]) {
        unitStats[unitId] = {
          unitName,
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
      unit.mcqPercentage = (unit.mcqCorrect / unit.mcqTotal) * 100;
    }

    return unitStats;
  }

  /**
   * Generate strengths and weaknesses
   */
  generateStrengthsAndWeaknesses(examAttempt: any, unitBreakdown: any) {
    const strengths: string[] = [];
    const weaknesses: string[] = [];

    // Analyze MCQ performance by unit
    const sortedUnits = Object.entries(unitBreakdown).sort(
      ([, a]: any, [, b]: any) => b.mcqPercentage - a.mcqPercentage
    );

    // Top 2 units are strengths
    for (let i = 0; i < Math.min(2, sortedUnits.length); i++) {
      const [, unit]: any = sortedUnits[i];
      if (unit.mcqPercentage >= 70) {
        strengths.push(
          `Strong performance in ${unit.unitName} (${unit.mcqPercentage.toFixed(0)}% correct)`
        );
      }
    }

    // Bottom 2 units are weaknesses
    for (let i = Math.max(0, sortedUnits.length - 2); i < sortedUnits.length; i++) {
      const [, unit]: any = sortedUnits[i];
      if (unit.mcqPercentage < 70) {
        weaknesses.push(
          `Needs improvement in ${unit.unitName} (${unit.mcqPercentage.toFixed(0)}% correct)`
        );
      }
    }

    // Add note about FRQ review
    if (strengths.length === 0) {
      strengths.push('Completed all exam sections');
    }

    return { strengths, weaknesses };
  }

  /**
   * Generate personalized recommendations
   */
  generateRecommendations(
    mcqScore: number,
    strengths: string[],
    weaknesses: string[]
  ) {
    const mcqPercentage = (mcqScore / 42) * 100;

    const recommendations: any = {
      overall: '',
      studyFocus: [],
      nextSteps: [],
    };

    // Overall assessment based on MCQ only
    if (mcqPercentage >= 85) {
      recommendations.overall = 'Excellent MCQ performance! Review your FRQ solutions with the provided rubrics and sample solutions.';
    } else if (mcqPercentage >= 70) {
      recommendations.overall = 'Strong MCQ foundation. Focus on improving weak areas and practice FRQ questions.';
    } else if (mcqPercentage >= 60) {
      recommendations.overall = 'Good MCQ performance. Review incorrect answers and practice FRQ coding.';
    } else {
      recommendations.overall = 'Focus on strengthening fundamentals. Review MCQ explanations and practice basic coding concepts.';
    }

    // Study focus based on weaknesses
    if (weaknesses.length > 0) {
      recommendations.studyFocus = weaknesses.map((w: string) => 
        `Review: ${w.replace('Needs improvement in ', '')}`
      );
    }

    recommendations.studyFocus.push('Review FRQ solutions and rubrics carefully');
    recommendations.studyFocus.push('Practice writing complete, working Java code');

    // Next steps
    recommendations.nextSteps = [
      'Review all FRQ sample solutions and scoring rubrics',
      'Compare your FRQ code to the provided solutions',
      'Schedule a tutoring session to review FRQs if needed',
      'Practice weak MCQ units with targeted questions',
      'Retake a full exam after focused study',
    ];

    return recommendations;
  }

  /**
   * Calculate estimated AP score range based on MCQ only
   */
  calculateEstimatedAPRange(mcqScore: number) {
    const mcqWeighted = (mcqScore / 42) * 55;
    
    // Provide ranges assuming different FRQ performance levels
    const scenarios = [
      { frqPercent: 90, label: 'Strong FRQ (90%)', score: mcqWeighted + (45 * 0.9) },
      { frqPercent: 75, label: 'Good FRQ (75%)', score: mcqWeighted + (45 * 0.75) },
      { frqPercent: 60, label: 'Average FRQ (60%)', score: mcqWeighted + (45 * 0.6) },
      { frqPercent: 45, label: 'Weak FRQ (45%)', score: mcqWeighted + (45 * 0.45) },
    ];

    return scenarios.map(s => ({
      ...s,
      apScore: this.calculateAPScore(s.score),
    }));
  }

  /**
   * Calculate AP Score from percentage
   */
  calculateAPScore(percentage: number): number {
    if (percentage >= 75) return 5;
    if (percentage >= 62) return 4;
    if (percentage >= 50) return 3;
    if (percentage >= 37) return 2;
    return 1;
  }
}

export default new FullExamService();