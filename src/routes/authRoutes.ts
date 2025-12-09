import { Router } from 'express';
import axios from 'axios';
import jwt from 'jsonwebtoken';
import prisma from '../config/database.js';

const router = Router();

const GHL_AUTH_URL = 'https://marketplace.gohighlevel.com/oauth/chooselocation';
const GHL_TOKEN_URL = 'https://services.leadconnectorhq.com/oauth/token';
const GHL_API_BASE = 'https://services.leadconnectorhq.com';

// Step 1: Initiate OAuth flow (CHANGED from /ghl/login to /oauth/login)
router.get('/oauth/login', (req, res) => {
  console.log('🔍 Redirect URI:', process.env.GHL_REDIRECT_URI);
  
  const params = new URLSearchParams({
    response_type: 'code',
    redirect_uri: process.env.GHL_REDIRECT_URI!,
    client_id: process.env.GHL_CLIENT_ID!,
    scope: 'contacts.readonly users.readonly',
  });

  const authUrl = `${GHL_AUTH_URL}?${params}`;
  console.log('🔗 Auth URL:', authUrl);
  
  res.json({ authUrl });
});

// Step 2: Handle OAuth callback (CHANGED from /ghl/callback to /oauth/callback)
router.get('/oauth/callback', async (req, res) => {
  const { code } = req.query;

  if (!code) {
    return res.redirect(`${process.env.FRONTEND_URL}/login?error=no_code`);
  }

  try {
    // Exchange authorization code for access token
    const tokenResponse = await axios.post(
      GHL_TOKEN_URL,
      new URLSearchParams({
        client_id: process.env.GHL_CLIENT_ID!,
        client_secret: process.env.GHL_CLIENT_SECRET!,
        grant_type: 'authorization_code',
        code: code as string,
        redirect_uri: process.env.GHL_REDIRECT_URI!,
      }),
      {
        headers: { 
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json'
        }
      }
    );

    const { 
      access_token, 
      refresh_token, 
      expires_in,
      locationId,
      companyId,
      userId: ghlUserId 
    } = tokenResponse.data;

    console.log('✅ Access Token received');

    // Fetch user/contact data
    const userDataResponse = await axios.get(
      `${GHL_API_BASE}/users/${ghlUserId}`,
      {
        headers: {
          'Authorization': `Bearer ${access_token}`,
          'Version': '2021-07-28'
        }
      }
    );

    const ghlUser = userDataResponse.data;
    console.log('✅ User Data:', ghlUser);

    // Find or create user in database
    let user = await prisma.user.findUnique({
      where: { ghlUserId }
    });

    if (!user) {
      user = await prisma.user.create({
        data: {
          ghlUserId,
          email: ghlUser.email,
          name: ghlUser.name || `${ghlUser.firstName} ${ghlUser.lastName}`,
          ghlAccessToken: access_token,
          ghlRefreshToken: refresh_token,
          ghlTokenExpiry: new Date(Date.now() + expires_in * 1000),
          ghlLocationId: locationId,
          ghlCompanyId: companyId,
        }
      });
      console.log('✅ New user created:', user.id);
    } else {
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          ghlAccessToken: access_token,
          ghlRefreshToken: refresh_token,
          ghlTokenExpiry: new Date(Date.now() + expires_in * 1000),
          email: ghlUser.email,
          name: ghlUser.name || user.name,
        }
      });
      console.log('✅ User updated:', user.id);
    }

    // Create JWT token for YOUR app
    const appToken = jwt.sign(
      { 
        userId: user.id,
        email: user.email,
        ghlUserId: user.ghlUserId 
      },
      process.env.JWT_SECRET!,
      { expiresIn: '7d' }
    );

    // Redirect to frontend with token
    res.redirect(
      `${process.env.FRONTEND_URL}/auth/callback?token=${appToken}`
    );

  } catch (error: any) {
    console.error('❌ OAuth error:', error.response?.data || error.message);
    res.redirect(
      `${process.env.FRONTEND_URL}/login?error=auth_failed`
    );
  }
});

// Step 3: Sync progress back (CHANGED from /ghl/sync-progress to /oauth/sync-progress)
router.post('/oauth/sync-progress', async (req, res) => {
  const { userId, progressData } = req.body;

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user || !user.ghlAccessToken) {
      return res.status(404).json({ error: 'User not found or not connected' });
    }

    // Check if token is expired and refresh if needed
    let accessToken = user.ghlAccessToken;
    if (user.ghlTokenExpiry && new Date() >= user.ghlTokenExpiry) {
      accessToken = await refreshToken(user.id, user.ghlRefreshToken!);
    }

    // Update custom fields in contact
    await axios.put(
      `${GHL_API_BASE}/contacts/${user.ghlUserId}`,
      {
        customFields: {
          'total_questions_answered': progressData.totalQuestions,
          'accuracy_percentage': progressData.accuracy,
          'current_streak': progressData.streak,
          'last_practice_date': new Date().toISOString(),
        }
      },
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Version': '2021-07-28'
        }
      }
    );

    res.json({ success: true, message: 'Progress synced to Tutor Boss' });

  } catch (error: any) {
    console.error('❌ Failed to sync progress:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to sync progress' });
  }
});

// Helper function to refresh token
async function refreshToken(userId: string, refreshToken: string): Promise<string> {
  const response = await axios.post(
    GHL_TOKEN_URL,
    new URLSearchParams({
      client_id: process.env.GHL_CLIENT_ID!,
      client_secret: process.env.GHL_CLIENT_SECRET!,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
    {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    }
  );

  const { access_token, refresh_token, expires_in } = response.data;

  // Update tokens in database
  await prisma.user.update({
    where: { id: userId },
    data: {
      ghlAccessToken: access_token,
      ghlRefreshToken: refresh_token,
      ghlTokenExpiry: new Date(Date.now() + expires_in * 1000),
    }
  });

  return access_token;
}

export default router;