import express from 'express';
import {
  getAllExamAttempts,
  getExamAttemptDetails,
  getStudentExamHistory,
  getExamStatistics,
  getExamUsers,
} from '../controllers/adminFullExamController.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

// All routes require admin authentication
router.use(authenticateToken);
router.use(requireAdmin);

// Admin routes - all specific paths, no conflicts
router.get('/attempts', getAllExamAttempts);
router.get('/statistics', getExamStatistics);
router.get('/users', getExamUsers);
router.get('/attempts/:examAttemptId', getExamAttemptDetails);
router.get('/users/:userId/history', getStudentExamHistory);

export default router;