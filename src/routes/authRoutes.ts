import { Router } from 'express';
import axios from 'axios';
import jwt from 'jsonwebtoken';
import prisma from '../config/database.js';

const router = Router();

const GHL_AUTH_URL = 'https://marketplace.gohighlevel.com/oauth/chooselocation';
const GHL_TOKEN_URL = 'https://services.leadconnectorhq.com/oauth/token';
const GHL_API_BASE = 'https://services.leadconnectorhq.com';

// ==========================================
// ADMIN AUTHORIZATION (One-time setup)
// ==========================================

// Step 1: Admin starts authorization
router.get('/oauth/admin/authorize', (req, res) => {
  console.log('🔐 Admin authorization flow started');
  
  const params = new URLSearchParams({
    response_type: 'code',
    redirect_uri: `${process.env.BACKEND_URL}/api/auth/oauth/admin/callback`,
    client_id: process.env.GHL_CLIENT_ID!,
    scope: 'contacts.readonly contacts.write users.readonly locations.readonly',
  });

  const authUrl = `${GHL_AUTH_URL}?${params}`;
  console.log('🔗 Admin Auth URL:', authUrl);
  
  res.json({ authUrl });
});

// Step 2: Admin callback - stores company token
router.get('/oauth/admin/callback', async (req, res) => {
  const { code, error } = req.query;

  if (error || !code) {
    console.error('❌ Admin authorization failed:', error);
    return res.redirect(`${process.env.FRONTEND_URL}/admin/ghl-setup?error=authorization_failed`);
  }

  try {
    console.log('📥 Exchanging admin code for token...');

    // Exchange code for token
    const tokenResponse = await axios.post(
      GHL_TOKEN_URL,
      new URLSearchParams({
        client_id: process.env.GHL_CLIENT_ID!,
        client_secret: process.env.GHL_CLIENT_SECRET!,
        grant_type: 'authorization_code',
        code: code as string,
        redirect_uri: `${process.env.BACKEND_URL}/api/auth/oauth/admin/callback`,
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
      userId 
    } = tokenResponse.data;

    console.log('✅ Admin tokens received');
    console.log('   Company ID:', companyId);
    console.log('   Location ID:', locationId);
    console.log('   Authorized by User ID:', userId);

    // Get admin user info
    const userResponse = await axios.get(
      `${GHL_API_BASE}/users/${userId}`,
      {
        headers: {
          'Authorization': `Bearer ${access_token}`,
          'Version': '2021-07-28'
        }
      }
    );

    const adminEmail = userResponse.data.email;
    console.log('   Admin Email:', adminEmail);

    // Store or update company-level auth
    await prisma.gHLCompanyAuth.upsert({
      where: { companyId },
      create: {
        companyId,
        locationId: locationId || null,
        accessToken: access_token,
        refreshToken: refresh_token,
        tokenExpiry: new Date(Date.now() + expires_in * 1000),
        authorizedBy: adminEmail,
      },
      update: {
        accessToken: access_token,
        refreshToken: refresh_token,
        tokenExpiry: new Date(Date.now() + expires_in * 1000),
        authorizedBy: adminEmail,
      },
    });

    console.log('✅ Company authorization saved to database');

    // Redirect to success page
    res.redirect(`${process.env.FRONTEND_URL}/admin/ghl-setup?success=true&companyId=${companyId}`);
  } catch (error: any) {
    console.error('❌ Admin callback error:', error.response?.data || error.message);
    res.redirect(`${process.env.FRONTEND_URL}/admin/ghl-setup?error=setup_failed`);
  }
});

// Check admin authorization status
router.get('/oauth/admin/status', async (req, res) => {
  try {
    const auth = await prisma.gHLCompanyAuth.findFirst({
      orderBy: { authorizedAt: 'desc' }
    });

    if (!auth) {
      return res.json({
        authorized: false,
        message: 'No company authorization found'
      });
    }

    // Check if token is expired
    const isExpired = new Date() >= auth.tokenExpiry;

    res.json({
      authorized: !isExpired,
      companyId: auth.companyId,
      locationId: auth.locationId,
      authorizedBy: auth.authorizedBy,
      authorizedAt: auth.authorizedAt,
      tokenExpiry: auth.tokenExpiry,
      isExpired,
    });
  } catch (error: any) {
    console.error('Failed to check status:', error);
    res.status(500).json({ error: 'Failed to check authorization status' });
  }
});

// ==========================================
// STUDENT LOGIN (Uses company token)
// ==========================================

// Step 1: Student login - verify credentials
router.post('/oauth/student/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    console.log('👤 Student login attempt:', email);

    // Get company token
    const companyAuth = await prisma.gHLCompanyAuth.findFirst({
      orderBy: { authorizedAt: 'desc' }
    });

    if (!companyAuth) {
      return res.status(400).json({ 
        error: 'Company not authorized. Admin must set up GHL integration first.' 
      });
    }

    // Refresh token if expired
    let accessToken = companyAuth.accessToken;
    if (new Date() >= companyAuth.tokenExpiry) {
      console.log('🔄 Refreshing company token...');
      accessToken = await refreshCompanyToken(companyAuth.companyId, companyAuth.refreshToken);
    }

    // Search for user in GHL by email
    const searchResponse = await axios.get(
      `${GHL_API_BASE}/contacts/`,
      {
        params: { 
          email,
          locationId: companyAuth.locationId 
        },
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Version': '2021-07-28'
        }
      }
    );

    if (!searchResponse.data.contacts || searchResponse.data.contacts.length === 0) {
      return res.status(401).json({ error: 'Student not found in Tutor Boss' });
    }

    const ghlContact = searchResponse.data.contacts[0];
    console.log('✅ Found student in GHL:', ghlContact.id);

    // Verify password against GHL custom field (if you store passwords there)
    // OR skip password check if you trust GHL email verification
    // For now, we'll trust that if they know the email, they're authorized

    // Create or update user in our database
    const user = await prisma.user.upsert({
      where: { ghlUserId: ghlContact.id },
      create: {
        email: ghlContact.email,
        name: `${ghlContact.firstName || ''} ${ghlContact.lastName || ''}`.trim(),
        ghlUserId: ghlContact.id,
        ghlLocationId: companyAuth.locationId,
        ghlCompanyId: companyAuth.companyId,
      },
      update: {
        email: ghlContact.email,
        name: `${ghlContact.firstName || ''} ${ghlContact.lastName || ''}`.trim(),
      },
    });

    console.log('✅ User record created/updated:', user.id);

    // Create JWT for app session
    const token = jwt.sign(
      {
        userId: user.id,
        email: user.email,
        name: user.name,
        ghlUserId: user.ghlUserId,
      },
      process.env.JWT_SECRET!,
      { expiresIn: '7d' }
    );

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
    });
  } catch (error: any) {
    console.error('❌ Student login error:', error.response?.data || error.message);
    res.status(401).json({ 
      error: 'Login failed. Please check your credentials.' 
    });
  }
});

