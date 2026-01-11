import prisma from '../config/database.js';
import examBankService from './examBankService.js';
import { AppError } from '../middleware/errorHandler.js';

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
      const mcqResponses = await Promise.all(
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
      const frqResponses = await Promise.all(
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

    const updated = await prisma.examAttemptMCQ.update({
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

    const updated = await prisma.examAttemptFRQ.update({
      where: { id: frqResponse.id },
      data: {
        userCode,
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
            question: true,
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
   * Submit entire exam for grading
   */
  async submitExam(examAttemptId: string, totalTimeSpent: number) {
    console.log('📝 Submitting exam:', examAttemptId);

    const examAttempt = await this.getExamAttempt(examAttemptId);

    // Calculate MCQ score
    const mcqCorrect = examAttempt.mcqResponses.filter(r => r.isCorrect).length;
    const mcqScore = mcqCorrect;
    const mcqPercentage = (mcqCorrect / 42) * 100;

    console.log(`📊 MCQ Score: ${mcqCorrect}/42 (${mcqPercentage.toFixed(1)}%)`);

    // Update exam attempt
    const updated = await prisma.fullExamAttempt.update({
      where: { id: examAttemptId },
      data: {
        submittedAt: new Date(),
        status: 'SUBMITTED',
        totalTimeSpent,
        mcqScore,
        mcqPercentage,
      },
    });

    console.log('✅ Exam submitted, ready for FRQ grading');

    return {
      examAttemptId,
      mcqScore,
      mcqPercentage,
      status: 'SUBMITTED',
      message: 'Exam submitted successfully. FRQ grading in progress...',
    };
  }
}

export default new FullExamService();