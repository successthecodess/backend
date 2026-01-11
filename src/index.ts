import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { initSecrets } from './config/secrets.js';
import { initRateLimiter, authRateLimiter, createApiRateLimiter } from './middleware/rateLimiter.js';
import { startCleanupScheduler } from './jobs/cleanup.js';
import authRoutes from './routes/authRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import insightsRoutes from './routes/insightsRoutes.js';
import practiceRoutes from './routes/practiceRoutes.js';
import questionRoutes from './routes/questionRoutes.js';

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

    // Routes - SPECIFIC routes BEFORE general routes!
   
    app.use('/api/auth', authRoutes);
    app.use('/api/admin', adminRoutes); 
    app.use('/api/insights', insightsRoutes);
    app.use('/api/practice', practiceRoutes);
    app.use('/api/question', questionRoutes);

    // Debug logging
    console.log('\n🔍 Registered Routes:');
    app._router.stack.forEach((middleware: any) => {
      if (middleware.route) {
        const methods = Object.keys(middleware.route.methods).join(',').toUpperCase();
        console.log(`  ${methods} ${middleware.route.path}`);
      } else if (middleware.name === 'router' && middleware.regexp) {
        const pathRegex = middleware.regexp.toString();
        console.log(`  Router: ${pathRegex}`);
        
        if (middleware.handle && middleware.handle.stack) {
          middleware.handle.stack.forEach((handler: any) => {
            if (handler.route) {
              const methods = Object.keys(handler.route.methods).join(',').toUpperCase();
              console.log(`    ${methods} ${handler.route.path}`);
            }
          });
        }
      }
    });
    console.log('\n');

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
  process.exit(0);
});

startServer();