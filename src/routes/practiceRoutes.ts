import express from 'express';
import {
  startPracticeSession,
  getNextQuestion,
  submitAnswer,
  endPracticeSession,
  getSessionAnswers
  
} from '../controllers/practiceController.js';
import { authenticate } from '../middleware/auth.js';
const router = express.Router();
router.use(authenticate);
router.post('/start', startPracticeSession);
router.post('/next', getNextQuestion);
router.post('/submit', submitAnswer);
router.post('/end/:sessionId', endPracticeSession);  
router.get('/session/:sessionId/answers', getSessionAnswers);
export default router;