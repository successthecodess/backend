import prisma from '../config/database.js';
import questionService from './questionService.js';
import adaptiveLearningService from './adaptiveLearningService.js';
import { AppError } from '../middleware/errorHandler.js';

export class PracticeSessionService {
  private readonly QUESTIONS_PER_SESSION = 40;

  /**
   * Ensure user exists in database
   */
  private async ensureUserExists(userId: string, userEmail?: string, userName?: string) {
    console.log('Ensuring user exists:', userId);
    
    let user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (user) {
      const updates: any = {
        lastActive: new Date(),
      };

      if (userName && userName !== user.name) {
        updates.name = userName;
      }

      if (userEmail && userEmail !== user.email) {
        const emailExists = await prisma.user.findFirst({
          where: {
            email: userEmail,
            id: { not: userId },
          },
        });

        if (!emailExists) {
          updates.email = userEmail;
        }
      }

      if (Object.keys(updates).length > 1) {
        user = await prisma.user.update({
          where: { id: userId },
          data: updates,
        });
        console.log('✅ User updated:', user.id);
      } else {
        console.log('✅ User found (no updates needed):', user.id);
      }
    } else {
      const email = userEmail || `${userId}-${Date.now()}@clerk.user`;
      
      user = await prisma.user.create({
        data: {
          id: userId,
          email: email,
          name: userName,
          password: 'clerk-managed',
        },
      });
      console.log('✅ User created:', user.id);
    }

    return user;
  }

  /**
   * Start a new practice session
   */
  async startSession(
    userId: string, 
    unitId: string, 
    topicId?: string, 
    userEmail?: string, 
    userName?: string,
    targetQuestions: number = 40
  ) {
    console.log('🎯 Starting practice session:', { userId, unitId, topicId, targetQuestions });

    try {
      await this.ensureUserExists(userId, userEmail, userName);

      const unit = await prisma.unit.findUnique({
        where: { id: unitId },
      });

      if (!unit) {
        throw new AppError('Unit not found', 404);
      }

      console.log('✅ Unit found:', unit.name);

      const hasQuestions = await questionService.hasQuestions(unitId);
      
      if (!hasQuestions) {
        throw new AppError(
          `No approved questions available for ${unit.name}. Please contact your administrator to add questions.`,
          404
        );
      }

      const counts = await questionService.getQuestionCounts(unitId);
      console.log('📊 Question counts:', counts);

      // Get student's current difficulty level
      console.log('\n📊 FETCHING STUDENT STARTING LEVEL...');
      const studentLevel = await adaptiveLearningService.getRecommendedDifficulty(
        userId,
        unitId,
        topicId
      );

      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('🎯 STUDENT STARTING LEVEL:', studentLevel);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

      const session = await prisma.studySession.create({
        data: {
          userId,
          unitId,
          topicId: topicId === undefined ? null : topicId,
          sessionType: 'PRACTICE',
          totalQuestions: 0,
          correctAnswers: 0,
          targetQuestions: targetQuestions,
        },
      });

      console.log('✅ Session created:', session.id);

      // Get first question matching student's level
      console.log(`📚 Requesting ${studentLevel} question...`);
      let question = await questionService.getRandomQuestion(unitId, studentLevel, []);

      if (!question) {
        // If no questions at student's level, try nearby difficulties
        console.log(`⚠️ No ${studentLevel} questions, trying alternatives...`);
        const difficulties = ['EASY', 'MEDIUM', 'HARD', 'EXPERT'];
        const currentIndex = difficulties.indexOf(studentLevel);
        
        // Try one level down first, then one level up
        const tryOrder = [
          currentIndex - 1,
          currentIndex + 1,
        ].filter(i => i >= 0 && i < difficulties.length);

        for (const index of tryOrder) {
          question = await questionService.getRandomQuestion(unitId, difficulties[index] as any, []);
          if (question) {
            console.log(`⚠️ Using ${difficulties[index]} question (fallback)\n`);
            break;
          }
        }

        if (!question) {
          throw new AppError(
            `No questions available for ${unit.name}. Please contact your administrator to add questions.`,
            404
          );
        }
      } else {
        console.log(`✅ First question: ${question.difficulty} (student level: ${studentLevel})\n`);
      }

      return {
        session,
        question,
        recommendedDifficulty: studentLevel,
        questionsRemaining: targetQuestions - 1,
        totalQuestions: targetQuestions,
        questionCounts: counts,
      };
    } catch (error) {
      console.error('❌ Error in startSession:', error);
      throw error;
    }
  }

