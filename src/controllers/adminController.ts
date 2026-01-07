import { Request, Response } from 'express';
import prisma from '../config/database.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { AuditLogger, AuditAction } from '../utils/auditLogger.js';
import csv from 'csv-parser';
import { Readable } from 'stream';


export const deleteUser = asyncHandler(async (req: Request, res: Response) => {
  const { userId } = req.params;
  const adminId = (req as any).user.userId;

  // Get user info before deletion for audit log
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      isAdmin: true,
    },
  });

  if (!user) {
    throw new AppError('User not found', 404);
  }

  // Prevent deleting admin users
  if (user.isAdmin || user.role === 'ADMIN') {
    throw new AppError('Cannot delete admin users', 403);
  }

  // Prevent self-deletion
  if (userId === adminId) {
    throw new AppError('Cannot delete your own account', 403);
  }

  // Delete user and all associated data
  // Prisma will cascade delete based on schema relationships
  await prisma.user.delete({
    where: { id: userId },
  });

  // Log the deletion
  await AuditLogger.logAdminAction(
    AuditAction.USER_DELETE,
    adminId,
    `user:${userId}`,
    true,
    {
      deletedUser: {
        email: user.email,
        name: user.name,
        role: user.role,
      },
      reason: 'Deleted from portal - user can sign up fresh',
    }
  );

  res.json({
    success: true,
    message: `User ${user.email} deleted successfully from portal`,
  });
});
export const getAdminStats = asyncHandler(async (req: Request, res: Response) => {
  const [totalQuestions, approvedQuestions, totalAttempts] = await Promise.all([
    prisma.question.count(),
    prisma.question.count({ where: { approved: true } }),
    prisma.questionResponse.count(),
  ]);

  const pendingQuestions = totalQuestions - approvedQuestions;

  res.status(200).json({
    status: 'success',
    data: {
      totalQuestions,
      approvedQuestions,
      pendingQuestions,
      totalAttempts,
    },
  });
});

