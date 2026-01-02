import prisma from '../config/database.js';
import { AppError } from '../middleware/errorHandler.js';
import { SessionType } from '@prisma/client'; 
import axios from 'axios';

const GHL_API_BASE = 'https://services.leadconnectorhq.com';

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
   * Get the admin-selected 10 free trial questions
   */
  async getFreeTrialQuestions(): Promise<any[]> {
    console.log('📚 Fetching admin-selected free trial questions...');

    const freeTrialQuestions = await prisma.freeTrialQuestion.findMany({
      include: {
        question: {
          include: {
            unit: true,
            topic: true,
          },
        },
      },
      orderBy: {
        orderIndex: 'asc',
      },
    });

    if (freeTrialQuestions.length === 0) {
      console.log('⚠️ No free trial questions configured by admin');
      throw new AppError(
        'Free trial is not currently available. Please contact your instructor.',
        404
      );
    }

    const questions = freeTrialQuestions.map(ftq => ftq.question);

    console.log(`✅ Loaded ${questions.length} free trial questions`);
    questions.forEach((q, i) => {
      console.log(`   ${i + 1}. Unit ${q.unit?.unitNumber} - ${q.topic?.name || 'General'} (${q.difficulty})`);
    });

    return questions;
  }

  /**
   * Start free trial session
   */
  async startFreeTrialSession(userId: string, userEmail: string, userName?: string) {
    console.log('🎁 Starting free trial session for:', userId);

    // Check if already used
    const hasUsed = await this.hasUsedFreeTrial(userId);
    if (hasUsed) {
      throw new AppError(
        'You have already completed your free trial. Please contact us for full access.',
        403
      );
    }

    // Get the admin-selected questions
    const questions = await this.getFreeTrialQuestions();

    if (questions.length === 0) {
      throw new AppError('No questions available for free trial. Please contact support.', 404);
    }

    // Create session - USE ENUM HERE
    const session = await prisma.studySession.create({
      data: {
        userId,
        unitId: questions[0].unitId,
        sessionType: SessionType.FREE_TRIAL, // CHANGED THIS LINE
        totalQuestions: 0,
        correctAnswers: 0,
        targetQuestions: questions.length,
      },
    });

    console.log('✅ Free trial session created:', session.id);

    return {
      session,
      questions,
      totalQuestions: questions.length,
    };
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

    // Add GHL tag "trial-completed" for email automation
    await this.addTrialCompletedTag(user);

    // Get session summary
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

    const accuracy = session.totalQuestions > 0
      ? Math.round((session.correctAnswers / session.totalQuestions) * 100)
      : 0;

    return {
      session,
      accuracy,
      totalQuestions: session.totalQuestions,
      correctAnswers: session.correctAnswers,
    };
  }

  /**
   * Add "trial-completed" tag to GHL contact
   */
  private async addTrialCompletedTag(user: any) {
    try {
      if (!user.ghlUserId || !user.ghlCompanyId) {
        console.log('⚠️ User not linked to GHL, skipping tag');
        return;
      }

      const companyAuth = await prisma.gHLCompanyAuth.findUnique({
        where: { companyId: user.ghlCompanyId },
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

  // Admin functions for managing free trial questions

  /**
   * Get all free trial questions (admin)
   */
  async getAllFreeTrialQuestions() {
    return await prisma.freeTrialQuestion.findMany({
      include: {
        question: {
          include: {
            unit: true,
            topic: true,
          },
        },
      },
      orderBy: {
        orderIndex: 'asc',
      },
    });
  }

  /**
   * Set a question as free trial question (admin)
   */
  async setFreeTrialQuestion(questionId: string, orderIndex: number) {
    // Check if this position is already taken
    const existing = await prisma.freeTrialQuestion.findUnique({
      where: { orderIndex },
    });

    if (existing) {
      // Remove the existing one first
      await prisma.freeTrialQuestion.delete({
        where: { orderIndex },
      });
    }

    // Add the new one
    const freeTrialQuestion = await prisma.freeTrialQuestion.create({
      data: {
        questionId,
        orderIndex,
      },
      include: {
        question: {
          include: {
            unit: true,
            topic: true,
          },
        },
      },
    });

    return freeTrialQuestion;
  }

  /**
   * Remove a question from free trial (admin)
   */
  async removeFreeTrialQuestion(orderIndex: number) {
    await prisma.freeTrialQuestion.delete({
      where: { orderIndex },
    });
  }

  /**
   * Get available questions for selection (admin)
   */
  async getAvailableQuestions(unitId?: string) {
    const where: any = {
      approved: true,
    };

    if (unitId) {
      where.unitId = unitId;
    }

    return await prisma.question.findMany({
      where,
      include: {
        unit: true,
        topic: true,
        freeTrialQuestions: true,
      },
      orderBy: [
        { unit: { unitNumber: 'asc' } },
        { createdAt: 'desc' },
      ],
    });
  }
}

export default new FreeTrialService();