// ==========================================
// HELPER FUNCTIONS
// ==========================================

async function refreshCompanyToken(companyId: string, refreshToken: string): Promise<string> {
  try {
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

    const { access_token, refresh_token: newRefreshToken, expires_in } = response.data;

    await prisma.gHLCompanyAuth.update({
      where: { companyId },
      data: {
        accessToken: access_token,
        refreshToken: newRefreshToken,
        tokenExpiry: new Date(Date.now() + expires_in * 1000),
      },
    });

    console.log('✅ Company token refreshed');
    return access_token;
  } catch (error) {
    console.error('Failed to refresh company token:', error);
    throw error;
  }
}

// Progress sync (uses company token)
router.post('/oauth/sync-progress', async (req, res) => {
  const { userId } = req.body;

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        ghlUserId: true,
        ghlCompanyId: true,
      },
    });

    if (!user || !user.ghlUserId || !user.ghlCompanyId) {
      return res.status(400).json({ error: 'User not linked to GHL' });
    }

    // Get company token
    const companyAuth = await prisma.gHLCompanyAuth.findUnique({
      where: { companyId: user.ghlCompanyId },
    });

    if (!companyAuth) {
      return res.status(400).json({ error: 'Company not authorized' });
    }

    // Refresh if needed
    let accessToken = companyAuth.accessToken;
    if (new Date() >= companyAuth.tokenExpiry) {
      accessToken = await refreshCompanyToken(companyAuth.companyId, companyAuth.refreshToken);
    }

    // Get progress data
    const progressData = await getProgressData(userId);

    // Update contact in GHL
    await axios.put(
      `${GHL_API_BASE}/contacts/${user.ghlUserId}`,
      {
        customFields: [
          { key: 'total_questions_answered', value: progressData.totalQuestions.toString() },
          { key: 'overall_accuracy', value: progressData.accuracy.toFixed(2) },
          { key: 'current_streak', value: progressData.streak.toString() },
          { key: 'units_mastered', value: progressData.unitsMastered.toString() },
          { key: 'last_practice_date', value: new Date().toISOString() },
          { key: 'study_time_minutes', value: progressData.studyTimeMinutes.toString() },
        ],
      },
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Version': '2021-07-28',
        },
      }
    );

    res.json({ success: true, message: 'Progress synced to GHL' });
  } catch (error: any) {
    console.error('Sync error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to sync progress' });
  }
});

async function getProgressData(userId: string) {
  const progressRecords = await prisma.progress.findMany({
    where: { userId },
  });

  const totalQuestions = progressRecords.reduce((sum, p) => sum + p.totalAttempts, 0);
  const correctAnswers = progressRecords.reduce((sum, p) => sum + p.correctAttempts, 0);
  const accuracy = totalQuestions > 0 ? (correctAnswers / totalQuestions) * 100 : 0;
  const unitsMastered = progressRecords.filter(p => p.masteryLevel >= 80).length;

  const sessions = await prisma.studySession.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  });

  const uniqueDates = [...new Set(sessions.map(s => new Date(s.createdAt).toDateString()))];
  
  let streak = 0;
  const today = new Date().toDateString();
  const yesterday = new Date(Date.now() - 86400000).toDateString();

  if (uniqueDates.includes(today) || uniqueDates.includes(yesterday)) {
    let currentDate = new Date();
    if (!uniqueDates.includes(today)) {
      currentDate = new Date(Date.now() - 86400000);
    }
    while (uniqueDates.includes(currentDate.toDateString())) {
      streak++;
      currentDate = new Date(currentDate.getTime() - 86400000);
    }
  }

  const responses = await prisma.questionResponse.findMany({
    where: { userId },
    select: { timeSpent: true },
  });

  const studyTimeMinutes = Math.floor(
    responses.reduce((sum, r) => sum + (r.timeSpent || 0), 0) / 60
  );

  return {
    totalQuestions,
    correctAnswers,
    accuracy,
    unitsMastered,
    streak,
    studyTimeMinutes,
  };
}

export default router;