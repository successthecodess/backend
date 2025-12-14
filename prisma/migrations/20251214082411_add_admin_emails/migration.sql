-- CreateTable
CREATE TABLE "admin_emails" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "addedBy" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "admin_emails_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "admin_emails_email_key" ON "admin_emails"("email");

-- CreateIndex
CREATE INDEX "admin_emails_email_idx" ON "admin_emails"("email");