  /**
   * Get next question - ALWAYS MATCHES STUDENT'S CURRENT LEVEL
   */
  /**
 * Get next question - ALWAYS MATCHES STUDENT'S CURRENT LEVEL
 */
async getNextQuestion(
  userId: string,
  sessionId: string,
  unitId: string,
  answeredQuestionIds: string[],
  topicId?: string
) {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🎯 GET NEXT QUESTION');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('User ID:', userId);
  console.log('Session ID:', sessionId);
  console.log('Unit ID:', unitId);
  console.log('Topic ID:', topicId);
  console.log('Answered count:', answeredQuestionIds.length);

  try {
    const session = await prisma.studySession.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      throw new AppError('Session not found', 404);
    }

    const targetQuestions = session.targetQuestions || this.QUESTIONS_PER_SESSION;

    if (session.totalQuestions >= targetQuestions) {
      console.log('✅ Session complete!');
      return null;
    }

    console.log(`Questions remaining: ${targetQuestions - session.totalQuestions}`);

    // CRITICAL: Get FRESH student difficulty from database
    console.log('\n📊 FETCHING FRESH STUDENT LEVEL FROM DATABASE...');
    
    // Get the actual progress record from database
    const progressRecord = await prisma.progress.findFirst({
      where: {
        userId,
        unitId,
        topicId: topicId === undefined ? null : topicId,
      },
    });

    if (!progressRecord) {
      console.log('   → No progress found - defaulting to EASY');
      const studentLevel = 'EASY';
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('🎯 STUDENT CURRENT LEVEL:', studentLevel);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

      const question = await questionService.getRandomQuestion(
        unitId,
        studentLevel,
        answeredQuestionIds
      );

      if (question) {
        console.log('✅ Question found:', question.difficulty);
      }

      return question;
    }

    const studentLevel = progressRecord.currentDifficulty;

    console.log('   → Database Progress:');
    console.log('      - Current Difficulty:', progressRecord.currentDifficulty);
    console.log('      - Total Attempts:', progressRecord.totalAttempts);
    console.log('      - Mastery:', progressRecord.masteryLevel + '%');
    console.log('      - Consecutive Correct:', progressRecord.consecutiveCorrect);
    console.log('      - Consecutive Wrong:', progressRecord.consecutiveWrong);

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🎯 STUDENT CURRENT LEVEL:', studentLevel);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Get question matching student's EXACT level
    console.log(`📚 Requesting ${studentLevel} question from database...`);
    let question = await questionService.getRandomQuestion(
      unitId,
      studentLevel,
      answeredQuestionIds
    );

    if (question) {
      console.log('\n✅ QUESTION RETRIEVED:');
      console.log('   - Question ID:', question.id);
      console.log('   - Question Difficulty:', question.difficulty);
      console.log('   - Student Level:', studentLevel);
      
      if (question.difficulty === studentLevel) {
        console.log('   - MATCH: ✅ YES - PERFECT!');
      } else {
        console.log('   - MATCH: ❌ NO - BUG DETECTED!');
        console.log('   - Expected:', studentLevel);
        console.log('   - Got:', question.difficulty);
      }
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    } else {
      console.log(`\n⚠️ No ${studentLevel} questions available (${answeredQuestionIds.length} excluded)`);
      console.log('Trying fallback...\n');
      
      const difficulties = ['EASY', 'MEDIUM', 'HARD', 'EXPERT'];
      const currentIndex = difficulties.indexOf(studentLevel);
      
      // Try closest difficulties first
      const fallbackOrder = [
        currentIndex - 1,
        currentIndex + 1,
      ].filter(i => i >= 0 && i < difficulties.length);

      for (const index of fallbackOrder) {
        const fallbackLevel = difficulties[index] as any;
        console.log(`   Trying ${fallbackLevel}...`);
        question = await questionService.getRandomQuestion(
          unitId,
          fallbackLevel,
          answeredQuestionIds
        );
        
        if (question) {
          console.log(`   ⚠️ Using ${question.difficulty} question (fallback from ${studentLevel})`);
          console.log(`   ⚠️ THIS IS A FALLBACK - NOT ENOUGH ${studentLevel} QUESTIONS\n`);
          break;
        }
      }
    }

    if (!question) {
      console.log('❌ No more questions available');
      
      const totalQuestions = await questionService.getQuestionCounts(unitId);
      
      if (answeredQuestionIds.length >= totalQuestions.total) {
        throw new AppError(
          `You've completed all ${totalQuestions.total} available questions for this unit! Great job! 🎉`,
          404
        );
      } else {
        throw new AppError(
          'No more questions available at this time.',
          404
        );
      }
    }

    return question;
  } catch (error) {
    console.error('❌ Error in getNextQuestion:', error);
    throw error;
  }
}
  /**
   * Submit an answer for a question
   */
