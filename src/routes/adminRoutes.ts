import { Router } from 'express';
import prisma from '../config/database.js';
import { requireAdmin, requireStaff } from '../middleware/rbac.js';
import { authenticateToken } from '../middleware/auth.js';
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
    res.json(user);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
// ==========================================
// ADMIN EMAIL MANAGEMENT (Super Admin Only)
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

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    // Get current admin user
    const currentUser = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: { email: true }
    });

    // Create admin email
    const adminEmail = await prisma.adminEmail.create({
      data: {
        email: email.toLowerCase(),
        addedBy: currentUser?.email || 'unknown',
      }
    });

    // If user already exists, grant them admin access
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

    // Get the email before deleting
    const adminEmail = await prisma.adminEmail.findUnique({
      where: { id }
    });

    if (!adminEmail) {
      return res.status(404).json({ error: 'Admin email not found' });
    }

    // Delete the admin email
    await prisma.adminEmail.delete({
      where: { id }
    });

    // Optionally revoke admin access from user
    // (You might want to keep their admin status even after email is removed)
    // Uncomment if you want to revoke:
    /*
    const user = await prisma.user.findUnique({
      where: { email: adminEmail.email }
    });

    if (user) {
      await prisma.user.update({
        where: { id: user.id },
        data: {
          isAdmin: false,
          isStaff: false,
          role: 'STUDENT',
        }
      });
    }
    */

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

// Sync user tags from GHL (admin only)
router.post('/users/:id/sync-tags', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const user = await prisma.user.findUnique({
      where: { id },
      select: { ghlUserId: true, ghlCompanyId: true }
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

    const tags = contactResponse.data.contact.tags || [];

    // Update user with tags
    const updatedUser = await prisma.user.update({
      where: { id },
      data: { ghlTags: tags }
    });

    res.json({
      success: true,
      tags,
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
      }
    });

    let synced = 0;
    let failed = 0;
    const errors: any[] = [];

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

        const tags = contactResponse.data.contact.tags || [];

        await prisma.user.update({
          where: { id: user.id },
          data: { ghlTags: tags }
        });

        synced++;
      } catch (error: any) {
        failed++;
        errors.push({ email: user.email, error: error.message });
      }
    }

    res.json({
      success: true,
      synced,
      failed,
      total: users.length,
      errors: errors.slice(0, 10), // Return first 10 errors
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;