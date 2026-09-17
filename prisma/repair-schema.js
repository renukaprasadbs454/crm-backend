import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function hasColumn(table, column) {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2
    LIMIT 1
  `, table, column);
  return rows.length > 0;
}

async function hasType(typeName) {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT 1 FROM pg_type WHERE typname = $1 LIMIT 1
  `, typeName);
  return rows.length > 0;
}

async function addEnumValue(typeName, value) {
  if (!(await hasType(typeName))) return;
  await prisma.$executeRawUnsafe(`ALTER TYPE "${typeName}" ADD VALUE IF NOT EXISTS '${value}'`);
}

async function main() {
  console.log('Skill99 CRM schema repair starting…');

  // Preserve legacy enum values; only add values required by the current app.
  await addEnumValue('Role', 'COMPANY_ADMIN');
  await addEnumValue('OtpPurpose', 'LOGIN');
  await addEnumValue('OtpPurpose', 'PASSWORD_RESET');
  await addEnumValue('RecordingUploadStatus', 'UPLOADED');

  if (await hasColumn('call_sessions', 'id')) {
    const columns = [
      ['deliveredAt', 'TIMESTAMP(3)'],
      ['ringingAt', 'TIMESTAMP(3)'],
      ['connectedAt', 'TIMESTAMP(3)'],
      ['endedAt', 'TIMESTAMP(3)'],
      ['durationSeconds', 'INTEGER NOT NULL DEFAULT 0'],
      ['failureReason', 'TEXT'],
    ];
    for (const [name, type] of columns) {
      if (!(await hasColumn('call_sessions', name))) {
        await prisma.$executeRawUnsafe(`ALTER TABLE "call_sessions" ADD COLUMN "${name}" ${type}`);
        console.log(`Added call_sessions.${name}`);
      }
    }

    if (!(await hasColumn('call_sessions', 'idempotencyKey'))) {
      await prisma.$executeRawUnsafe(`ALTER TABLE "call_sessions" ADD COLUMN "idempotencyKey" TEXT`);
      await prisma.$executeRawUnsafe(`UPDATE "call_sessions" SET "idempotencyKey" = md5(random()::text || clock_timestamp()::text || id) WHERE "idempotencyKey" IS NULL`);
      await prisma.$executeRawUnsafe(`ALTER TABLE "call_sessions" ALTER COLUMN "idempotencyKey" SET NOT NULL`);
      console.log('Added and backfilled call_sessions.idempotencyKey');
    }
    await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "call_sessions_idempotencyKey_key" ON "call_sessions"("idempotencyKey")`);
  }

  // Company registration metadata. Existing rows remain valid because all are nullable.
  if (await hasColumn('companies', 'id')) {
    const companyColumns = [
      ['industry', 'TEXT'],
      ['employeeCount', 'INTEGER'],
      ['website', 'TEXT'],
      ['contactPhone', 'TEXT'],
      ['city', 'TEXT'],
    ];
    for (const [name, type] of companyColumns) {
      if (!(await hasColumn('companies', name))) {
        await prisma.$executeRawUnsafe(`ALTER TABLE "companies" ADD COLUMN "${name}" ${type}`);
        console.log(`Added companies.${name}`);
      }
    }
  }

  console.log('Schema repair complete. Existing CRM data was preserved.');
}

main()
  .catch((error) => {
    console.error('Schema repair failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
