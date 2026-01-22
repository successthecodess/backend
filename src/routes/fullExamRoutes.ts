import express from 'express';
import {
  startFullExam,
  submitMCQAnswer,
  submitFRQAnswer,
  getExamAttempt,
  flagMCQForReview,
  submitFullExam,
  getExamResults,
  debugExamAttempt
} from '../controllers/fullExamController.js';
import fullExamService from '../services/fullExamService.js';
import {
  getAllExamAttempts,
  getExamAttemptDetails,
  getStudentExamHistory,
  getExamStatistics,
  getExamUsers,
} from '../controllers/adminFullExamController.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

// All routes require authentication
router.use(requireAuth);

// Static routes FIRST (before parameterized routes)
router.post('/start', startFullExam);
router.post('/mcq/submit', submitMCQAnswer);
router.post('/frq/submit', submitFRQAnswer);
router.post('/mcq/flag', flagMCQForReview);
router.post('/submit', submitFullExam);

// Get exam statistics
router.get('/statistics', getExamStatistics);

// Get all users who have taken exams
router.get('/users', getExamUsers);

// Get all exam attempts
router.get('/attempts', getAllExamAttempts);

// User exam history (must be before /:examAttemptId)
router.get('/history/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    // Check if user is requesting their own history or is admin
    if (req.user?.userId !== userId && !req.user?.isAdmin) {
      return res.status(403).json({ 
        status: 'error',
        message: 'Unauthorized' 
      });
    }

    const attempts = await fullExamService.getUserExamHistory(userId);
    
    res.status(200).json({
      status: 'success',
      data: { attempts },
    });
  } catch (error) {
    console.error('Error fetching exam history:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch exam history',
    });
  }
});

// Get student exam history by userId
router.get('/users/:userId/history', getStudentExamHistory);

// Debug route
router.get('/debug/:examAttemptId', debugExamAttempt);

// Specific exam attempt details
router.get('/attempts/:examAttemptId', getExamAttemptDetails);

// Parameterized routes LAST
router.get('/:examAttemptId', getExamAttempt);
router.get('/:examAttemptId/results', getExamResults);

export default router;