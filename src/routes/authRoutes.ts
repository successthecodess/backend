import { Router } from 'express';
import axios from 'axios';
import jwt from 'jsonwebtoken';
import prisma from '../config/database.js';

const router = Router();

const GHL_AUTH_URL = 'https://marketplace.gohighlevel.com/oauth/chooselocation';
const GHL_TOKEN_URL = 'https://services.leadconnectorhq.com/oauth/token';
const GHL_API_BASE = 'https://services.leadconnectorhq.com';

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
    console.log('   Expires in:', expires_in, 'seconds');
    console.log('   New expiry:', expiryDate.toISOString());
    
    return access_token;
  } catch (error: any) {
    console.error('❌ Token refresh failed:', error.response?.data || error.message);
    throw error;
  }
}

async function getValidToken(companyAuth: any): Promise<string> {
  const now = new Date();
  const expiry = new Date(companyAuth.tokenExpiry);
  const hoursUntilExpiry = (expiry.getTime() - now.getTime()) / (1000 * 60 * 60);
  
  console.log('🔍 Checking token validity:');
  console.log('   Current time:', now.toISOString());
  console.log('   Token expiry:', expiry.toISOString());
  console.log('   Hours until expiry:', hoursUntilExpiry.toFixed(2));

  if (hoursUntilExpiry <= 2) {
    console.log('⏰ Token expired or expiring soon, refreshing...');
    return await refreshCompanyToken(companyAuth.companyId, companyAuth.refreshToken);
  }

  console.log('✅ Token is valid');
  return companyAuth.accessToken;
}

