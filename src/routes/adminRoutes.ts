import { Router } from 'express';
import prisma from '../config/database.js';
import { requireAdmin, requireStaff } from '../middleware/rbac.js';
import { AuditLogger } from '../utils/auditLogger.js';
import { authenticateToken } from '../middleware/auth.js';
import { deleteUser } from '../controllers/adminController.js';
import axios from 'axios';
import {
  getAdminStats,
  getAllQuestions,
  getQuestion,
  createQuestion,
  updateQuestion,
  deleteQuestion,
  approveQuestion,
  bulkUploadQuestions,
} from '../controllers/adminController.js';
import { upload } from '../middleware/upload.js';
import freeTrialService from '../services/freeTrialService.js';

const router = Router();

const GHL_API_BASE = 'https://services.leadconnectorhq.com';

// All admin routes require authentication
router.use(authenticateToken);

// ==========================================
// EXISTING ADMIN ROUTES (with RBAC)
// ==========================================

// Dashboard Stats - Staff can view
router.get('/dashboard/stats', requireStaff, getAdminStats);

// Questions CRUD - Staff can view, Admin can edit
router.get('/questions', requireStaff, getAllQuestions);
router.get('/questions/:questionId', requireStaff, getQuestion);
router.post('/questions', requireAdmin, createQuestion);
router.put('/questions/:questionId', requireAdmin, updateQuestion);
router.delete('/questions/:questionId', requireAdmin, deleteQuestion);
router.patch('/questions/:questionId/approve', requireAdmin, approveQuestion);
router.post('/questions/bulk-upload', requireAdmin, upload.single('file'), bulkUploadQuestions);
router.delete('/users/:userId', requireAdmin, deleteUser);
// ==========================================
// FEATURE FLAG MANAGEMENT (Admin Only)
// ==========================================

