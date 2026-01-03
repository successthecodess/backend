import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { initSecrets } from './config/secrets.js';
import { initRateLimiter, authRateLimiter, createApiRateLimiter } from './middleware/rateLimiter.js';
import { startCleanupScheduler } from './jobs/cleanup.js';
import authRoutes from './routes/authRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
// ... other imports

const app = express();

async function startServer() {
  try {
    // 1. Initialize secrets first
    await initSecrets();
    console.log('✅ Secrets initialized');

    // 2. Initialize rate limiter
    initRateLimiter();
    console.log('✅ Rate limiter initialized');

    // 3. Start cleanup scheduler
    startCleanupScheduler();
    console.log('✅ Cleanup scheduler started');

    // Security middleware
    app.use(helmet());
    app.use(cors({
      origin: process.env.FRONTEND_URL || 'http://localhost:3000',
      credentials: true,
    }));
    app.use(express.json());

    // Rate limiting
    app.use('/api/auth/login', authRateLimiter);
    app.use('/api/auth/signup', authRateLimiter);
    app.use('/api/auth/oauth/login', authRateLimiter);
    app.use('/api', createApiRateLimiter(100, 60));

    // Routes
    app.use('/api/auth', authRoutes);
    app.use('/api/admin', adminRoutes);
    // ... other routes

    // Start server
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully...');
  // Close Redis, database connections, etc.
  process.exit(0);
});

startServer();