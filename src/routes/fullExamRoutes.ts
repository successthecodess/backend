import express from 'express';
import {
  startFullExam,
  submitMCQAnswer,
  submitFRQAnswer,
  getExamAttempt,
  flagMCQForReview,
  submitFullExam,
   getExamResults
} from '../controllers/fullExamController.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

// All routes require authentication
router.use(requireAuth);

// Full exam routes
router.post('/start', startFullExam);
router.post('/mcq/submit', submitMCQAnswer);
router.post('/frq/submit', submitFRQAnswer);
router.post('/mcq/flag', flagMCQForReview);
router.post('/submit', submitFullExam);
router.get('/:examAttemptId', getExamAttempt);
router.get('/:examAttemptId/results', getExamResults);
export default router;