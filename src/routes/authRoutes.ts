import { Router } from 'express';
import axios from 'axios';
import jwt from 'jsonwebtoken';
import prisma from '../config/database.js';

const router = Router();

const GHL_AUTH_URL = 'https://marketplace.gohighlevel.com/oauth/chooselocation';
const GHL_TOKEN_URL = 'https://services.leadconnectorhq.com/oauth/token';
const GHL_API_BASE = 'https://services.leadconnectorhq.com';

// ==========================================
// CACHE SETUP
// ==========================================

const contactCache = new Map<string, { contact: any; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// ==========================================
// HELPER FUNCTIONS
// ==========================================

async function refreshCompanyToken(companyId: string, refreshToken: string): Promise<string> {
  try {
    console.log('🔄 Refreshing token for company:', companyId);
    
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
    const expiryDate = new Date(Date.now() + (expires_in - 300) * 1000);

    await prisma.gHLCompanyAuth.update({
      where: { companyId },
      data: {
        accessToken: access_token,
        refreshToken: newRefreshToken,
        tokenExpiry: expiryDate,
      },
    });

    console.log('✅ Token refreshed successfully');
    
    return access_token;
  } catch (error: any) {
    console.error('❌ Token refresh failed:', error.response?.data || error.message);
    throw error;
  }
}
async function checkAndGrantAdminAccess(email: string, userId: string): Promise<boolean> {
  try {
    // Check if email is in admin list
    const adminEmail = await prisma.adminEmail.findUnique({
      where: { 
        email: email.toLowerCase(),
      },
    });

    if (adminEmail && adminEmail.isActive) {
      // Grant admin access
      await prisma.user.update({
        where: { id: userId },
        data: {
          isAdmin: true,
          isStaff: true,
          role: 'ADMIN',
          hasAccessToQuestionBank: true,
          hasAccessToTimedPractice: true,
          hasAccessToAnalytics: true,
        },
      });
      
      console.log('✅ Admin access granted to:', email);
      return true;
    }
    
    return false;
  } catch (error) {
    console.error('Failed to check admin access:', error);
    return false;
  }
}

async function getValidToken(companyAuth: any): Promise<string> {
  const now = new Date();
  const expiry = new Date(companyAuth.tokenExpiry);
  const hoursUntilExpiry = (expiry.getTime() - now.getTime()) / (1000 * 60 * 60);

  if (hoursUntilExpiry <= 2) {
    console.log('⏰ Token expiring soon, refreshing...');
    return await refreshCompanyToken(companyAuth.companyId, companyAuth.refreshToken);
  }

  return companyAuth.accessToken;
}

async function searchContactByEmailSequential(email: string, accessToken: string, locationId: string, companyId: string): Promise<any> {
  console.log('🔄 Sequential deep search (fallback)');
  
  // METHOD 1: Query parameter
  try {
    const queryResponse = await axios.get(
      `${GHL_API_BASE}/contacts/`,
      {
        params: {
          locationId: locationId,
          query: email,
          limit: 20,
        },
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Version': '2021-07-28'
        },
        timeout: 8000,
      }
    );

    if (queryResponse.data.contacts && queryResponse.data.contacts.length > 0) {
      const match = queryResponse.data.contacts.find((c: any) => 
        c.email?.toLowerCase() === email.toLowerCase()
      );

      if (match) {
        console.log('✅ Found via query (sequential)');
        return match;
      }
    }
  } catch (error: any) {
    console.log('⚠️ Query failed in sequential search');
  }

  // METHOD 2: Pagination
  try {
    for (let page = 0; page < 20; page++) {
      const listResponse = await axios.get(
        `${GHL_API_BASE}/contacts/`,
        {
          params: {
            locationId: locationId,
            limit: 100,
            skip: page * 100,
          },
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Version': '2021-07-28'
          },
          timeout: 8000,
        }
      );

      const contacts = listResponse.data.contacts || [];
      
      if (contacts.length === 0) break;

      const match = contacts.find((c: any) => 
        c.email?.toLowerCase() === email.toLowerCase()
      );

      if (match) {
        console.log(`✅ Found via pagination page ${page + 1}`);
        return match;
      }

      if (contacts.length < 100) break;
    }
  } catch (error: any) {
    console.log('⚠️ Pagination failed in sequential search');
  }

  // METHOD 3: Without location filter
  try {
    let startAfterId: string | undefined = undefined;
    
    for (let page = 0; page < 20; page++) {
      const params: any = { limit: 100 };
      if (startAfterId) params.startAfterId = startAfterId;

      const listResponse = await axios.get(
        `${GHL_API_BASE}/contacts/`,
        {
          params,
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Version': '2021-07-28'
          },
          timeout: 8000,
        }
      );

      const contacts = listResponse.data.contacts || [];
      if (contacts.length === 0) break;

      const match = contacts.find((c: any) => 
        c.email?.toLowerCase() === email.toLowerCase()
      );

      if (match) {
        console.log(`✅ Found without location filter page ${page + 1}`);
        return match;
      }

      if (contacts.length < 100) break;
      startAfterId = contacts[contacts.length - 1].id;
    }
  } catch (error: any) {
    console.log('⚠️ No-location search failed');
  }

  console.log('❌ Not found in sequential search');
  return null;
}

