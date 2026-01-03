import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import prisma from '../config/database.js';
import { getSecrets } from '../config/secrets.js';

export interface TokenPayload {
  userId: string;
  email: string;
}

export async function generateTokenPair(userId: string, email: string) {
  const secrets = await getSecrets();
  
  // Short-lived access token (15 minutes)
  const accessToken = jwt.sign(
    { userId, email } as TokenPayload,
    secrets.JWT_SECRET,
    { expiresIn: '15m' }
  );

  // Long-lived refresh token (30 days)
  const refreshToken = crypto.randomBytes(40).toString('hex');
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  // Store refresh token in database
  await prisma.refreshToken.create({
    data: {
      token: refreshToken,
      userId,
      expiresAt,
    },
  });

  return { accessToken, refreshToken };
}

export async function verifyAccessToken(token: string): Promise<TokenPayload> {
  const secrets = await getSecrets();
  const decoded = jwt.verify(token, secrets.JWT_SECRET) as TokenPayload;
  return decoded;
}

export async function refreshAccessToken(refreshToken: string) {
  // Find the refresh token
  const storedToken = await prisma.refreshToken.findUnique({
    where: { token: refreshToken },
    include: { user: true },
  });

  if (!storedToken) {
    throw new Error('Invalid refresh token');
  }

  if (storedToken.expiresAt < new Date()) {
    // Clean up expired token
    await prisma.refreshToken.delete({
      where: { id: storedToken.id },
    });
    throw new Error('Refresh token expired');
  }

  // Generate new access token
  const secrets = await getSecrets();
  const accessToken = jwt.sign(
    {
      userId: storedToken.user.id,
      email: storedToken.user.email,
    } as TokenPayload,
    secrets.JWT_SECRET,
    { expiresIn: '15m' }
  );

  return { accessToken, user: storedToken.user };
}

export async function revokeRefreshToken(token: string) {
  await prisma.refreshToken.delete({
    where: { token },
  });
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