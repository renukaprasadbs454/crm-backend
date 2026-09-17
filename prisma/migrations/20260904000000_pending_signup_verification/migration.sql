CREATE TABLE "pending_signups" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "phone" TEXT,
  "name" TEXT NOT NULL,
  "role" "Role" NOT NULL,
  "payload" JSONB NOT NULL,
  "otpChannel" TEXT,
  "otpCodeHash" TEXT,
  "otpExpiresAt" TIMESTAMP(3),
  "otpAttempts" INTEGER NOT NULL DEFAULT 0,
  "otpSentAt" TIMESTAMP(3),
  "otpVerifiedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "pending_signups_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "pending_signups_email_key" ON "pending_signups"("email");
CREATE INDEX "pending_signups_expiresAt_idx" ON "pending_signups"("expiresAt");