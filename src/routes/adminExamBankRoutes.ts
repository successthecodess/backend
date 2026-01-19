import express from 'express';
import {
  getExamUnits,
  getExamBankQuestions,
  createFRQQuestion,
  updateExamBankQuestion,
  deleteExamBankQuestion,
  getQuestionCounts,
} from '../controllers/adminExamBankController.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

// All routes require admin authentication
router.use(requireAuth, requireAdmin);

// Exam units
router.get('/units', getExamUnits);

// Exam bank questions
router.get('/questions', getExamBankQuestions);
router.get('/questions/counts', getQuestionCounts);
router.post('/questions/frq', createFRQQuestion);
router.put('/questions/:questionId', updateExamBankQuestion);
router.delete('/questions/:questionId', deleteExamBankQuestion);

export default router;