import { Request, Response } from 'express';
import fullExamService from '../services/fullExamService.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import prisma from '../config/database.js';

/**
 * Get all exam attempts (admin only)
 */
export const getAllExamAttempts = asyncHandler(async (req: Request, res: Response) => {
  const { userId, status, limit, offset } = req.query;

  const filters = {
    userId: userId as string,
    status: status as string,
    limit: limit ? parseInt(limit as string) : 50,
    offset: offset ? parseInt(offset as string) : 0,
  };

  const result = await fullExamService.getAllExamAttempts(filters);

  res.status(200).json({
    status: 'success',
    data: {
      attempts: result.attempts,
      total: result.total,
      limit: filters.limit,
      offset: filters.offset,
    },
  });
});

/**
 * Get specific exam attempt details (admin only)
 */
export const getExamAttemptDetails = asyncHandler(async (req: Request, res: Response) => {
  const { examAttemptId } = req.params;

  const examAttempt = await fullExamService.getExamAttempt(examAttemptId);

  res.status(200).json({
    status: 'success',
    data: { examAttempt },
  });
});

/**
 * Get student exam history (admin only)
 */
export const getStudentExamHistory = asyncHandler(async (req: Request, res: Response) => {
  const { userId } = req.params;

  const attempts = await fullExamService.getUserExamHistory(userId);

  res.status(200).json({
    status: 'success',
    data: { attempts },
  });
});

/**
 * Get exam statistics (admin only)
 */
export const getExamStatistics = asyncHandler(async (req: Request, res: Response) => {
  const stats = await prisma.fullExamAttempt.aggregate({
    _count: {
      id: true,
    },
    _avg: {
      mcqScore: true,
      mcqPercentage: true,
      percentageScore: true,
      totalTimeSpent: true,
    },
    where: {
      status: 'GRADED',
    },
  });

  const statusCounts = await prisma.fullExamAttempt.groupBy({
    by: ['status'],
    _count: {
      id: true,
    },
  });

  const recentAttempts = await prisma.fullExamAttempt.findMany({
    where: {
      status: 'GRADED',
    },
    orderBy: {
      submittedAt: 'desc',
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
  });

  res.status(200).json({
    status: 'success',
    data: {
      totalAttempts: stats._count.id,
      averages: {
        mcqScore: stats._avg.mcqScore,
        mcqPercentage: stats._avg.mcqPercentage,
        percentageScore: stats._avg.percentageScore,
        totalTimeSpent: stats._avg.totalTimeSpent,
      },
      statusCounts,
      recentAttempts,
    },
  });
});

/**
 * Get all users who have taken exams (admin only)
 */
export const getExamUsers = asyncHandler(async (req: Request, res: Response) => {
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
        where: {
          status: 'GRADED',
        },
        orderBy: {
          submittedAt: 'desc',
        },
        take: 1,
        select: {
          mcqScore: true,
          mcqPercentage: true,
          submittedAt: true,
          attemptNumber: true,
        },
      },
    },
    orderBy: {
      fullExamAttempts: {
        _count: 'desc',
      },
    },
  });

  res.status(200).json({
    status: 'success',
    data: { users },
  });
});