import { Router } from 'express';
import { progressController } from '../controllers/progressController.js';

const router = Router();

// Existing routes
router.get('/:userId/:unitId', progressController.getUserProgress);
router.get('/insights/:userId/:unitId', progressController.getLearningInsights);

// NEW: Dashboard endpoints
router.get('/dashboard/:userId/overview', progressController.getDashboardOverview);
router.get('/dashboard/:userId/performance-history', progressController.getPerformanceHistory);
router.get('/dashboard/:userId/streaks', progressController.getStreaks);
router.get('/dashboard/:userId/achievements', progressController.getAchievements);

export default router;