async function searchContactByEmail(email: string, accessToken: string, locationId: string, companyId: string): Promise<any> {
  console.log('🔍 Starting multi-method contact search');
  console.log('   Email:', email);
  console.log('   Company ID:', companyId);
  console.log('   Location ID:', locationId);
  
  // METHOD 1: Try with query parameter
  console.log('\n📍 METHOD 1: Using query parameter search...');
  try {
    const queryResponse = await axios.get(
      `${GHL_API_BASE}/contacts/`,
      {
        params: {
          locationId: locationId,
          query: email,
        },
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Version': '2021-07-28'
        }
      }
    );

    console.log('   Response:', {
      contactsFound: queryResponse.data.contacts?.length || 0,
      total: queryResponse.data.total || queryResponse.data.count || 0,
    });

    if (queryResponse.data.contacts && queryResponse.data.contacts.length > 0) {
      console.log('   Sample results:');
      queryResponse.data.contacts.slice(0, 3).forEach((c: any, i: number) => {
        console.log(`     ${i + 1}. ${c.email} (${c.firstName} ${c.lastName})`);
      });

      const match = queryResponse.data.contacts.find((c: any) => 
        c.email?.toLowerCase() === email.toLowerCase()
      );

      if (match) {
        console.log('✅ FOUND via query parameter!');
        return match;
      }
    }
  } catch (error: any) {
    console.error('   Query search error:', error.response?.status, error.response?.data?.message);
  }

  // METHOD 2: Try listing with skip/limit
  console.log('\n📍 METHOD 2: Using skip/limit pagination...');
  try {
    let totalContactsSearched = 0;
    let skip = 0;
    const limit = 100;
    let pageCount = 0;

    while (pageCount < 50) {
      const listResponse = await axios.get(
        `${GHL_API_BASE}/contacts/`,
        {
          params: {
            locationId: locationId,
            limit: limit,
            skip: skip,
          },
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Version': '2021-07-28'
          }
        }
      );

      const contacts = listResponse.data.contacts || [];
      totalContactsSearched += contacts.length;
      pageCount++;

      console.log(`   Page ${pageCount}: ${contacts.length} contacts (total: ${totalContactsSearched})`);

      if (pageCount === 1 && contacts.length > 0) {
        console.log('   Sample:');
        contacts.slice(0, 3).forEach((c: any, i: number) => {
          console.log(`     ${i + 1}. ${c.email || 'NO EMAIL'} (${c.firstName} ${c.lastName})`);
        });
      }

      const match = contacts.find((c: any) => 
        c.email?.toLowerCase() === email.toLowerCase()
      );

      if (match) {
        console.log('✅ FOUND via pagination!');
        console.log('   Total searched:', totalContactsSearched);
        return match;
      }

      if (contacts.length < limit) {
        console.log('   End of contacts');
        break;
      }

      skip += limit;
    }
  } catch (error: any) {
    console.error('   Pagination error:', error.response?.status, error.response?.data?.message);
  }

  // METHOD 3: Try startAfterId pagination
  console.log('\n📍 METHOD 3: Using startAfterId pagination...');
  try {
    let totalContactsSearched = 0;
    let startAfterId: string | undefined = undefined;
    let pageCount = 0;

    while (pageCount < 50) {
      const params: any = {
        locationId: locationId,
        limit: 100,
      };

      if (startAfterId) {
        params.startAfterId = startAfterId;
      }

      const listResponse = await axios.get(
        `${GHL_API_BASE}/contacts/`,
        {
          params,
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Version': '2021-07-28'
          }
        }
      );

      const contacts = listResponse.data.contacts || [];
      totalContactsSearched += contacts.length;
      pageCount++;

      console.log(`   Page ${pageCount}: ${contacts.length} contacts`);

      const match = contacts.find((c: any) => 
        c.email?.toLowerCase() === email.toLowerCase()
      );

      if (match) {
        console.log('✅ FOUND via startAfterId!');
        return match;
      }

      if (contacts.length < 100) {
        break;
      }

      startAfterId = contacts[contacts.length - 1].id;
    }
  } catch (error: any) {
    console.error('   startAfterId error:', error.response?.status, error.response?.data?.message);
  }

  // METHOD 4: Try without location filter
  console.log('\n📍 METHOD 4: Without location filter...');
  try {
    let totalContactsSearched = 0;
    let startAfterId: string | undefined = undefined;
    let pageCount = 0;

    while (pageCount < 50) {
      const params: any = {
        limit: 100,
      };

      if (startAfterId) {
        params.startAfterId = startAfterId;
      }

      const listResponse = await axios.get(
        `${GHL_API_BASE}/contacts/`,
        {
          params,
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Version': '2021-07-28'
          }
        }
      );

      const contacts = listResponse.data.contacts || [];
      totalContactsSearched += contacts.length;
      pageCount++;

      console.log(`   Page ${pageCount}: ${contacts.length} contacts`);

      if (pageCount === 1 && contacts.length > 0) {
        console.log('   Sample with locations:');
        contacts.slice(0, 3).forEach((c: any, i: number) => {
          console.log(`     ${i + 1}. ${c.email} - Loc: ${c.locationId} (${c.firstName} ${c.lastName})`);
        });
      }

      const match = contacts.find((c: any) => 
        c.email?.toLowerCase() === email.toLowerCase()
      );

      if (match) {
        console.log('✅ FOUND without location filter!');
        console.log('   Contact location:', match.locationId);
        console.log('   Authorized location:', locationId);
        return match;
      }

      if (contacts.length < 100) {
        break;
      }

      startAfterId = contacts[contacts.length - 1].id;
    }
  } catch (error: any) {
    console.error('   No-filter error:', error.response?.status, error.response?.data?.message);
  }

  console.log('\n❌ CONTACT NOT FOUND after trying all methods');
  return null;
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

    console.log('🧪 Testing contact fetch methods...');

    const results: any = {
      locationId: companyAuth.locationId,
      companyId: companyAuth.companyId,
      tests: {}
    };

    // Test 1: With location
    try {
      const test1 = await axios.get(
        `${GHL_API_BASE}/contacts/`,
        {
          params: {
            locationId: companyAuth.locationId,
            limit: 10,
          },
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Version': '2021-07-28'
          }
        }
      );
      results.tests.withLocation = {
        success: true,
        contactCount: test1.data.contacts?.length || 0,
        total: test1.data.total || test1.data.count || 0,
        sampleEmails: test1.data.contacts?.slice(0, 3).map((c: any) => c.email) || [],
      };
    } catch (e: any) {
      results.tests.withLocation = {
        success: false,
        error: e.response?.data,
      };
    }

    // Test 2: Without location
    try {
      const test2 = await axios.get(
        `${GHL_API_BASE}/contacts/`,
        {
          params: {
            limit: 10,
          },
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Version': '2021-07-28'
          }
        }
      );
      results.tests.noLocation = {
        success: true,
        contactCount: test2.data.contacts?.length || 0,
        total: test2.data.total || test2.data.count || 0,
        sampleEmails: test2.data.contacts?.slice(0, 3).map((c: any) => ({ email: c.email, locationId: c.locationId })) || [],
      };
    } catch (e: any) {
      results.tests.noLocation = {
        success: false,
        error: e.response?.data,
      };
    }

    // Test 3: With query
    try {
      const test3 = await axios.get(
        `${GHL_API_BASE}/contacts/`,
        {
          params: {
            locationId: companyAuth.locationId,
            query: 'dfinley',
          },
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Version': '2021-07-28'
          }
        }
      );
      results.tests.withQuery = {
        success: true,
        contactCount: test3.data.contacts?.length || 0,
        sampleResults: test3.data.contacts?.slice(0, 3).map((c: any) => ({ email: c.email, name: `${c.firstName} ${c.lastName}` })) || [],
      };
    } catch (e: any) {
      results.tests.withQuery = {
        success: false,
        error: e.response?.data,
      };
    }

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
      accessTokenPreview: companyAuth.accessToken?.substring(0, 20) + '...',
    });
  } catch (error: any) {
    res.status(500).json({ 
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
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

    console.log('🔄 Manual refresh initiated...');
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
      accessTokenPreview: newToken.substring(0, 20) + '...'
    });
  } catch (error: any) {
    console.error('Manual refresh failed:', error);
    res.json({ 
      error: error.message,
      details: error.response?.data
    });
  }
});

