-- Client registration and client login (the client portal) have been
-- removed. The Client model itself stays (companies still track clients,
-- projects, and payments internally) — only the columns that existed
-- solely to authenticate a client into the portal are dropped.

DROP INDEX IF EXISTS "clients_googleId_key";

ALTER TABLE "clients" DROP COLUMN IF EXISTS "passwordHash";
ALTER TABLE "clients" DROP COLUMN IF EXISTS "googleId";
ALTER TABLE "clients" DROP COLUMN IF EXISTS "portalEnabled";
ALTER TABLE "clients" DROP COLUMN IF EXISTS "lastLoginAt";