export const getAllQuestions = asyncHandler(async (req: Request, res: Response) => {
  const questions = await prisma.question.findMany({
    include: {
      unit: true,
      topic: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  res.status(200).json({
    status: 'success',
    data: { questions },
  });
});

export const getQuestion = asyncHandler(async (req: Request, res: Response) => {
  const { questionId } = req.params;

  console.log('📝 Getting question:', questionId);

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

  res.status(200).json({
    status: 'success',
    data: { question },
  });
});

export const createQuestion = asyncHandler(async (req: Request, res: Response) => {
  const {
    unitId,
    topicId,
    difficulty,
    type,
    questionText,
    options,
    correctAnswer,
    explanation,
    approved,
  } = req.body;

  if (!unitId || !questionText || !options || !correctAnswer || !explanation) {
    throw new AppError('Missing required fields', 400);
  }

  // Handle empty or 'none' topicId - convert to null
  let finalTopicId = null;
  if (topicId && topicId !== 'none' && topicId !== '') {
    finalTopicId = topicId;
  }

  console.log('Creating question with:', { unitId, topicId: finalTopicId });

  const question = await prisma.question.create({
    data: {
      unitId,
      topicId: finalTopicId,
      difficulty,
      type,
      questionText,
      options,
      correctAnswer,
      explanation,
      approved: approved ?? true,
      aiGenerated: false,
    },
    include: {
      unit: true,
      topic: true,
    },
  });

  // Audit log
  const userId = (req as any).user?.userId;
  if (userId) {
    await AuditLogger.logAdminAction(
      AuditAction.USER_CREATE,
      userId,
      `question:${question.id}`,
      true,
      { unitId, difficulty, type }
    );
  }

  res.status(201).json({
    status: 'success',
    data: { question },
  });
});

export const updateQuestion = asyncHandler(async (req: Request, res: Response) => {
  const { questionId } = req.params;
  const updateData = { ...req.body };

  // Handle empty or 'none' topicId - convert to null
  if (updateData.topicId === 'none' || updateData.topicId === '' || !updateData.topicId) {
    updateData.topicId = null;
  }

  // Remove any undefined values
  Object.keys(updateData).forEach(key => {
    if (updateData[key] === undefined) {
      delete updateData[key];
    }
  });

  console.log('Updating question with data:', { questionId, topicId: updateData.topicId });

  const question = await prisma.question.update({
    where: { id: questionId },
    data: updateData,
    include: {
      unit: true,
      topic: true,
    },
  });

  // Audit log
  const userId = (req as any).user?.userId;
  if (userId) {
    await AuditLogger.logAdminAction(
      AuditAction.USER_UPDATE,
      userId,
      `question:${questionId}`,
      true,
      { updatedFields: Object.keys(updateData) }
    );
  }

  res.status(200).json({
    status: 'success',
    data: { question },
  });
});

export const deleteQuestion = asyncHandler(async (req: Request, res: Response) => {
  const { questionId } = req.params;

  await prisma.question.delete({
    where: { id: questionId },
  });

  // Audit log
  const userId = (req as any).user?.userId;
  if (userId) {
    await AuditLogger.logAdminAction(
      AuditAction.USER_DELETE,
      userId,
      `question:${questionId}`,
      true
    );
  }

  res.status(200).json({
    status: 'success',
    message: 'Question deleted successfully',
  });
});

export const approveQuestion = asyncHandler(async (req: Request, res: Response) => {
  const { questionId } = req.params;
  const { approved } = req.body;

  const question = await prisma.question.update({
    where: { id: questionId },
    data: { approved },
  });

  // Audit log
  const userId = (req as any).user?.userId;
  if (userId) {
    await AuditLogger.logAdminAction(
      AuditAction.USER_UPDATE,
      userId,
      `question:${questionId}`,
      true,
      { action: 'approve', approved }
    );
  }

  res.status(200).json({
    status: 'success',
    data: { question },
  });
});

export const bulkUploadQuestions = asyncHandler(async (req: Request, res: Response) => {
  if (!req.file) {
    throw new AppError('No file uploaded', 400);
  }

  const userId = (req as any).user?.userId;
  const results: any[] = [];
  const errors: any[] = [];

  // Parse CSV
  const stream = Readable.from(req.file.buffer.toString());
  
  stream
    .pipe(csv())
    .on('data', (row) => {
      console.log('CSV Row:', row); // Debug log
      results.push(row);
    })
    .on('end', async () => {
      console.log(`Processing ${results.length} rows`);
      let successCount = 0;
      let failCount = 0;

      for (let i = 0; i < results.length; i++) {
        const row = results[i];
        
        try {
          // Validate row data
          if (!row['Unit Number']) {
            throw new Error('Unit Number is required');
          }

          const unitNumber = parseInt(row['Unit Number']);
          
          if (isNaN(unitNumber)) {
            throw new Error(`Invalid Unit Number: ${row['Unit Number']}`);
          }

          // Find unit
          const unit = await prisma.unit.findFirst({
            where: { unitNumber },
          });

          if (!unit) {
            throw new Error(`Unit ${unitNumber} not found`);
          }

          // Find or create topic
          let topic = null;
          if (row['Topic Name'] && row['Topic Name'].trim()) {
            topic = await prisma.topic.findFirst({
              where: {
                name: row['Topic Name'].trim(),
                unitId: unit.id,
              },
            });

            if (!topic) {
              topic = await prisma.topic.create({
                data: {
                  name: row['Topic Name'].trim(),
                  unitId: unit.id,
                  isActive: true,
                },
              });
            }
          }

          // Validate required fields
          if (!row['Question Text'] || !row['Question Text'].trim()) {
            throw new Error('Question Text is required');
          }
          if (!row['Correct Answer'] || !row['Correct Answer'].trim()) {
            throw new Error('Correct Answer is required');
          }
          if (!row['Explanation'] || !row['Explanation'].trim()) {
            throw new Error('Explanation is required');
          }

          // Create options array
          const options = [
            row['Option 1'],
            row['Option 2'],
            row['Option 3'],
            row['Option 4'],
          ].filter((opt) => opt && opt.trim());

          if (options.length < 2) {
            throw new Error('At least 2 options are required');
          }

          // Validate correct answer exists in options
          const normalizedOptions = options.map(opt => opt.trim());
          const normalizedCorrect = row['Correct Answer'].trim();
          
          if (!normalizedOptions.includes(normalizedCorrect)) {
            throw new Error(`Correct answer "${normalizedCorrect}" not found in options`);
          }

          // Validate difficulty
          const difficulty = row['Difficulty']?.toUpperCase() || 'MEDIUM';
          const validDifficulties = ['EASY', 'MEDIUM', 'HARD'];
          if (!validDifficulties.includes(difficulty)) {
            throw new Error(`Invalid difficulty: ${row['Difficulty']}. Must be one of: ${validDifficulties.join(', ')}`);
          }

          // Validate type
          const type = row['Type']?.toUpperCase().replace(/\s+/g, '_') || 'MULTIPLE_CHOICE';
          const validTypes = ['MULTIPLE_CHOICE', 'TRUE_FALSE', 'CODE_ANALYSIS', 'FREE_RESPONSE', 'CODE_COMPLETION'];
          if (!validTypes.includes(type)) {
            throw new Error(`Invalid type: ${row['Type']}. Must be one of: ${validTypes.join(', ')}`);
          }

          // Create question
          await prisma.question.create({
            data: {
              unitId: unit.id,
              topicId: topic?.id || null,
              questionText: row['Question Text'].trim(),
              options: normalizedOptions,
              correctAnswer: normalizedCorrect,
              explanation: row['Explanation'].trim(),
              difficulty: difficulty as any,
              type: type as any,
              approved: true,
              aiGenerated: false,
            },
          });

          successCount++;
          console.log(`✅ Row ${i + 2}: Question created successfully`);
        } catch (error: any) {
          failCount++;
          console.error(`❌ Row ${i + 2}: ${error.message}`);
          errors.push({
            row: i + 2, // +2 because CSV is 1-indexed and has header
            message: error.message,
          });
        }
      }

      console.log(`Bulk upload complete: ${successCount} success, ${failCount} failed`);

      // Audit log the bulk upload
      if (userId) {
        await AuditLogger.logAdminAction(
          AuditAction.EXPORT_DATA,
          userId,
          'bulk-upload',
          true,
          {
            totalRows: results.length,
            successCount,
            failCount,
            fileName: req.file?.originalname,
          }
        );
      }

      res.status(200).json({
        status: 'success',
        data: {
          success: successCount,
          failed: failCount,
          errors: errors.slice(0, 20), // Limit to first 20 errors
        },
      });
    })
    .on('error', async (error) => {
      console.error('CSV parsing error:', error);
      
      // Audit log the failure
      if (userId) {
        await AuditLogger.logAdminAction(
          AuditAction.EXPORT_DATA,
          userId,
          'bulk-upload',
          false,
          { error: error.message }
        );
      }
      
      throw new AppError('Failed to parse CSV file', 400);
    });
});