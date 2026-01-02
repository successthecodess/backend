-- AlterTable
ALTER TABLE "users" ADD COLUMN     "freeTrialCompletedAt" TIMESTAMP(3),
ADD COLUMN     "hasUsedFreeTrial" BOOLEAN NOT NULL DEFAULT false;