async function searchContactByEmailParallel(email: string, accessToken: string, locationId: string, companyId: string): Promise<any> {
  console.log('🚀 Parallel search started for:', email);
  const startTime = Date.now();
  
  // Launch all methods in parallel
  const searchPromises = [
    // Method 1: Query search (fastest)
    axios.get(`${GHL_API_BASE}/contacts/`, {
      params: { locationId, query: email, limit: 20 },
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Version': '2021-07-28' },
      timeout: 5000,
    }).then(res => ({
      method: 'query',
      contacts: res.data.contacts || [],
      success: true,
    })).catch(() => ({ 
      method: 'query', 
      contacts: [], 
      success: false 
    })),

    // Method 2: First page with location
    axios.get(`${GHL_API_BASE}/contacts/`, {
      params: { locationId, limit: 100, skip: 0 },
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Version': '2021-07-28' },
      timeout: 5000,
    }).then(res => ({
      method: 'page1-with-loc',
      contacts: res.data.contacts || [],
      success: true,
    })).catch(() => ({ 
      method: 'page1-with-loc', 
      contacts: [], 
      success: false 
    })),

    // Method 3: First page without location
    axios.get(`${GHL_API_BASE}/contacts/`, {
      params: { limit: 100 },
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Version': '2021-07-28' },
      timeout: 5000,
    }).then(res => ({
      method: 'page1-no-loc',
      contacts: res.data.contacts || [],
      success: true,
    })).catch(() => ({ 
      method: 'page1-no-loc', 
      contacts: [], 
      success: false 
    })),

    // Method 4: Second page with location (parallel)
    axios.get(`${GHL_API_BASE}/contacts/`, {
      params: { locationId, limit: 100, skip: 100 },
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Version': '2021-07-28' },
      timeout: 5000,
    }).then(res => ({
      method: 'page2-with-loc',
      contacts: res.data.contacts || [],
      success: true,
    })).catch(() => ({ 
      method: 'page2-with-loc', 
      contacts: [], 
      success: false 
    })),
  ];

  // Wait for all parallel requests to complete
  const results = await Promise.all(searchPromises);
  
  // Check all results for a match
  for (const result of results) {
    if (result.success && result.contacts.length > 0) {
      const match = result.contacts.find((c: any) => 
        c.email?.toLowerCase() === email.toLowerCase()
      );
      
      if (match) {
        const duration = Date.now() - startTime;
        console.log(`✅ FOUND via ${result.method} in ${duration}ms (parallel)`);
        return match;
      }
    }
  }

  const parallelDuration = Date.now() - startTime;
  console.log(`⚠️ Not found in parallel search (${parallelDuration}ms), trying deep search...`);
  
  // If not found in first pages, try sequential deep search
  return await searchContactByEmailSequential(email, accessToken, locationId, companyId);
}

