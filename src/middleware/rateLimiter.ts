import { Request, Response, NextFunction } from 'express';
import { RateLimiterRedis, RateLimiterMemory } from 'rate-limiter-flexible';
import { getRedisClient } from '../config/redis.js';

let authLimiter: RateLimiterRedis | RateLimiterMemory;

// Initialize rate limiter
export function initRateLimiter() {
  try {
    const redis = getRedisClient();
    
    authLimiter = new RateLimiterRedis({
      storeClient: redis,
      keyPrefix: 'rl:auth',
      points: 5, // 5 requests
      duration: 60, // per 60 seconds
      blockDuration: 60 * 15, // block for 15 minutes
    });
    
    console.log('✅ Rate limiter initialized with Redis');
  } catch (error) {
    console.warn('⚠️ Redis unavailable, using in-memory rate limiter');
    
    // Fallback to memory (not recommended for production with multiple instances)
    authLimiter = new RateLimiterMemory({
      keyPrefix: 'rl:auth',
      points: 5,
      duration: 60,
      blockDuration: 60 * 15,
    });
  }
}

export const authRateLimiter = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    await authLimiter.consume(key);
    next();
  } catch (error: any) {
    const retryAfter = Math.ceil(error.msBeforeNext / 1000) || 900;
    
    res.set('Retry-After', String(retryAfter));
    res.status(429).json({
      error: 'Too many authentication attempts. Please try again later.',
      retryAfter,
    });
  }
};

// More lenient rate limiter for general API
export function createApiRateLimiter(points: number = 100, duration: number = 60) {
  let limiter: RateLimiterRedis | RateLimiterMemory;
  
  try {
    const redis = getRedisClient();
    limiter = new RateLimiterRedis({
      storeClient: redis,
      keyPrefix: 'rl:api',
      points,
      duration,
    });
  } catch (error) {
    limiter = new RateLimiterMemory({
      keyPrefix: 'rl:api',
      points,
      duration,
    });
  }

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const key = req.ip || req.socket.remoteAddress || 'unknown';
      await limiter.consume(key);
      next();
    } catch (error: any) {
      res.status(429).json({
        error: 'Rate limit exceeded. Please slow down.',
      });
    }
  };
}