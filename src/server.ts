import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import unitRoutes from './routes/unitRoutes.js';
import questionRoutes from './routes/questionRoutes.js';
import adminFullExamRoutes from './routes/adminFullExam.js';
import authRoutes from './routes/authRoutes.js';
import practiceRoutes from './routes/practiceRoutes.js';
import progressRoutes from './routes/progressRoutes.js'; 
import adminPracticeTestRoutes from './routes/adminPracticeTests.js';
import insightsRoutes from './routes/insightsRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import analyticsRoutes from './routes/analyticsRoutes.js';
import settingsRoutes from './routes/settingsRoutes.js';
import { errorHandler } from './middleware/errorHandler.js';
import freeTrialRoutes from './routes/freeTrialRoutes.js';
import adminExamBankRoutes from './routes/adminExamBankRoutes.js';
import fullExamRoutes from './routes/fullExamRoutes.js';
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", process.env.FRONTEND_URL || 'http://localhost:3000'],
    },
  },
  crossOriginEmbedderPolicy: false, // Allow embedding for API responses
}));

// CORS middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
}));

// Body parser
app.use(express.json({ limit: '10mb' }));

// Routes
app.use('/api/units', unitRoutes);
app.use('/api/questions', questionRoutes);
app.use('/api/practice', practiceRoutes);
app.use('/api/progress', progressRoutes);  
app.use('/api/insights', insightsRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/free-trial', freeTrialRoutes);
app.use('/api/admin/exam-bank', adminExamBankRoutes);
app.use('/api/full-exam', fullExamRoutes);
app.use('/api/admin/full-exams', adminFullExamRoutes);
app.use('/api/admin/practice-tests', adminPracticeTestRoutes);
// Error handler
app.use(errorHandler);

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`📡 Health check: http://localhost:${PORT}/health`);
});