async function searchContactByEmailCached(email: string, accessToken: string, locationId: string, companyId: string): Promise<any> {
  const cacheKey = `${email.toLowerCase()}-${locationId}`;
  
  // Check cache first
  const cached = contactCache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
    console.log('⚡ FOUND in cache (instant)');
    return cached.contact;
  }

  // Search using parallel method
  const contact = await searchContactByEmailParallel(email, accessToken, locationId, companyId);

  // Cache the result if found
  if (contact) {
    contactCache.set(cacheKey, { contact, timestamp: Date.now() });
    
    // Clean up old cache entries (keep cache size reasonable)
    if (contactCache.size > 1000) {
      const entries = Array.from(contactCache.entries());
      entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
      entries.slice(0, 500).forEach(([key]) => contactCache.delete(key));
    }
  }

  return contact;
}

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

// ==========================================
// DEBUG ENDPOINTS
// ==========================================

router.get('/oauth/debug/test-contact-fetch', async (req, res) => {
  try {
    const companyAuth = await prisma.gHLCompanyAuth.findFirst({
      orderBy: { authorizedAt: 'desc' }
    });

    if (!companyAuth) {
      return res.status(404).json({ error: 'No authorization found' });
    }

    const accessToken = await getValidToken(companyAuth);

    const results: any = {
      locationId: companyAuth.locationId,
      companyId: companyAuth.companyId,
      tests: {}
    };

    // Test parallel search
    const startTime = Date.now();
    const testContact = await searchContactByEmailParallel(
      'test@example.com',
      accessToken,
      companyAuth.locationId!,
      companyAuth.companyId
    );
    const duration = Date.now() - startTime;

    results.parallelSearchTest = {
      duration: `${duration}ms`,
      found: !!testContact,
      contact: testContact ? { email: testContact.email, name: `${testContact.firstName} ${testContact.lastName}` } : null,
    };

    res.json(results);
  } catch (error: any) {
    res.status(500).json({ 
      error: error.message,
      details: error.response?.data
    });
  }
});

router.get('/oauth/debug/token-status', async (req, res) => {
  try {
    const companyAuth = await prisma.gHLCompanyAuth.findFirst({
      orderBy: { authorizedAt: 'desc' }
    });

    if (!companyAuth) {
      return res.json({
        status: 'not_found',
        message: 'No company authorization found'
      });
    }

    const now = new Date();
    const expiry = new Date(companyAuth.tokenExpiry);
    const timeUntilExpiry = expiry.getTime() - now.getTime();
    const hoursUntilExpiry = timeUntilExpiry / (1000 * 60 * 60);

    res.json({
      status: 'found',
      companyId: companyAuth.companyId,
      locationId: companyAuth.locationId,
      authorizedBy: companyAuth.authorizedBy,
      authorizedAt: companyAuth.authorizedAt,
      tokenExpiry: companyAuth.tokenExpiry,
      currentTime: now,
      isExpired: now >= expiry,
      hoursUntilExpiry: hoursUntilExpiry.toFixed(2),
      hasRefreshToken: !!companyAuth.refreshToken,
      cacheSize: contactCache.size,
    });
  } catch (error: any) {
    res.status(500).json({ 
      error: error.message,
    });
  }
});

router.post('/oauth/debug/force-refresh', async (req, res) => {
  try {
    const companyAuth = await prisma.gHLCompanyAuth.findFirst({
      orderBy: { authorizedAt: 'desc' }
    });

    if (!companyAuth) {
      return res.status(404).json({ error: 'No authorization found' });
    }

    const newToken = await refreshCompanyToken(
      companyAuth.companyId, 
      companyAuth.refreshToken
    );

    const updated = await prisma.gHLCompanyAuth.findUnique({
      where: { companyId: companyAuth.companyId }
    });

    res.json({
      success: true,
      message: 'Token refreshed successfully',
      oldExpiry: companyAuth.tokenExpiry,
      newExpiry: updated?.tokenExpiry,
    });
  } catch (error: any) {
    res.status(500).json({ 
      error: error.message,
    });
  }
});

