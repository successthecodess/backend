import { Router } from 'express';
import axios from 'axios';
import jwt from 'jsonwebtoken';
import prisma from '../config/database.js';
import { checkUserAccess } from '../middleware/accessControl.js';
import { Resend } from 'resend';

const router = Router();

const GHL_AUTH_URL = 'https://marketplace.gohighlevel.com/oauth/chooselocation';
const GHL_TOKEN_URL = 'https://services.leadconnectorhq.com/oauth/token';
const GHL_API_BASE = 'https://services.leadconnectorhq.com';

// ==========================================
// EMAIL SETUP WITH RESEND
// ==========================================

const resend = new Resend(process.env.RESEND_API_KEY);

async function sendMagicLink(email: string, token: string) {
  const magicLink = `${process.env.FRONTEND_URL}/auth/verify?token=${token}`;
  
  try {
    const { data, error } = await resend.emails.send({
      from: 'AP CS Question Bank <noreply@csaprep.aceapcomputerscience.com>', // Change to your domain when verified
      to: email,
      subject: 'Your Login Link - AP CS Question Bank',
      html: `
        <!DOCTYPE html>
        <html>
          <head>
            <style>
              body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
              .container { max-width: 600px; margin: 0 auto; padding: 20px; }
              .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
              .content { background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; }
              .button { display: inline-block; padding: 15px 30px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; text-decoration: none; border-radius: 8px; font-weight: bold; margin: 20px 0; }
              .footer { text-align: center; margin-top: 30px; color: #6b7280; font-size: 12px; }
              .warning { background: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px; margin: 20px 0; border-radius: 4px; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h1>🎓 Login to AP CS Question Bank</h1>
              </div>
              <div class="content">
                <p>Hi there!</p>
                <p>Click the button below to securely log in to your AP Computer Science Question Bank account:</p>
                
                <div style="text-align: center;">
                  <a href="${magicLink}" class="button">Log In Now</a>
                </div>
                
                <p>Or copy and paste this link into your browser:</p>
                <p style="background: white; padding: 15px; border-radius: 6px; word-break: break-all; font-size: 12px;">
                  ${magicLink}
                </p>
                
                <div class="warning">
                  <strong>⏰ This link expires in 15 minutes</strong> for your security.
                </div>
                
                <div class="warning">
                  <strong>🔒 Security Notice:</strong> If you didn't request this login link, please ignore this email. Someone may have mistyped their email address.
                </div>
                
                <p>Happy studying!</p>
              </div>
              <div class="footer">
                <p>This is an automated message from AP CS Question Bank</p>
                <p>© ${new Date().getFullYear()} AP CS Question Bank. All rights reserved.</p>
              </div>
            </div>
          </body>
        </html>
      `,
      text: `
        Login to AP CS Question Bank
        
        Click this link to log in: ${magicLink}
        
        This link expires in 15 minutes.
        
        If you didn't request this, please ignore this email.
      `
    });

    if (error) {
      console.error('❌ Resend API error:', error);
      return false;
    }

    console.log('✅ Magic link sent to:', email);
    console.log('📧 Email ID:', data?.id);
    return true;
  } catch (error) {
    console.error('❌ Failed to send email:', error);
    return false;
  }
}

// ==========================================
// CACHE SETUP & HELPER FUNCTIONS
// ==========================================

const contactCache = new Map<string, { contact: any; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

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

  console.log('❌ Not found in sequential search');
  return null;
}

async function searchContactByEmailParallel(email: string, accessToken: string, locationId: string, companyId: string): Promise<any> {
  console.log('🚀 Parallel search started for:', email);
  const startTime = Date.now();
  
  const searchPromises = [
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
  ];

  const results = await Promise.all(searchPromises);
  
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
  
  return await searchContactByEmailSequential(email, accessToken, locationId, companyId);
}

