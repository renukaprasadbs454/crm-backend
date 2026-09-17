-- Merge COMPANY_OWNER into COMPANY_ADMIN: a company now has one flat
-- "Company Admin" tier instead of a separate Owner/Admin split, so there
-- is a single company-level login instead of two.

-- 1) Move any existing COMPANY_OWNER users onto COMPANY_ADMIN before the
--    enum value is removed.
UPDATE "crm_users" SET "role" = 'COMPANY_ADMIN' WHERE "role" = 'COMPANY_OWNER';

-- 2) Postgres can't DROP a value from an enum type directly, so rebuild
--    the type without COMPANY_OWNER and swap the column over to it.
CREATE TYPE "Role_new" AS ENUM ('PLATFORM_ADMIN', 'COMPANY_ADMIN', 'TL', 'SALES', 'SOLO');

ALTER TABLE "crm_users" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "crm_users" ALTER COLUMN "role" TYPE "Role_new" USING ("role"::text::"Role_new");
ALTER TABLE "crm_users" ALTER COLUMN "role" SET DEFAULT 'SALES';

DROP TYPE "Role";
ALTER TYPE "Role_new" RENAME TO "Role";
