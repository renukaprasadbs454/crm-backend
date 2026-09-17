CREATE TYPE "LeadDetailType" AS ENUM ('COLLEGE', 'COMPANY');

ALTER TABLE "leads"
  ADD COLUMN "detailType" "LeadDetailType" NOT NULL DEFAULT 'COLLEGE',
  ADD COLUMN "companyName" TEXT,
  ADD COLUMN "companyCity" TEXT,
  ADD COLUMN "companyIndustry" TEXT,
  ADD COLUMN "companySize" TEXT,
  ALTER COLUMN "collegeName" DROP NOT NULL;

CREATE INDEX "leads_companyName_idx" ON "leads"("companyName");