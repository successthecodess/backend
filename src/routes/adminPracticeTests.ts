import express, { Request, Response } from 'express';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
import prisma from '../config/database.js';
import { asyncHandler } from '../middleware/errorHandler.js';

const router = express.Router();

// All routes require admin authentication
router.use(authenticateToken);
router.use(requireAdmin);

// Get all users who have taken practice tests
router.get('/users', asyncHandler(async (req: Request, res: Response) => {
  const users = await prisma.user.findMany({
    where: {
      studySessions: {
        some: {},
      },
    },
    select: {
      id: true,
      email: true,
      name: true,
      _count: {
        select: {
          studySessions: true,
          questionResponses: true,
        },
      },
      studySessions: {
        where: {
          endedAt: { not: null },
        },
        orderBy: {
          endedAt: 'desc',
        },
        take: 1,
        select: {
          totalQuestions: true,
          correctAnswers: true,
          accuracyRate: true,
          endedAt: true,
          sessionType: true,
        },
      },
      progress: {
        orderBy: {
          masteryLevel: 'desc',
        },
        take: 3,
        select: {
          unit: {
            select: {
              name: true,
            },
          },
          masteryLevel: true,
        },
      },
    },
    orderBy: {
      lastActive: 'desc',
    },
  });

  res.json({
    status: 'success',
    data: { users },
  });
}));

// Get practice test statistics
router.get('/statistics', asyncHandler(async (req: Request, res: Response) => {
  const [
    totalSessions,
    totalResponses,
    avgStats,
    sessionsByType,
    recentSessions,
  ] = await Promise.all([
    prisma.studySession.count({
      where: {
        endedAt: { not: null },
      },
    }),
    prisma.questionResponse.count(),
    prisma.studySession.aggregate({
      where: {
        endedAt: { not: null },
      },
      _avg: {
        accuracyRate: true,
        averageTime: true,
        totalDuration: true,
        totalQuestions: true,
      },
    }),
    prisma.studySession.groupBy({
      by: ['sessionType'],
      _count: {
        id: true,
      },
      where: {
        endedAt: { not: null },
      },
    }),
    prisma.studySession.findMany({
      where: {
        endedAt: { not: null },
      },
      orderBy: {
        endedAt: 'desc',
      },
      take: 10,
      include: {
        user: {
          select: {
            email: true,
            name: true,
          },
        },
      },
    }),
  ]);

  res.json({
    status: 'success',
    data: {
      totalSessions,
      totalResponses,
      averages: {
        accuracyRate: avgStats._avg.accuracyRate,
        averageTime: avgStats._avg.averageTime,
        totalDuration: avgStats._avg.totalDuration,
        totalQuestions: avgStats._avg.totalQuestions,
      },
      sessionsByType,
      recentSessions,
    },
  });
}));

// Get all practice sessions with filters
router.get('/sessions', asyncHandler(async (req: Request, res: Response) => {
  const { userId, sessionType, limit, offset } = req.query;

  const filters: any = {
    endedAt: { not: null },
  };

  if (userId) filters.userId = userId as string;
  if (sessionType) filters.sessionType = sessionType as string;

  const [sessions, total] = await Promise.all([
    prisma.studySession.findMany({
      where: filters,
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
      },
      orderBy: {
        endedAt: 'desc',
      },
      take: limit ? parseInt(limit as string) : 50,
      skip: offset ? parseInt(offset as string) : 0,
    }),
    prisma.studySession.count({ where: filters }),
  ]);

  res.json({
    status: 'success',
    data: {
      sessions,
      total,
      limit: limit ? parseInt(limit as string) : 50,
      offset: offset ? parseInt(offset as string) : 0,
    },
  });
}));

// Get user's practice test history
router.get('/users/:userId/history', asyncHandler(async (req: Request, res: Response) => {
  const { userId } = req.params;

  const sessions = await prisma.studySession.findMany({
    where: {
      userId,
      endedAt: { not: null },
    },
    orderBy: {
      endedAt: 'desc',
    },
    include: {
      responses: {
        select: {
          id: true,
          isCorrect: true,
          timeSpent: true,
        },
      },
    },
  });

  res.json({
    status: 'success',
    data: { sessions },
  });
}));

// Get detailed session data
router.get('/sessions/:sessionId', asyncHandler(async (req: Request, res: Response) => {
  const { sessionId } = req.params;

  const session = await prisma.studySession.findUnique({
    where: { id: sessionId },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          name: true,
        },
      },
      responses: {
        include: {
          question: {
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
          },
        },
        orderBy: {
          createdAt: 'asc',
        },
      },
    },
  });

  if (!session) {
    return res.status(404).json({
      status: 'error',
      message: 'Session not found',
    });
  }

  // Calculate unit breakdown
  const unitBreakdown: Record<string, any> = {};
  session.responses.forEach((response) => {
    const unitKey = response.question.unit.id;
    if (!unitBreakdown[unitKey]) {
      unitBreakdown[unitKey] = {
        unitName: response.question.unit.name,
        unitNumber: response.question.unit.unitNumber,
        total: 0,
        correct: 0,
        percentage: 0,
      };
    }
    unitBreakdown[unitKey].total++;
    if (response.isCorrect) unitBreakdown[unitKey].correct++;
  });

  // Calculate percentages
  Object.values(unitBreakdown).forEach((unit: any) => {
    unit.percentage = (unit.correct / unit.total) * 100;
  });

  res.json({
    status: 'success',
    data: {
      session: {
        ...session,
        unitBreakdown: Object.values(unitBreakdown),
      },
    },
  });
}));

// Get user's overall analytics
router.get('/users/:userId/analytics', asyncHandler(async (req: Request, res: Response) => {
  const { userId } = req.params;

  const [
    totalSessions,
    totalResponses,
    progress,
    recentSessions,
    dailyAnalytics,
    weeklyAnalytics,
  ] = await Promise.all([
    prisma.studySession.count({
      where: {
        userId,
        endedAt: { not: null },
      },
    }),
    prisma.questionResponse.count({
      where: { userId },
    }),
    prisma.progress.findMany({
      where: { userId },
      include: {
        unit: true,
        topic: true,
      },
      orderBy: {
        masteryLevel: 'desc',
      },
    }),
    prisma.studySession.findMany({
      where: {
        userId,
        endedAt: { not: null },
      },
      orderBy: {
        endedAt: 'desc',
      },
      take: 10,
    }),
    prisma.dailyAnalytics.findMany({
      where: { userId },
      orderBy: {
        date: 'desc',
      },
      take: 30,
    }),
    prisma.weeklyAnalytics.findMany({
      where: { userId },
      orderBy: {
        weekStart: 'desc',
      },
      take: 12,
    }),
  ]);

  // Calculate overall stats
  const avgAccuracy = await prisma.studySession.aggregate({
    where: {
      userId,
      endedAt: { not: null },
    },
    _avg: {
      accuracyRate: true,
      totalDuration: true,
    },
  });

  const totalStudyTime = await prisma.studySession.aggregate({
    where: {
      userId,
      endedAt: { not: null },
    },
    _sum: {
      totalDuration: true,
    },
  });

  res.json({
    status: 'success',
    data: {
      overview: {
        totalSessions,
        totalResponses,
        avgAccuracy: avgAccuracy._avg.accuracyRate,
        avgSessionDuration: avgAccuracy._avg.totalDuration,
        totalStudyTime: totalStudyTime._sum.totalDuration,
      },
      progress,
      recentSessions,
      dailyAnalytics,
      weeklyAnalytics,
    },
  });
}));

export default router;