import { Request, Response, NextFunction } from 'express';
import { RateLimiterRedis, RateLimiterMemory } from 'rate-limiter-flexible';
import { getRedisClient } from '../config/redis.js';

let authLimiter: RateLimiterRedis | RateLimiterMemory;

/**
 * Get the real client IP address, handling proxies and load balancers
 * Checks X-Forwarded-For header first, then falls back to request IP
 */
function getClientIp(req: Request): string {
  // X-Forwarded-For can contain multiple IPs: "client, proxy1, proxy2"
  // The first one is the original client IP
  const forwardedFor = req.headers['x-forwarded-for'];
  if (forwardedFor) {
    const ips = (typeof forwardedFor === 'string' ? forwardedFor : forwardedFor[0]).split(',');
    const clientIp = ips[0].trim();
    // Validate it looks like an IP address (basic check)
    if (clientIp && clientIp !== 'unknown') {
      return clientIp;
    }
  }

  // Check X-Real-IP header (used by some proxies like nginx)
  const realIp = req.headers['x-real-ip'];
  if (realIp && typeof realIp === 'string') {
    return realIp.trim();
  }

  // Fall back to Express's req.ip or socket address
  return req.ip || req.socket.remoteAddress || 'unknown-client';
}

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
    const key = getClientIp(req);
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
      const key = getClientIp(req);
      await limiter.consume(key);
      next();
    } catch (error: any) {
      res.status(429).json({
        error: 'Rate limit exceeded. Please slow down.',
      });
    }
  };
}