/**
 * Submit an answer for a question
 */
async submitAnswer(
  userId: string,
  sessionId: string,
  questionId: string,
  userAnswer: string,
  timeSpent?: number
) {
  console.log('\n📝 SUBMITTING ANSWER');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('User ID:', userId);
  console.log('Session ID:', sessionId);
  console.log('Question ID:', questionId);
  console.log('Answer:', userAnswer);

  try {
    // Get session to know which unit we're in
    const session = await prisma.studySession.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      throw new AppError('Session not found', 404);
    }

    console.log('Session Unit ID:', session.unitId);
    console.log('Session Topic ID:', session.topicId);

    // Submit answer to question service
    const result = await questionService.submitAnswer(
      userId,
      questionId,
      userAnswer,
      timeSpent
    );

    console.log('✅ Answer result:', result.isCorrect ? '✅ Correct' : '❌ Incorrect');

    // Update session statistics
    const updateData: any = {
      totalQuestions: { increment: 1 },
    };

    if (result.isCorrect) {
      updateData.correctAnswers = { increment: 1 };
    }

    const updatedSession = await prisma.studySession.update({
      where: { id: sessionId },
      data: updateData,
    });

    console.log('✅ Session updated');

    // CRITICAL: Use session's unitId and topicId for progress, NOT question's!
    console.log('\n📊 Updating student progress...');
    console.log('   Using Unit ID from SESSION:', session.unitId);
    console.log('   Using Topic ID from SESSION:', session.topicId);
    
    const progress = await adaptiveLearningService.updateProgress(
      userId,
      questionId,
      result.isCorrect,
      timeSpent
    );

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ PROGRESS UPDATED - NEW LEVEL:', progress.currentDifficulty);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    return {
      ...result,
      session: updatedSession,
      progress,
    };
  } catch (error) {
    console.error('❌ Error in submitAnswer:', error);
    throw error;
  }
}
  /**
   * End a practice session
   */
  async endSession(sessionId: string) {
    console.log('🏁 Ending session:', sessionId);

    try {
      const session = await prisma.studySession.findUnique({
        where: { id: sessionId },
        include: {
          responses: {
            include: {
              question: {
                include: {
                  topic: true,
                },
              },
            },
          },
        },
      });

      if (!session) {
        throw new AppError('Session not found', 404);
      }

      // Calculate session duration
      const duration = Math.floor(
        (new Date().getTime() - new Date(session.startedAt).getTime()) / 1000
      );

      // Calculate average time per question
      const averageTime = session.totalQuestions > 0
        ? duration / session.totalQuestions
        : 0;

      // Calculate accuracy rate
      const accuracyRate = session.totalQuestions > 0
        ? (session.correctAnswers / session.totalQuestions) * 100
        : 0;

      // Update session with final statistics
      const updatedSession = await prisma.studySession.update({
        where: { id: sessionId },
        data: {
          endedAt: new Date(),
          totalDuration: duration,
          averageTime,
          accuracyRate,
        },
      });

      console.log('✅ Session ended successfully');

      // Prepare summary
      const summary = {
        totalQuestions: session.totalQuestions,
        correctAnswers: session.correctAnswers,
        accuracyRate: Math.round(accuracyRate),
        totalDuration: duration,
        averageTime: Math.round(averageTime),
        responses: session.responses.map((r) => ({
          questionId: r.questionId,
          isCorrect: r.isCorrect,
          timeSpent: r.timeSpent || 0,
          topic: r.question.topic?.name || 'General',
        })),
      };

      return {
        session: updatedSession,
        summary,
      };
    } catch (error) {
      console.error('❌ Error in endSession:', error);
      throw error;
    }
  }

  /**
   * Get session statistics
   */
  async getSessionStats(sessionId: string) {
    const session = await prisma.studySession.findUnique({
      where: { id: sessionId },
      include: {
        responses: true,
      },
    });

    if (!session) {
      throw new AppError('Session not found', 404);
    }

    return {
      totalQuestions: session.totalQuestions,
      correctAnswers: session.correctAnswers,
      accuracy: session.totalQuestions > 0
        ? (session.correctAnswers / session.totalQuestions) * 100
        : 0,
      responsesCount: session.responses.length,
    };
  }
}

export default new PracticeSessionService();