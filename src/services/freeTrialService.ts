import prisma from '../config/database.js';
import { AppError } from '../middleware/errorHandler.js';
import { SessionType } from '@prisma/client'; 
import axios from 'axios';

const GHL_API_BASE = 'https://services.leadconnectorhq.com';

// Fisher-Yates shuffle algorithm
function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

class FreeTrialService {
  /**
   * Check if user has used their free trial
   */
  async hasUsedFreeTrial(userId: string): Promise<boolean> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { hasUsedFreeTrial: true },
    });

    return user?.hasUsedFreeTrial || false;
  }

  /**
   * Get 10 RANDOM questions from the entire approved question pool
   */
  async getFreeTrialQuestions(): Promise<any[]> {
    console.log('📚 Fetching random questions from entire pool...');

    // Get ALL approved questions
    const allQuestions = await prisma.question.findMany({
      where: {
        approved: true,
        options: {
          //isEmpty: false, // Ensure questions have options
        },
      },
      include: {
        unit: {
          select: {
            id: true,
            unitNumber: true,
            name: true,
          },
        },
        topic: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    if (allQuestions.length < 10) {
      console.log(`⚠️ Not enough questions available (found: ${allQuestions.length})`);
      throw new AppError(
        'Not enough questions available for free trial. Please contact your instructor.',
        404
      );
    }

    console.log(`✅ Found ${allQuestions.length} approved questions in pool`);

    // Shuffle all questions
    const shuffled = shuffleArray(allQuestions);

    // Take first 10 from shuffled array (completely random)
    const selectedQuestions = shuffled.slice(0, 10);

    console.log(`✅ Selected 10 random questions:`, 
      selectedQuestions.map(q => ({
        id: q.id.substring(0, 8),
        unit: q.unit?.name,
        difficulty: q.difficulty
      }))
    );

    return selectedQuestions;
  }

  /**
   * Start free trial session with 10 random questions
   */
  async startFreeTrialSession(userId: string, userEmail: string, userName?: string) {
    console.log('🎁 Starting free trial session for:', userId);

    // Get 10 random questions from entire pool
    const questions = await this.getFreeTrialQuestions();

    if (questions.length === 0) {
      throw new AppError('No questions available for free trial. Please contact support.', 404);
    }

    // Store randomized question order in session metadata
    const questionOrder = questions.map(q => q.id);

    // Create session
    const session = await prisma.studySession.create({
      data: {
        userId,
        unitId: questions[0].unitId, // Just use first question's unit
        sessionType: SessionType.FREE_TRIAL,
        totalQuestions: 0,
        correctAnswers: 0,
        targetQuestions: questions.length,
        metadata: { 
          questionOrder, // Store the randomized order
          unitDistribution: this.getUnitDistribution(questions), // Track diversity
        },
      },
    });

    console.log('✅ Free trial session created:', session.id);
    console.log('📊 Question distribution:', this.getUnitDistribution(questions));

    return {
      session,
      questions,
      totalQuestions: questions.length,
    };
  }

  /**
   * Helper to track unit distribution in selected questions
   */
  private getUnitDistribution(questions: any[]): Record<string, number> {
    const distribution: Record<string, number> = {};
    
    questions.forEach(q => {
      const unitName = q.unit?.name || 'Unknown';
      distribution[unitName] = (distribution[unitName] || 0) + 1;
    });

    return distribution;
  }

  /**
   * Complete free trial and add GHL tag
   */
  async completeFreeTrialSession(userId: string, sessionId: string) {
    console.log('🏁 Completing free trial for user:', userId);

    // Mark as used
    const user = await prisma.user.update({
      where: { id: userId },
      data: {
        hasUsedFreeTrial: true,
        freeTrialCompletedAt: new Date(),
      },
    });

    console.log('✅ User marked as free trial completed');

    // Add GHL tag "trial-completed" for email automation (async, don't wait)
    this.addTrialCompletedTag(user).catch(err => 
      console.error('Failed to add trial tag:', err)
    );

    // Get session summary (optimized query)
    const session = await prisma.studySession.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        totalQuestions: true,
        correctAnswers: true,
        metadata: true,
        responses: {
          select: {
            isCorrect: true,
            question: {
              select: {
                topic: {
                  select: {
                    name: true,
                  },
                },
                unit: {
                  select: {
                    name: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!session) {
      throw new AppError('Session not found', 404);
    }

    const accuracy = session.totalQuestions > 0
      ? Math.round((session.correctAnswers / session.totalQuestions) * 100)
      : 0;

    // Log performance analytics
  

    return {
      session,
      accuracy,
      totalQuestions: session.totalQuestions,
      correctAnswers: session.correctAnswers,
    };
  }

  /**
   * Add "trial-completed" tag to GHL contact (async)
   */
  private async addTrialCompletedTag(user: any) {
    try {
      if (!user.ghlUserId || !user.ghlCompanyId) {
        console.log('⚠️ User not linked to GHL, skipping tag');
        return;
      }

      const companyAuth = await prisma.gHLCompanyAuth.findUnique({
        where: { companyId: user.ghlCompanyId },
        select: { accessToken: true },
      });

      if (!companyAuth) {
        console.log('⚠️ Company not authorized, skipping tag');
        return;
      }

      // Get current tags
      const contactResponse = await axios.get(
        `${GHL_API_BASE}/contacts/${user.ghlUserId}`,
        {
          headers: {
            'Authorization': `Bearer ${companyAuth.accessToken}`,
            'Version': '2021-07-28',
          },
          timeout: 5000,
        }
      );

      const currentTags = contactResponse.data.contact.tags || [];
      
      // Add trial-completed tag if not already present
      if (!currentTags.includes('trial-completed')) {
        const updatedTags = [...currentTags, 'trial-completed'];

        await axios.put(
          `${GHL_API_BASE}/contacts/${user.ghlUserId}`,
          { tags: updatedTags },
          {
            headers: {
              'Authorization': `Bearer ${companyAuth.accessToken}`,
              'Version': '2021-07-28',
              'Content-Type': 'application/json',
            },
            timeout: 5000,
          }
        );

        // Update local database
        await prisma.user.update({
          where: { id: user.id },
          data: { ghlTags: updatedTags },
        });

        console.log('✅ Added "trial-completed" tag to GHL contact');
      } else {
        console.log('✅ User already has "trial-completed" tag');
      }
    } catch (error: any) {
      console.error('❌ Failed to add trial-completed tag:', error.message);
      // Don't throw - allow trial to complete even if tag fails
    }
  }

  // ==========================================
  // ADMIN FUNCTIONS (Optional - for future use)
  // ==========================================

  /**
   * Get statistics about question pool
   */
  async getQuestionPoolStats() {
    const total = await prisma.question.count({
      where: { approved: true },
    });

    const byUnit = await prisma.question.groupBy({
      by: ['unitId'],
      where: { approved: true },
      _count: true,
    });

    const byDifficulty = await prisma.question.groupBy({
      by: ['difficulty'],
      where: { approved: true },
      _count: true,
    });

    return {
      total,
      byUnit: await Promise.all(
        byUnit.map(async (item) => {
          const unit = await prisma.unit.findUnique({
            where: { id: item.unitId },
            select: { name: true, unitNumber: true },
          });
          return {
            unit: unit?.name || 'Unknown',
            unitNumber: unit?.unitNumber,
            count: item._count,
          };
        })
      ),
      byDifficulty: byDifficulty.map(item => ({
        difficulty: item.difficulty,
        count: item._count,
      })),
    };
  }

  /**
   * Get all approved questions (for admin review)
   */
  async getAllApprovedQuestions() {
    return await prisma.question.findMany({
      where: { approved: true },
      include: {
        unit: {
          select: {
            id: true,
            unitNumber: true,
            name: true,
          },
        },
        topic: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: [
        { unit: { unitNumber: 'asc' } },
        { createdAt: 'desc' },
      ],
    });
  }
}

export default new FreeTrialService();
