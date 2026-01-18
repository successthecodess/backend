import { Request, Response } from 'express';
import prisma from '../config/database.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';

// In-memory cache for units
let unitsCache: { data: any; timestamp: number } | null = null;
const UNITS_CACHE_TTL = 60 * 1000; // 1 minute

export const getUnits = asyncHandler(async (req: Request, res: Response) => {
  // Check cache first
  if (unitsCache && Date.now() - unitsCache.timestamp < UNITS_CACHE_TTL) {
    return res.status(200).json({
      status: 'success',
      data: unitsCache.data,
    });
  }

  // Single optimized query with aggregation (no N+1 problem)
  const units = await prisma.unit.findMany({
    where: { isActive: true },
    select: {
      id: true,
      unitNumber: true,
      name: true,
      description: true,
      color: true,
      icon: true,
      topics: {
        where: { isActive: true },
        orderBy: { orderIndex: 'asc' },
        select: {
          id: true,
          name: true,
          description: true,
          orderIndex: true,
        },
      },
      _count: {
        select: {
          questions: {
            where: { approved: true, isActive: true },
          },
        },
      },
    },
    orderBy: { unitNumber: 'asc' },
  });

  const formattedUnits = units.map(unit => ({
    id: unit.id,
    unitNumber: unit.unitNumber,
    name: unit.name,
    description: unit.description,
    color: unit.color || 'bg-indigo-500',
    icon: unit.icon || 'BookOpen',
    topics: unit.topics,
    questionCount: unit._count.questions,
  }));

  // Update cache
  unitsCache = {
    data: { units: formattedUnits },
    timestamp: Date.now(),
  };

  res.status(200).json({
    status: 'success',
    data: { units: formattedUnits },
  });
});

export const getUnitById = asyncHandler(async (req: Request, res: Response) => {
  const { unitId } = req.params;

  // Single query with all needed data
  const unit = await prisma.unit.findUnique({
    where: { id: unitId },
    select: {
      id: true,
      unitNumber: true,
      name: true,
      description: true,
      color: true,
      icon: true,
      topics: {
        where: { isActive: true },
        orderBy: { orderIndex: 'asc' },
        select: {
          id: true,
          name: true,
          description: true,
          orderIndex: true,
        },
      },
      _count: {
        select: {
          questions: {
            where: { approved: true, isActive: true },
          },
        },
      },
    },
  });

  if (!unit) {
    throw new AppError('Unit not found', 404);
  }

  res.status(200).json({
    status: 'success',
    data: {
      ...unit,
      questionCount: unit._count.questions,
    },
  });
});

export const getTopicsByUnit = asyncHandler(async (req: Request, res: Response) => {
  const { unitId } = req.params;

  const topics = await prisma.topic.findMany({
    where: {
      unitId,
      isActive: true,
    },
    select: {
      id: true,
      name: true,
      description: true,
      orderIndex: true,
    },
    orderBy: { orderIndex: 'asc' },
  });

  res.status(200).json({
    status: 'success',
    data: { topics },
  });
});

// Call this when questions are added/updated/deleted to invalidate cache
export const invalidateUnitsCache = () => {
  unitsCache = null;
};