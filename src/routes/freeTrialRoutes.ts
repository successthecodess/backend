import { Router } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import {
  checkFreeTrialStatus,
  startFreeTrial,
  getFreeTrialQuestion,
  submitFreeTrialAnswer,
  endFreeTrial,
} from '../controllers/freeTrialController.js';

const router = Router();

// All routes require authentication
router.use(authenticateToken);

// Check if user has used free trial
router.get('/status/:userId', checkFreeTrialStatus);

// Start free trial session
router.post('/start', startFreeTrial);

// Get specific question in trial
router.get('/question/:sessionId/:questionNumber', getFreeTrialQuestion);

// Submit answer
router.post('/answer', submitFreeTrialAnswer);

// End trial
router.post('/end/:sessionId', endFreeTrial);

export default router;