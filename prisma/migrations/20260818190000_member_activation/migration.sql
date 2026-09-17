-- Member activation / WhatsApp OTP
CREATE TYPE "OtpPurpose" AS ENUM ('USER_ACTIVATION', 'LOGIN');

ALTER TABLE "crm_users"
  ADD COLUMN "isVerified" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "verifiedAt" TIMESTAMP(3),
  ADD COLUMN "passwordSetAt" TIMESTAMP(3);

UPDATE "crm_users" SET "verifiedAt" = CURRENT_TIMESTAMP, "passwordSetAt" = CURRENT_TIMESTAMP WHERE "isVerified" = true;

CREATE TABLE "otp_challenges" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "purpose" "OtpPurpose" NOT NULL DEFAULT 'USER_ACTIVATION',
  "codeHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "otp_challenges_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "otp_challenges_userId_purpose_createdAt_idx" ON "otp_challenges"("userId", "purpose", "createdAt");
CREATE INDEX "otp_challenges_expiresAt_idx" ON "otp_challenges"("expiresAt");

ALTER TABLE "otp_challenges"
  ADD CONSTRAINT "otp_challenges_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "crm_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
