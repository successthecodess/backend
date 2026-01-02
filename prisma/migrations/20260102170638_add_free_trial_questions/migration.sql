-- CreateTable
CREATE TABLE "FreeTrialQuestion" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FreeTrialQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FreeTrialQuestion_orderIndex_key" ON "FreeTrialQuestion"("orderIndex");

-- CreateIndex
CREATE INDEX "FreeTrialQuestion_orderIndex_idx" ON "FreeTrialQuestion"("orderIndex");

-- AddForeignKey
ALTER TABLE "FreeTrialQuestion" ADD CONSTRAINT "FreeTrialQuestion_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
