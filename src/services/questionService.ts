import prisma from '../config/database.js';
import { DifficultyLevel, QuestionType } from '@prisma/client';
import { AppError } from '../middleware/errorHandler.js';

export class QuestionService {
  /**
   * Get ALL questions at a specific difficulty level for random selection
   */
  async getAllQuestionsAtLevel(
    unitId: string,
    difficulty: DifficultyLevel,
    excludeIds: string[] = [],
    topicId?: string
  ) {
    console.log(`   → Fetching all ${difficulty} questions...`);
    console.log(`      Unit: ${unitId}`);
    console.log(`      Topic: ${topicId || 'All'}`);
    console.log(`      Excluding: ${excludeIds.length} questions`);

    const where: any = {
      unitId,
      difficulty,
      approved: true,
      id: { notIn: excludeIds },
    };

    if (topicId) {
      where.topicId = topicId;
    }

    const questions = await prisma.question.findMany({
      where,
      include: {
        topic: true,
        unit: true,
      },
    });

    console.log(`   → Found ${questions.length} questions`);

    return questions;
  }

  /**
   * Get random question with specific difficulty - Uses random selection
   */
  async getRandomQuestion(
    unitId: string,
    difficulty: DifficultyLevel,
    excludeIds: string[] = [],
    topicId?: string
  ) {
    console.log(`🔍 Searching for ${difficulty} question in unit ${unitId}, excluding ${excludeIds.length} questions`);

    // Get all matching questions
    const questions = await this.getAllQuestionsAtLevel(unitId, difficulty, excludeIds, topicId);

    if (questions.length === 0) {
      console.log(`❌ No ${difficulty} questions found`);
      return null;
    }

    // Randomly select one
    const randomIndex = Math.floor(Math.random() * questions.length);
    const question = questions[randomIndex];

    console.log(`✅ Randomly selected question ${randomIndex + 1} of ${questions.length}: ${question.id}`);

    return question;
  }

  /**
   * Check if unit has any questions
   */
  async hasQuestions(unitId: string): Promise<boolean> {
    const count = await prisma.question.count({
      where: {
        unitId,
        approved: true,
      },
    });
    return count > 0;
  }

  /**
   * Get question counts by difficulty
   */
  async getQuestionCounts(unitId: string) {
    const [total, easy, medium, hard] = await Promise.all([
      prisma.question.count({
        where: { unitId, approved: true },
      }),
      prisma.question.count({
        where: { unitId, approved: true, difficulty: 'EASY' },
      }),
      prisma.question.count({
        where: { unitId, approved: true, difficulty: 'MEDIUM' },
      }),
      prisma.question.count({
        where: { unitId, approved: true, difficulty: 'HARD' },
      }),
    
    ]);

    return { total, easy, medium, hard};
  }

  /**
   * Submit answer for a question
   */
  async submitAnswer(
    userId: string,
    questionId: string,
    userAnswer: string,
    timeSpent?: number
  ) {
    console.log('📝 Submitting answer for question:', questionId);

    const question = await prisma.question.findUnique({
      where: { id: questionId },
      include: {
        unit: true,
        topic: true,
      },
    });

    if (!question) {
      throw new AppError('Question not found', 404);
    }

    // Check if answer is correct
    const isCorrect = userAnswer.trim().toLowerCase() === question.correctAnswer.trim().toLowerCase();

    console.log('Answer check:', {
      userAnswer: userAnswer.trim(),
      correctAnswer: question.correctAnswer.trim(),
      isCorrect,
    });

    // Find active session for this user
    const activeSession = await prisma.studySession.findFirst({
      where: {
        userId,
        endedAt: null,
      },
      orderBy: {
        startedAt: 'desc',
      },
    });

    if (!activeSession) {
      throw new AppError('No active session found', 404);
    }

    // Save response
    const response = await prisma.questionResponse.create({
      data: {
        userId,
        questionId,
        sessionId: activeSession.id,
        userAnswer,
        isCorrect,
        timeSpent,
        difficultyAtTime: question.difficulty,
      },
    });

    console.log('✅ Response saved:', response.id, '| Correct:', isCorrect);

    return {
      isCorrect,
      correctAnswer: question.correctAnswer,
      explanation: question.explanation,
      userAnswer,
      question,
    };
  }

  /**
   * Get question by ID
   */
  async getQuestionById(questionId: string) {
    const question = await prisma.question.findUnique({
      where: { id: questionId },
      include: {
        unit: true,
        topic: true,
      },
    });

    if (!question) {
      throw new AppError('Question not found', 404);
    }

    return question;
  }

  /**
   * Get questions by unit
   */
  async getQuestionsByUnit(unitId: string, difficulty?: DifficultyLevel) {
    const where: any = {
      unitId,
      approved: true,
    };

    if (difficulty) {
      where.difficulty = difficulty;
    }

    const questions = await prisma.question.findMany({
      where,
      include: {
        unit: true,
        topic: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return questions;
  }

  /**
   * Create a new question
   */
  async createQuestion(data: {
    unitId: string;
    topicId?: string;
    questionText: string;
    options: string[];
    correctAnswer: string;
    explanation: string;
    difficulty: DifficultyLevel;
    type: QuestionType;
    approved?: boolean;
    aiGenerated?: boolean;
  }) {
    const question = await prisma.question.create({
      data: {
        ...data,
        topicId: data.topicId || null,
        approved: data.approved ?? true,
        aiGenerated: data.aiGenerated ?? false,
      },
      include: {
        unit: true,
        topic: true,
      },
    });

    return question;
  }

  /**
   * Update a question
   */
  async updateQuestion(questionId: string, data: any) {
    const question = await prisma.question.update({
      where: { id: questionId },
      data,
      include: {
        unit: true,
        topic: true,
      },
    });

    return question;
  }

  /**
   * Delete a question
   */
  async deleteQuestion(questionId: string) {
    await prisma.question.delete({
      where: { id: questionId },
    });
  }
}

export default new QuestionService();