router.post('/oauth/debug/clear-cache', async (req, res) => {
  const sizeBefore = contactCache.size;
  contactCache.clear();
  res.json({
    success: true,
    message: 'Cache cleared',
    entriesCleared: sizeBefore,
  });
});

// ==========================================
// ADMIN AUTHORIZATION
// ==========================================

router.get('/oauth/admin/authorize', (req, res) => {
  const params = new URLSearchParams({
    response_type: 'code',
    redirect_uri: `${process.env.BACKEND_URL}/api/auth/oauth/admin/callback`,
    client_id: process.env.GHL_CLIENT_ID!,
    scope: 'contacts.readonly contacts.write locations/customValues.readonly locations/customValues.write locations/customFields.readonly locations/customFields.write locations.readonly',
  });

  const authUrl = `${GHL_AUTH_URL}?${params}`;
  res.json({ authUrl });
});

router.get('/oauth/admin/callback', async (req, res) => {
  const { code, error } = req.query;

  if (error || !code) {
    return res.redirect(`${process.env.FRONTEND_URL}/admin/ghl-setup?error=authorization_failed`);
  }

  try {
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

    const { access_token, refresh_token, expires_in, locationId, companyId, userId } = tokenResponse.data;
    const expiryDate = new Date(Date.now() + (expires_in - 300) * 1000);

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

    await prisma.gHLCompanyAuth.deleteMany({
      where: { companyId }
    });

    await prisma.gHLCompanyAuth.create({
      data: {
        companyId,
        locationId: locationId || null,
        accessToken: access_token,
        refreshToken: refresh_token,
        tokenExpiry: expiryDate,
        authorizedBy: adminEmail,
      },
    });

    // Clear cache when admin re-authorizes
    contactCache.clear();

    res.redirect(`${process.env.FRONTEND_URL}/admin/ghl-setup?success=true&companyId=${companyId}`);
  } catch (error: any) {
    res.redirect(`${process.env.FRONTEND_URL}/admin/ghl-setup?error=setup_failed`);
  }
});

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

    const now = new Date();
    const expiry = new Date(auth.tokenExpiry);
    const isExpired = now >= expiry;
    const hoursUntilExpiry = (expiry.getTime() - now.getTime()) / (1000 * 60 * 60);

    res.json({
      authorized: !isExpired,
      companyId: auth.companyId,
      locationId: auth.locationId,
      authorizedBy: auth.authorizedBy,
      authorizedAt: auth.authorizedAt,
      tokenExpiry: auth.tokenExpiry,
      currentTime: now,
      isExpired,
      hoursUntilExpiry: hoursUntilExpiry.toFixed(2),
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to check authorization status' });
  }
});

// ==========================================
// STUDENT LOGIN
// ==========================================

