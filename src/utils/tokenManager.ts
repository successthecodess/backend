import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import prisma from '../config/database.js';
import { getSecrets } from '../config/secrets.js';

export interface TokenPayload {
  userId: string;
  email: string;
}

// Cache the JWT secret to avoid repeated AWS calls
let jwtSecretCache: string | null = null;

async function getJwtSecret(): Promise<string> {
  if (jwtSecretCache) {
    return jwtSecretCache;
  }

  const secrets = await getSecrets();
  jwtSecretCache = secrets.JWT_SECRET;
  return jwtSecretCache;
}

// Hash refresh token before storing (like passwords)
async function hashRefreshToken(token: string): Promise<string> {
  return bcrypt.hash(token, 10);
}

// Verify refresh token against stored hash
async function verifyRefreshToken(token: string, hash: string): Promise<boolean> {
  return bcrypt.compare(token, hash);
}

export async function generateTokenPair(userId: string, email: string) {
  const jwtSecret = await getJwtSecret();

  // Short-lived access token (15 minutes)
  const accessToken = jwt.sign(
    { userId, email } as TokenPayload,
    jwtSecret,
    { expiresIn: '15m' }
  );

  // Long-lived refresh token (30 days)
  const refreshToken = crypto.randomBytes(40).toString('hex');
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  // Hash the refresh token before storing (security best practice)
  const hashedToken = await hashRefreshToken(refreshToken);

  // Store hashed refresh token in database
  await prisma.refreshToken.create({
    data: {
      token: hashedToken,
      userId,
      expiresAt,
    },
  });

  return { accessToken, refreshToken };
}

export async function verifyAccessToken(token: string): Promise<TokenPayload> {
  const jwtSecret = await getJwtSecret();
  const decoded = jwt.verify(token, jwtSecret) as TokenPayload;
  return decoded;
}

export async function refreshAccessToken(refreshToken: string) {
  // Find all non-expired tokens for comparison (tokens are hashed)
  const storedTokens = await prisma.refreshToken.findMany({
    where: {
      expiresAt: { gt: new Date() },
    },
    include: { user: true },
  });

  // Find matching token by comparing hashes
  let matchedToken = null;
  for (const stored of storedTokens) {
    const isMatch = await verifyRefreshToken(refreshToken, stored.token);
    if (isMatch) {
      matchedToken = stored;
      break;
    }
  }

  if (!matchedToken) {
    throw new Error('Invalid refresh token');
  }

  // Generate new access token
  const jwtSecret = await getJwtSecret();
  const accessToken = jwt.sign(
    {
      userId: matchedToken.user.id,
      email: matchedToken.user.email,
    } as TokenPayload,
    jwtSecret,
    { expiresIn: '15m' }
  );

  return { accessToken, user: matchedToken.user };
}

export async function revokeRefreshToken(token: string) {
  // Find and delete matching hashed token
  const storedTokens = await prisma.refreshToken.findMany();

  for (const stored of storedTokens) {
    const isMatch = await verifyRefreshToken(token, stored.token);
    if (isMatch) {
      await prisma.refreshToken.delete({
        where: { id: stored.id },
      });
      return;
    }
  }
}

export async function revokeAllUserTokens(userId: string) {
  await prisma.refreshToken.deleteMany({
    where: { userId },
  });
}

// Cleanup expired tokens (run this periodically)
export async function cleanupExpiredTokens() {
  const result = await prisma.refreshToken.deleteMany({
    where: {
      expiresAt: {
        lt: new Date(),
      },
    },
  });
  
  console.log(`🧹 Cleaned up ${result.count} expired refresh tokens`);
  return result.count;
}