// Get all feature flags
router.get('/features', requireAdmin, async (req, res) => {
  try {
    const features = await prisma.featureFlag.findMany({
      orderBy: { displayName: 'asc' }
    });
    res.json(features);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Create feature flag
router.post('/features', requireAdmin, async (req, res) => {
  try {
    const { name, displayName, description, requiredGhlTag, requiresPremium, requiresStaff } = req.body;

    const feature = await prisma.featureFlag.create({
      data: {
        name,
        displayName,
        description,
        requiredGhlTag,
        requiresPremium: requiresPremium || false,
        requiresStaff: requiresStaff || false,
      }
    });

    res.json(feature);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Update feature flag
router.put('/features/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { displayName, description, requiredGhlTag, requiresPremium, requiresStaff, isEnabled } = req.body;

    const feature = await prisma.featureFlag.update({
      where: { id },
      data: {
        displayName,
        description,
        requiredGhlTag,
        requiresPremium,
        requiresStaff,
        isEnabled,
      }
    });

    res.json(feature);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Delete feature flag
router.delete('/features/:id', requireAdmin, async (req, res) => {
  try {
    await prisma.featureFlag.delete({
      where: { id: req.params.id }
    });
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// COURSE ACCESS MANAGEMENT (Admin Only)
// ==========================================

// Get all courses
router.get('/courses', requireAdmin, async (req, res) => {
  try {
    const courses = await prisma.courseAccess.findMany({
      orderBy: { courseName: 'asc' }
    });
    res.json(courses);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Create course
router.post('/courses', requireAdmin, async (req, res) => {
  try {
    const { courseName, courseSlug, requiredGhlTag, fallbackToFlag } = req.body;

    const course = await prisma.courseAccess.create({
      data: {
        courseName,
        courseSlug,
        requiredGhlTag,
        fallbackToFlag,
      }
    });

    res.json(course);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Update course
router.put('/courses/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { courseName, requiredGhlTag, fallbackToFlag, isActive } = req.body;

    const course = await prisma.courseAccess.update({
      where: { id },
      data: {
        courseName,
        requiredGhlTag,
        fallbackToFlag,
        isActive,
      }
    });

    res.json(course);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// USER MANAGEMENT (Staff can view, Admin can edit)
// ==========================================

// Get all users
router.get('/users', requireStaff, async (req, res) => {
  try {
    const { page = 1, limit = 50, search, role } = req.query;
    
    const where: any = {};
    
    if (search) {
      where.OR = [
        { email: { contains: search as string, mode: 'insensitive' } },
        { name: { contains: search as string, mode: 'insensitive' } },
      ];
    }
    
    if (role && role !== 'all') {
      where.role = role;
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          isAdmin: true,
          isStaff: true,
          ghlTags: true,
          ghlUserId: true,
          hasAccessToQuestionBank: true,
          hasAccessToTimedPractice: true,
          hasAccessToAnalytics: true,
          isPremium: true,
          premiumUntil: true,
          createdAt: true,
          lastActive: true,
        },
        skip: (Number(page) - 1) * Number(limit),
        take: Number(limit),
        orderBy: { createdAt: 'desc' }
      }),
      prisma.user.count({ where })
    ]);

    res.json({
      users,
      pagination: {
        total,
        page: Number(page),
        limit: Number(limit),
        pages: Math.ceil(total / Number(limit))
      }
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get single user
router.get('/users/:id', requireStaff, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
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
        _count: {
          select: {
            progress: true,
            questionResponses: true,
            studySessions: true,
          }
        }
      },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(user);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Update user permissions (admin only)
router.put('/users/:id/permissions', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      role, 
      isAdmin, 
      isStaff, 
      hasAccessToQuestionBank, 
      hasAccessToTimedPractice,
      hasAccessToAnalytics,
      isPremium,
      premiumUntil
    } = req.body;

    const updateData: any = {};
    
    if (role !== undefined) updateData.role = role;
    if (isAdmin !== undefined) updateData.isAdmin = isAdmin;
    if (isStaff !== undefined) updateData.isStaff = isStaff;
    if (hasAccessToQuestionBank !== undefined) updateData.hasAccessToQuestionBank = hasAccessToQuestionBank;
    if (hasAccessToTimedPractice !== undefined) updateData.hasAccessToTimedPractice = hasAccessToTimedPractice;
    if (hasAccessToAnalytics !== undefined) updateData.hasAccessToAnalytics = hasAccessToAnalytics;
    if (isPremium !== undefined) updateData.isPremium = isPremium;
    if (premiumUntil !== undefined) updateData.premiumUntil = premiumUntil ? new Date(premiumUntil) : null;

    const user = await prisma.user.update({
      where: { id },
      data: updateData,
    });

    console.log('✅ User permissions updated:', user.email);

    res.json({ 
      success: true,
      user,
      message: 'Permissions updated successfully. User will see changes on next page refresh.'
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Sync user tags from GHL (admin only)
router.post('/users/:id/sync-tags', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const user = await prisma.user.findUnique({
      where: { id },
      select: { 
        ghlUserId: true, 
        ghlCompanyId: true,
        ghlTags: true,
        email: true 
      }
    });

    if (!user || !user.ghlUserId || !user.ghlCompanyId) {
      return res.status(400).json({ error: 'User not linked to GHL' });
    }

    const companyAuth = await prisma.gHLCompanyAuth.findUnique({
      where: { companyId: user.ghlCompanyId }
    });

    if (!companyAuth) {
      return res.status(400).json({ error: 'Company not authorized' });
    }

    // Fetch contact from GHL
    const contactResponse = await axios.get(
      `${GHL_API_BASE}/contacts/${user.ghlUserId}`,
      {
        headers: {
          'Authorization': `Bearer ${companyAuth.accessToken}`,
          'Version': '2021-07-28'
        }
      }
    );

    const ghlTags = contactResponse.data.contact.tags || [];
    const currentTags = user.ghlTags || [];

    console.log(`🔄 Syncing tags for ${user.email}:`);
    console.log(`   Current platform tags: ${currentTags.join(', ') || 'none'}`);
    console.log(`   Tags from GHL/Tutor Boss: ${ghlTags.join(', ') || 'none'}`);
    console.log(`   ✅ Platform will now match GHL exactly`);

    // FIXED: Replace platform tags with GHL tags (exact match)
    const updatedUser = await prisma.user.update({
      where: { id },
      data: { ghlTags: ghlTags }
    });

    res.json({
      success: true,
      message: 'Tags synced successfully. Platform now matches GHL/Tutor Boss.',
      tags: ghlTags,
      user: updatedUser
    });
  } catch (error: any) {
    console.error('Tag sync error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Bulk sync all users' tags from GHL
router.post('/users/sync-all-tags', requireAdmin, async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      where: {
        ghlUserId: { not: null },
        ghlCompanyId: { not: null }
      },
      select: {
        id: true,
        ghlUserId: true,
        ghlCompanyId: true,
        email: true,
        ghlTags: true,
      }
    });

    let synced = 0;
    let failed = 0;
    const errors: any[] = [];
    const syncResults: any[] = [];

    for (const user of users) {
      try {
        const companyAuth = await prisma.gHLCompanyAuth.findUnique({
          where: { companyId: user.ghlCompanyId! }
        });

        if (!companyAuth) {
          failed++;
          errors.push({ email: user.email, error: 'No company auth' });
          continue;
        }

        const contactResponse = await axios.get(
          `${GHL_API_BASE}/contacts/${user.ghlUserId}`,
          {
            headers: {
              'Authorization': `Bearer ${companyAuth.accessToken}`,
              'Version': '2021-07-28'
            },
            timeout: 5000,
          }
        );

        const ghlTags = contactResponse.data.contact.tags || [];
        const currentTags = user.ghlTags || [];

        console.log(`🔄 Syncing tags for ${user.email}:`);
        console.log(`   Before: ${currentTags.join(', ') || 'none'}`);
        console.log(`   After:  ${ghlTags.join(', ') || 'none'}`);

        // FIXED: Replace platform tags with GHL tags (exact match)
        await prisma.user.update({
          where: { id: user.id },
          data: { ghlTags: ghlTags }
        });

        syncResults.push({
          email: user.email,
          before: currentTags,
          after: ghlTags,
          changed: JSON.stringify(currentTags.sort()) !== JSON.stringify(ghlTags.sort())
        });

        synced++;
      } catch (error: any) {
        failed++;
        errors.push({ email: user.email, error: error.message });
      }
    }

    const changedCount = syncResults.filter(r => r.changed).length;

    console.log(`\n✅ Bulk tag sync complete:`);
    console.log(`   Total users: ${users.length}`);
    console.log(`   Successfully synced: ${synced}`);
    console.log(`   Tags changed: ${changedCount}`);
    console.log(`   Failed: ${failed}`);

    res.json({
      success: true,
      synced,
      failed,
      total: users.length,
      changedCount,
      message: `Successfully synced ${synced} users. ${changedCount} users had tag changes. Platform tags now match GHL/Tutor Boss.`,
      errors: errors.slice(0, 10),
      sampleResults: syncResults.slice(0, 5), // Show first 5 for reference
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
// ==========================================
// TAG MANAGEMENT (Admin Only)
// ==========================================

// Add tag to user in GHL
router.post('/users/:id/tags/add', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { tag } = req.body;

    if (!tag) {
      return res.status(400).json({ error: 'Tag is required' });
    }

    const user = await prisma.user.findUnique({
      where: { id },
      select: { ghlUserId: true, ghlCompanyId: true, email: true, ghlTags: true }
    });

    if (!user || !user.ghlUserId || !user.ghlCompanyId) {
      return res.status(400).json({ error: 'User not linked to GHL' });
    }

    // Check if user already has the tag
    if (user.ghlTags?.includes(tag)) {
      return res.status(400).json({ error: 'User already has this tag' });
    }

    const companyAuth = await prisma.gHLCompanyAuth.findUnique({
      where: { companyId: user.ghlCompanyId }
    });

    if (!companyAuth) {
      return res.status(400).json({ error: 'Company not authorized' });
    }

    // Get valid token
    let accessToken = companyAuth.accessToken;
    const now = new Date();
    const expiry = new Date(companyAuth.tokenExpiry);
    
    if (now >= expiry) {
      const refreshResponse = await axios.post(
        'https://services.leadconnectorhq.com/oauth/token',
        new URLSearchParams({
          client_id: process.env.GHL_CLIENT_ID!,
          client_secret: process.env.GHL_CLIENT_SECRET!,
          grant_type: 'refresh_token',
          refresh_token: companyAuth.refreshToken,
        }),
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        }
      );

      accessToken = refreshResponse.data.access_token;
    }

    // Fetch current contact to get existing tags
    const contactResponse = await axios.get(
      `${GHL_API_BASE}/contacts/${user.ghlUserId}`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Version': '2021-07-28'
        }
      }
    );

    const currentTags = contactResponse.data.contact.tags || [];
    const updatedTags = [...currentTags, tag];

    // Update contact with new tags
    await axios.put(
      `${GHL_API_BASE}/contacts/${user.ghlUserId}`,
      {
        tags: updatedTags
      },
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Version': '2021-07-28',
          'Content-Type': 'application/json',
        }
      }
    );

    // Update local database
    await prisma.user.update({
      where: { id },
      data: { ghlTags: updatedTags }
    });

    console.log(`✅ Tag "${tag}" added to user ${user.email}`);

    res.json({
      success: true,
      message: `Tag "${tag}" added successfully`,
      tags: updatedTags
    });
  } catch (error: any) {
    console.error('Failed to add tag:', error);
    res.status(500).json({ 
      error: 'Failed to add tag to GHL',
      details: error.response?.data || error.message
    });
  }
});

// Remove tag from user in GHL
router.post('/users/:id/tags/remove', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { tag } = req.body;

    if (!tag) {
      return res.status(400).json({ error: 'Tag is required' });
    }

    const user = await prisma.user.findUnique({
      where: { id },
      select: { ghlUserId: true, ghlCompanyId: true, email: true, ghlTags: true }
    });

    if (!user || !user.ghlUserId || !user.ghlCompanyId) {
      return res.status(400).json({ error: 'User not linked to GHL' });
    }

    // Check if user has the tag
    if (!user.ghlTags?.includes(tag)) {
      return res.status(400).json({ error: 'User does not have this tag' });
    }

    const companyAuth = await prisma.gHLCompanyAuth.findUnique({
      where: { companyId: user.ghlCompanyId }
    });

    if (!companyAuth) {
      return res.status(400).json({ error: 'Company not authorized' });
    }

    let accessToken = companyAuth.accessToken;
    const now = new Date();
    const expiry = new Date(companyAuth.tokenExpiry);
    
    if (now >= expiry) {
      const refreshResponse = await axios.post(
        'https://services.leadconnectorhq.com/oauth/token',
        new URLSearchParams({
          client_id: process.env.GHL_CLIENT_ID!,
          client_secret: process.env.GHL_CLIENT_SECRET!,
          grant_type: 'refresh_token',
          refresh_token: companyAuth.refreshToken,
        }),
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        }
      );

      accessToken = refreshResponse.data.access_token;
    }

    const contactResponse = await axios.get(
      `${GHL_API_BASE}/contacts/${user.ghlUserId}`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Version': '2021-07-28'
        }
      }
    );

    const currentTags = contactResponse.data.contact.tags || [];
    const updatedTags = currentTags.filter((t: string) => t !== tag);

    await axios.put(
      `${GHL_API_BASE}/contacts/${user.ghlUserId}`,
      {
        tags: updatedTags
      },
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Version': '2021-07-28',
          'Content-Type': 'application/json',
        }
      }
    );

    await prisma.user.update({
      where: { id },
      data: { ghlTags: updatedTags }
    });

    console.log(`✅ Tag "${tag}" removed from user ${user.email}`);

    res.json({
      success: true,
      message: `Tag "${tag}" removed successfully`,
      tags: updatedTags
    });
  } catch (error: any) {
    console.error('Failed to remove tag:', error);
    res.status(500).json({ 
      error: 'Failed to remove tag from GHL',
      details: error.response?.data || error.message
    });
  }
});

// ==========================================
// ADMIN EMAIL MANAGEMENT (Admin Only)
// ==========================================

// Get all admin emails
router.get('/admin-emails', requireAdmin, async (req, res) => {
  try {
    const adminEmails = await prisma.adminEmail.findMany({
      orderBy: { addedAt: 'desc' }
    });
    res.json(adminEmails);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Add admin email
router.post('/admin-emails', requireAdmin, async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    const currentUser = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: { email: true }
    });

    const adminEmail = await prisma.adminEmail.create({
      data: {
        email: email.toLowerCase(),
        addedBy: currentUser?.email || 'unknown',
      }
    });

    const existingUser = await prisma.user.findUnique({
      where: { email: email.toLowerCase() }
    });

    if (existingUser) {
      await prisma.user.update({
        where: { id: existingUser.id },
        data: {
          isAdmin: true,
          isStaff: true,
          role: 'ADMIN',
          hasAccessToQuestionBank: true,
          hasAccessToTimedPractice: true,
          hasAccessToAnalytics: true,
        }
      });
    }

    res.json({ 
      success: true, 
      adminEmail,
      userUpdated: !!existingUser
    });
  } catch (error: any) {
    if (error.code === 'P2002') {
      return res.status(400).json({ error: 'This email is already an admin' });
    }
    res.status(500).json({ error: error.message });
  }
});

// Remove admin email
router.delete('/admin-emails/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const adminEmail = await prisma.adminEmail.findUnique({
      where: { id }
    });

    if (!adminEmail) {
      return res.status(404).json({ error: 'Admin email not found' });
    }

    await prisma.adminEmail.delete({
      where: { id }
    });

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Toggle admin email active status
router.patch('/admin-emails/:id/toggle', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const adminEmail = await prisma.adminEmail.findUnique({
      where: { id }
    });

    if (!adminEmail) {
      return res.status(404).json({ error: 'Admin email not found' });
    }

    const updated = await prisma.adminEmail.update({
      where: { id },
      data: { isActive: !adminEmail.isActive }
    });

    res.json(updated);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get recent audit logs (admin only)
router.get('/audit-logs', requireAdmin, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 100;
    const logs = await AuditLogger.getRecentLogs(limit);
    
    res.json({
      status: 'success',
      data: { logs },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get user-specific audit logs
router.get('/audit-logs/user/:userId', requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const limit = parseInt(req.query.limit as string) || 50;
    const logs = await AuditLogger.getUserLogs(userId, limit);
    
    res.json({
      status: 'success',
      data: { logs },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get failed login attempts
router.get('/audit-logs/failed-logins', requireAdmin, async (req, res) => {
  try {
    const hours = parseInt(req.query.hours as string) || 24;
    const logs = await AuditLogger.getFailedLogins(hours);
    
    res.json({
      status: 'success',
      data: { logs },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
export default router;