router.post('/oauth/student/login', async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  try {
    console.log('👤 ========== LOGIN ATTEMPT ==========');
    console.log('   Email:', email);

    const companyAuth = await prisma.gHLCompanyAuth.findFirst({
      orderBy: { authorizedAt: 'desc' }
    });

    if (!companyAuth) {
      return res.status(400).json({ 
        error: 'Company not authorized. Admin must set up GHL integration first at /admin/ghl-setup' 
      });
    }

    let accessToken: string;
    try {
      accessToken = await getValidToken(companyAuth);
    } catch (refreshError: any) {
      return res.status(401).json({ 
        error: 'Session expired. Admin needs to re-authorize at /admin/ghl-setup'
      });
    }

    // Search for contact using cached parallel search
    let ghlContact: any = null;
    let retryCount = 0;
    const maxRetries = 2;

    while (!ghlContact && retryCount <= maxRetries) {
      try {
        ghlContact = await searchContactByEmailCached(
          email, 
          accessToken, 
          companyAuth.locationId!, 
          companyAuth.companyId
        );
        break;
      } catch (apiError: any) {
        if (apiError.response?.status === 401 || apiError.response?.status === 403) {
          console.log(`⚠️ Auth error (attempt ${retryCount + 1}), refreshing token...`);
          try {
            accessToken = await refreshCompanyToken(companyAuth.companyId, companyAuth.refreshToken);
            retryCount++;
          } catch {
            return res.status(401).json({ 
              error: 'Session expired. Admin needs to re-authorize at /admin/ghl-setup' 
            });
          }
        } else {
          throw apiError;
        }
      }
    }

    if (!ghlContact) {
      console.log('========================================\n');
      return res.status(401).json({ 
        error: 'Student not found in Tutor Boss. Please ensure your email is registered with your instructor, or sign up for a new account.',
        suggestion: 'Try signing up if you don\'t have a Tutor Boss account yet.'
      });
    }

    const fullName = `${ghlContact.firstName || ''} ${ghlContact.lastName || ''}`.trim();
    const tags = ghlContact.tags || [];
    
    // Check if user already exists by email or ghlUserId
    let user = await prisma.user.findFirst({
      where: {
        OR: [
          { email: ghlContact.email },
          { ghlUserId: ghlContact.id }
        ]
      }
    });

    if (user) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          email: ghlContact.email,
          name: fullName || ghlContact.name || ghlContact.email.split('@')[0],
          ghlUserId: ghlContact.id,
          ghlLocationId: companyAuth.locationId,
          ghlCompanyId: companyAuth.companyId,
          ghlTags: tags,
        },
      });
    } else {
      user = await prisma.user.create({
        data: {
          email: ghlContact.email,
          name: fullName || ghlContact.name || ghlContact.email.split('@')[0],
          ghlUserId: ghlContact.id,
          ghlLocationId: companyAuth.locationId,
          ghlCompanyId: companyAuth.companyId,
           ghlTags: tags,
        },
      });
    }
    await checkAndGrantAdminAccess(user.email, user.id);

// Refresh user data to get updated admin status
user = await prisma.user.findUnique({
  where: { id: user.id }
}) || user;

    const token = jwt.sign(
      {
        userId: user.id,
        email: user.email,
        name: user.name,
        ghlUserId: user.ghlUserId,
      },
      process.env.JWT_SECRET!,
      { expiresIn: '30d' }
    );

    console.log('✅ LOGIN SUCCESSFUL');
    console.log('========================================\n');

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
    console.error('❌ LOGIN FAILED');
    console.error('   Error:', error.message);
    console.error('========================================\n');
    res.status(500).json({ 
      error: 'Login failed. Please try again.'
    });
  }
});

// ==========================================
// STUDENT SIGNUP
// ==========================================

