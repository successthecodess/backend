-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "UserRole" ADD VALUE 'INSTRUCTOR';
ALTER TYPE "UserRole" ADD VALUE 'SUPER_ADMIN';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "ghlTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "hasAccessToAnalytics" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "hasAccessToQuestionBank" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "hasAccessToTimedPractice" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isAdmin" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isStaff" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "feature_flags" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT,
    "requiredGhlTag" TEXT,
    "requiresPremium" BOOLEAN NOT NULL DEFAULT false,
    "requiresStaff" BOOLEAN NOT NULL DEFAULT false,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "feature_flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "course_access" (
    "id" TEXT NOT NULL,
    "courseName" TEXT NOT NULL,
    "courseSlug" TEXT NOT NULL,
    "requiredGhlTag" TEXT NOT NULL,
    "fallbackToFlag" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "course_access_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "feature_flags_name_key" ON "feature_flags"("name");

-- CreateIndex
CREATE INDEX "feature_flags_name_idx" ON "feature_flags"("name");

-- CreateIndex
CREATE UNIQUE INDEX "course_access_courseSlug_key" ON "course_access"("courseSlug");

-- CreateIndex
CREATE INDEX "course_access_courseSlug_idx" ON "course_access"("courseSlug");

-- CreateIndex
CREATE INDEX "course_access_requiredGhlTag_idx" ON "course_access"("requiredGhlTag");