// ==========================================
// ADMIN AUTHORIZATION
// ==========================================

router.get('/oauth/admin/authorize', (req, res) => {
  console.log('🔐 Admin authorization flow started');
  
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
    console.error('❌ Authorization failed:', error);
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

    console.log('✅ Tokens received');
    console.log('   Company ID:', companyId);
    console.log('   Location ID:', locationId);

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

    console.log('✅ Authorization saved');

    res.redirect(`${process.env.FRONTEND_URL}/admin/ghl-setup?success=true&companyId=${companyId}`);
  } catch (error: any) {
    console.error('❌ Admin callback error:', error.response?.data || error.message);
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
    console.error('Failed to check status:', error);
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
    console.log('   Timestamp:', new Date().toISOString());

    const companyAuth = await prisma.gHLCompanyAuth.findFirst({
      orderBy: { authorizedAt: 'desc' }
    });

    if (!companyAuth) {
      console.log('❌ No company authorization found');
      return res.status(400).json({ 
        error: 'Company not authorized. Admin must set up GHL integration first at /admin/ghl-setup' 
      });
    }

    console.log('✅ Found company auth');
    console.log('   Company ID:', companyAuth.companyId);
    console.log('   Location ID:', companyAuth.locationId);

    let accessToken: string;
    try {
      accessToken = await getValidToken(companyAuth);
    } catch (refreshError: any) {
      console.error('❌ Token refresh failed:', refreshError.message);
      return res.status(401).json({ 
        error: 'Session expired. Admin needs to re-authorize at /admin/ghl-setup'
      });
    }

    // Search for contact using Business ID endpoint
    let ghlContact: any = null;
    let retryCount = 0;
    const maxRetries = 2;

    while (!ghlContact && retryCount <= maxRetries) {
      try {
        ghlContact = await searchContactByEmail(
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
    
    const user = await prisma.user.upsert({
      where: { ghlUserId: ghlContact.id },
      create: {
        email: ghlContact.email,
        name: fullName || ghlContact.name || ghlContact.email.split('@')[0],
        ghlUserId: ghlContact.id,
        ghlLocationId: companyAuth.locationId,
        ghlCompanyId: companyAuth.companyId,
      },
      update: {
        email: ghlContact.email,
        name: fullName || ghlContact.name || ghlContact.email.split('@')[0],
      },
    });

    console.log('✅ User record:', user.id);

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
    console.error('   Error:', error.response?.data || error.message);
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
    console.log('   Name:', firstName, lastName);
    console.log('   Phone:', phone || 'N/A');
    console.log('   Timestamp:', new Date().toISOString());

    const companyAuth = await prisma.gHLCompanyAuth.findFirst({
      orderBy: { authorizedAt: 'desc' }
    });

    if (!companyAuth) {
      console.log('❌ No company authorization found');
      return res.status(400).json({ 
        error: 'System not configured. Please contact administrator.' 
      });
    }

    console.log('✅ Found company auth');
    console.log('   Company ID:', companyAuth.companyId);
    console.log('   Location ID:', companyAuth.locationId);

    let accessToken: string;
    try {
      accessToken = await getValidToken(companyAuth);
    } catch (refreshError: any) {
      console.error('❌ Token refresh failed:', refreshError.message);
      return res.status(401).json({ 
        error: 'System configuration error. Please contact administrator.' 
      });
    }

    // Check if contact already exists using Business ID endpoint
    console.log('🔍 Checking if contact exists...');
    let existingContact: any = null;
    let retryCount = 0;
    const maxRetries = 2;

    while (existingContact === null && retryCount <= maxRetries) {
      try {
        existingContact = await searchContactByEmail(
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

    console.log('✅ Email not found, proceeding with signup');

    // Create new contact in GHL
    console.log('➕ Creating new contact in GHL...');
    
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
    console.log('✅ Contact created in GHL:', ghlContact.id);

    const fullName = `${firstName} ${lastName}`.trim();
    
    const user = await prisma.user.create({
      data: {
        email,
        name: fullName,
        ghlUserId: ghlContact.id,
        ghlLocationId: companyAuth.locationId,
        ghlCompanyId: companyAuth.companyId,
      },
    });

    console.log('✅ User created in database:', user.id);

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
    console.error('   Error:', error.response?.data || error.message);
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
      console.error('Token refresh failed during sync');
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

    console.log('✅ Progress synced for user:', userId);
    res.json({ success: true, message: 'Progress synced successfully' });
  } catch (error: any) {
    console.error('❌ Sync error:', error.response?.data || error.message);
    res.json({ 
      success: false, 
      message: 'Sync failed, will retry later' 
    });
  }
});

export default router;