async function searchContactByEmailCached(email: string, accessToken: string, locationId: string, companyId: string): Promise<any> {
  const cacheKey = `${email.toLowerCase()}-${locationId}`;
  
  const cached = contactCache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
    console.log('⚡ FOUND in cache (instant)');
    return cached.contact;
  }

  const contact = await searchContactByEmailParallel(email, accessToken, locationId, companyId);

  if (contact) {
    contactCache.set(cacheKey, { contact, timestamp: Date.now() });
    
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

async function checkAndGrantAdminAccess(email: string, userId: string): Promise<boolean> {
  try {
    const adminEmail = await prisma.adminEmail.findUnique({
      where: { 
        email: email.toLowerCase(),
      },
    });

    if (adminEmail && adminEmail.isActive) {
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

// ==========================================
// MAGIC LINK AUTHENTICATION
// ==========================================

router.post('/oauth/student/request-login', async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  try {
    console.log('📧 ========== MAGIC LINK REQUEST ==========');
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

    // Check if email exists in GHL
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
      console.log('❌ Email not found in TutorBoss');
      console.log('========================================\n');
      
      // Don't reveal if email exists or not (security best practice)
      return res.json({
        success: true,
        message: 'If this email is registered, you will receive a login link shortly.'
      });
    }

    // Generate magic link token (expires in 15 minutes)
    const magicToken = jwt.sign(
      {
        email: ghlContact.email,
        ghlUserId: ghlContact.id,
        type: 'magic-link',
      },
      process.env.JWT_SECRET!,
      { expiresIn: '15m' }
    );

    // Send email
    const emailSent = await sendMagicLink(ghlContact.email, magicToken);

    if (!emailSent) {
      console.error('❌ Failed to send email');
      return res.status(500).json({ 
        error: 'Failed to send login link. Please try again or contact support.'
      });
    }

    console.log('✅ Magic link sent successfully');
    console.log('========================================\n');

    res.json({
      success: true,
      message: 'Check your email for a login link. It expires in 15 minutes.'
    });

  } catch (error: any) {
    console.error('❌ MAGIC LINK REQUEST FAILED');
    console.error('   Error:', error.message);
    console.error('========================================\n');
    res.status(500).json({ 
      error: 'Request failed. Please try again.'
    });
  }
});

router.post('/oauth/student/verify-magic-link', async (req, res) => {
  const { token } = req.body;

  if (!token) {
    return res.status(400).json({ error: 'Token is required' });
  }

  try {
    console.log('🔐 ========== VERIFYING MAGIC LINK ==========');

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as {
      email: string;
      ghlUserId: string;
      type: string;
    };

    if (decoded.type !== 'magic-link') {
      return res.status(400).json({ error: 'Invalid token type' });
    }

    const companyAuth = await prisma.gHLCompanyAuth.findFirst({
      orderBy: { authorizedAt: 'desc' }
    });

    if (!companyAuth) {
      return res.status(400).json({ 
        error: 'System not configured. Please contact administrator.' 
      });
    }

    const accessToken = await getValidToken(companyAuth);

    // Fetch latest data from GHL
    const ghlContact = await searchContactByEmailCached(
      decoded.email,
      accessToken,
      companyAuth.locationId!,
      companyAuth.companyId
    );

    if (!ghlContact) {
      return res.status(401).json({ 
        error: 'Account no longer exists in TutorBoss'
      });
    }

    const fullName = `${ghlContact.firstName || ''} ${ghlContact.lastName || ''}`.trim();
    const tags = ghlContact.tags || [];
    
    // Create or update user
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
          lastActive: new Date(),
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

    user = await prisma.user.findUnique({
      where: { id: user.id }
    }) || user;

    // Generate long-lived session token
    const sessionToken = jwt.sign(
      {
        userId: user.id,
        email: user.email,
        name: user.name,
        ghlUserId: user.ghlUserId,
      },
      process.env.JWT_SECRET!,
      { expiresIn: '30d' }
    );

    console.log('✅ MAGIC LINK VERIFIED - LOGIN SUCCESSFUL');
    console.log('========================================\n');

    res.json({
      success: true,
      token: sessionToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        isAdmin: user.isAdmin,
        role: user.role,
      },
    });

  } catch (error: any) {
    if (error.name === 'TokenExpiredError') {
      return res.status(400).json({ 
        error: 'This login link has expired. Please request a new one.' 
      });
    }
    
    if (error.name === 'JsonWebTokenError') {
      return res.status(400).json({ 
        error: 'Invalid login link.' 
      });
    }

    console.error('❌ MAGIC LINK VERIFICATION FAILED');
    console.error('   Error:', error.message);
    console.error('========================================\n');
    
    res.status(500).json({ 
      error: 'Verification failed. Please try again.'
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

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email: email.toLowerCase() }
    });

    if (existingUser) {
      console.log('❌ SIGNUP FAILED: User already exists');
      console.log('========================================\n');
      return res.status(409).json({ 
        error: 'An account with this email already exists. Please use the login option instead.',
        existingAccount: true
      });
    }

    // Check GHL
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
      console.log('❌ SIGNUP FAILED: Email already exists in GHL');
      console.log('========================================\n');
      return res.status(409).json({ 
        error: 'An account with this email already exists. Please use the login option instead.',
        existingAccount: true
      });
    }

    // Create in GHL
    const contactData: any = {
      firstName,
      lastName,
      email,
      locationId: companyAuth.locationId,
      source: 'AP CS Question Bank - Self Registration',
      tags: ['student', 'ap-cs', 'apcsa-self-registered'],
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

    // Generate magic link token
    const magicToken = jwt.sign(
      {
        email: ghlContact.email,
        ghlUserId: ghlContact.id,
        type: 'magic-link',
      },
      process.env.JWT_SECRET!,
      { expiresIn: '15m' }
    );

    // Send welcome email with magic link
    const emailSent = await sendMagicLink(ghlContact.email, magicToken);

    if (!emailSent) {
      console.error('⚠️ Account created but email failed');
    }

    console.log('✅ SIGNUP SUCCESSFUL');
    console.log('========================================\n');

    res.json({
      success: true,
      message: 'Account created! Check your email for a login link.',
      emailSent,
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
// OTHER ROUTES
// ==========================================

router.get('/oauth/me', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.substring(7);
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as {
      userId: string;
      email: string;
      name: string;
      ghlUserId?: string;
    };

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isAdmin: true,
        isStaff: true,
        ghlTags: true,
        ghlUserId: true,
        ghlLocationId: true,
        ghlCompanyId: true,
        hasAccessToQuestionBank: true,
        hasAccessToTimedPractice: true,
        hasAccessToAnalytics: true,
        isPremium: true,
        premiumUntil: true,
        createdAt: true,
        lastActive: true,
      },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { lastActive: new Date() }
    });

    res.json(user);
  } catch (error: any) {
    console.error('Failed to fetch user info:', error);
    
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Invalid token' });
    }
    
    res.status(500).json({ error: 'Failed to fetch user info' });
  }
});

// Find and update this route:
router.get('/oauth/my-access', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.substring(7);
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as { userId: string };

    const access = await checkUserAccess(decoded.userId);
    
    console.log('🔐 Access check for user:', decoded.userId);
    console.log('   Tags:', access.accessTier);
    console.log('   hasPracticeTestAccess:', access.hasFullAccess);

    res.json(access);
  } catch (error) {
    console.error('Access check error:', error);
    res.status(401).json({ error: 'Invalid token' });
  }
});

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

// Test email endpoint (optional - for testing)
router.post('/oauth/test-email', async (req, res) => {
  const { email } = req.body;
  
  if (!email) {
    return res.status(400).json({ error: 'Email required' });
  }

  try {
    const testToken = 'test-token-12345';
    const success = await sendMagicLink(email, testToken);
    
    if (success) {
      res.json({ 
        success: true, 
        message: `Test email sent to ${email}` 
      });
    } else {
      res.status(500).json({ 
        error: 'Failed to send email. Check your Resend API key.' 
      });
    }
  } catch (error: any) {
    res.status(500).json({ 
      error: error.message,
      details: 'Check backend logs for more details'
    });
  }
});

export default router;