router.post('/oauth/student/signup', async (req, res) => {
  const { email, firstName, lastName, phone } = req.body;

  if (!email || !firstName || !lastName) {
    return res.status(400).json({ 
      error: 'Email, first name, and last name are required' 
    });
  }

  try {
    console.log('📝 ========== SIGNUP ATTEMPT ==========');
    console.log('   Email:', email);

    const companyAuth = await prisma.gHLCompanyAuth.findFirst({
      orderBy: { authorizedAt: 'desc' }
    });

    if (!companyAuth) {
      return res.status(400).json({ 
        error: 'System not configured. Please contact administrator.' 
      });
    }

    let accessToken: string;
    try {
      accessToken = await getValidToken(companyAuth);
    } catch (refreshError: any) {
      return res.status(401).json({ 
        error: 'System configuration error. Please contact administrator.' 
      });
    }

    // Check if contact already exists
    let existingContact: any = null;
    let retryCount = 0;
    const maxRetries = 2;

    while (existingContact === null && retryCount <= maxRetries) {
      try {
        existingContact = await searchContactByEmailCached(
          email, 
          accessToken, 
          companyAuth.locationId!, 
          companyAuth.companyId
        );
        break;
      } catch (apiError: any) {
        if (apiError.response?.status === 401 || apiError.response?.status === 403) {
          try {
            accessToken = await refreshCompanyToken(companyAuth.companyId, companyAuth.refreshToken);
            retryCount++;
          } catch {
            return res.status(401).json({ 
              error: 'System configuration error. Please contact administrator.' 
            });
          }
        } else {
          throw apiError;
        }
      }
    }

    if (existingContact) {
      console.log('❌ SIGNUP FAILED: Email already exists');
      console.log('========================================\n');
      return res.status(409).json({ 
        error: 'An account with this email already exists. Please use the login option instead.',
        existingAccount: true
      });
    }

    // Create new contact in GHL
    const contactData: any = {
      firstName,
      lastName,
      email,
      locationId: companyAuth.locationId,
      source: 'AP CS Question Bank - Self Registration',
      tags: ['student', 'ap-cs', 'self-registered'],
      customFields: [
        { key: 'total_questions_answered', value: '0' },
        { key: 'overall_accuracy', value: '0' },
        { key: 'current_streak', value: '0' },
        { key: 'units_mastered', value: '0' },
        { key: 'signup_date', value: new Date().toISOString() },
        { key: 'study_time_minutes', value: '0' },
      ],
    };

    if (phone) {
      contactData.phone = phone;
    }

    const createResponse = await axios.post(
      `${GHL_API_BASE}/contacts/`,
      contactData,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Version': '2021-07-28',
          'Content-Type': 'application/json',
        },
      }
    );

    const ghlContact = createResponse.data.contact;
    const tags = ghlContact.tags || [];

    const fullName = `${firstName} ${lastName}`.trim();
    
    let user = await prisma.user.findUnique({
      where: { email }
    });

    if (user) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          name: fullName,
          ghlUserId: ghlContact.id,
          ghlLocationId: companyAuth.locationId,
          ghlCompanyId: companyAuth.companyId,
          ghlTags: tags,
        },
      });
    } else {
      user = await prisma.user.create({
        data: {
          email,
          name: fullName,
          ghlUserId: ghlContact.id,
          ghlLocationId: companyAuth.locationId,
          ghlCompanyId: companyAuth.companyId,
          ghlTags: tags,
        },
      });
    }
await checkAndGrantAdminAccess(user.email, user.id);

// Refresh user data to get updated admin status
user = await prisma.user.findUnique({
  where: { id: user.id }
}) || user;
    const token = jwt.sign(
      {
        userId: user.id,
        email: user.email,
        name: user.name,
        ghlUserId: user.ghlUserId,
      },
      process.env.JWT_SECRET!,
      { expiresIn: '30d' }
    );

    console.log('✅ SIGNUP SUCCESSFUL');
    console.log('========================================\n');

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
    console.error('❌ SIGNUP FAILED');
    console.error('   Error:', error.message);
    console.error('========================================\n');
    
    if (error.response?.data) {
      const ghlError = error.response.data;
      if (ghlError.message?.includes('already exists') || ghlError.message?.includes('duplicate')) {
        return res.status(409).json({ 
          error: 'An account with this email already exists. Please login instead.',
          existingAccount: true
        });
      }
    }

    res.status(500).json({ 
      error: 'Signup failed. Please try again or contact support.'
    });
  }
});

// ==========================================
// PROGRESS SYNC
// ==========================================

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

    const companyAuth = await prisma.gHLCompanyAuth.findUnique({
      where: { companyId: user.ghlCompanyId },
    });

    if (!companyAuth) {
      return res.status(400).json({ error: 'Company not authorized' });
    }

    let accessToken: string;
    try {
      accessToken = await getValidToken(companyAuth);
    } catch {
      return res.json({ 
        success: false, 
        message: 'Sync failed, will retry later' 
      });
    }

    const progressData = await getProgressData(userId);

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

    res.json({ success: true, message: 'Progress synced successfully' });
  } catch (error: any) {
    res.json({ 
      success: false, 
      message: 'Sync failed, will retry later' 
    });
  }
});

export default router;