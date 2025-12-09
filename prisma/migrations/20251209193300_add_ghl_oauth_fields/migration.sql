/*
  Warnings:

  - A unique constraint covering the columns `[ghlUserId]` on the table `users` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "users" ADD COLUMN     "ghlAccessToken" TEXT,
ADD COLUMN     "ghlCompanyId" TEXT,
ADD COLUMN     "ghlLocationId" TEXT,
ADD COLUMN     "ghlRefreshToken" TEXT,
ADD COLUMN     "ghlTokenExpiry" TIMESTAMP(3),
ADD COLUMN     "ghlUserId" TEXT,
ALTER COLUMN "password" DROP NOT NULL;

-- CreateTable
CREATE TABLE "PlatformSettings" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlatformSettings_key_key" ON "PlatformSettings"("key");

-- CreateIndex
CREATE UNIQUE INDEX "users_ghlUserId_key" ON "users"("ghlUserId");

-- RenameIndex
ALTER INDEX "progress_userId_unitId_topicId_key" RENAME TO "userId_unitId_topicId";
