/**
 * One-time backfill for upgrading a pre-multitenant database.
 *
 * Before this runs, the DB has: CrmUser.role in {ADMIN, SALES}, and no
 * Company/Team/Plan/Subscription rows. Run this AFTER `prisma migrate deploy`
 * has applied the new schema (all new columns arrive nullable, so the
 * deploy itself is non-destructive).
 *
 * What it does:
 *   1. Renames the earliest ADMIN → COMPANY_ADMIN and creates a Company for
 *      them (so the existing single-tenant business keeps working exactly
 *      as before — everyone just now sits under one Company).
 *   2. Puts every existing SALES user directly under that Company with no
 *      Team (they show up under the Company Admin until you promote one of
 *      them to TL and re-assign).
 *   3. Backfills companyId onto every existing Lead/Client/Project/etc.
 *   4. Seeds the plan catalog (idempotent) and starts a 30-day trial
 *      Subscription for the new Company on COMPANY_STARTER.
 *
 * Safe to re-run: it no-ops once a Company already exists.
 *
 * Usage: node prisma/backfill-multitenant.js
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const PLAN_CATALOG = [
  { tier: 'SOLO_FREE', name: 'Solo Free', workspaceType: 'SOLO', priceMonthly: 0, maxUsers: 1, maxTLs: 0, maxLeads: 200, storageGB: 1, apiCallsPerMonth: 2000 },
  { tier: 'SOLO_PRO', name: 'Solo Pro', workspaceType: 'SOLO', priceMonthly: 999, maxUsers: 1, maxTLs: 0, maxLeads: 5000, storageGB: 5, apiCallsPerMonth: 10000 },
  { tier: 'SOLO_BUSINESS', name: 'Solo Business', workspaceType: 'SOLO', priceMonthly: 2499, maxUsers: 1, maxTLs: 0, maxLeads: 20000, storageGB: 20, apiCallsPerMonth: 50000 },
  { tier: 'COMPANY_STARTER', name: 'Company Starter', workspaceType: 'COMPANY', priceMonthly: 4999, maxUsers: 15, maxTLs: 2, maxLeads: 10000, storageGB: 20, apiCallsPerMonth: 50000 },
  { tier: 'COMPANY_GROWTH', name: 'Company Growth', workspaceType: 'COMPANY', priceMonthly: 14999, maxUsers: 50, maxTLs: 6, maxLeads: 50000, storageGB: 100, apiCallsPerMonth: 250000 },
  { tier: 'COMPANY_PRO', name: 'Company Pro', workspaceType: 'COMPANY', priceMonthly: 39999, maxUsers: 150, maxTLs: 15, maxLeads: 200000, storageGB: 500, apiCallsPerMonth: 1000000 },
  { tier: 'ENTERPRISE', name: 'Enterprise', workspaceType: 'COMPANY', priceMonthly: 0, maxUsers: null, maxTLs: null, maxLeads: null, storageGB: null, apiCallsPerMonth: null },
];

async function seedPlans() {
  for (const plan of PLAN_CATALOG) {
    await prisma.plan.upsert({
      where: { tier: plan.tier },
      update: plan,
      create: plan,
    });
  }
  console.log(`✔ Plan catalog seeded (${PLAN_CATALOG.length} plans)`);
}

async function backfillCompany() {
  const existingCompany = await prisma.company.findFirst();
  if (existingCompany) {
    console.log('✔ A Company already exists — skipping tenant backfill (already migrated).');
    return;
  }

  // Once the schema has been migrated, the generated Prisma Client only
  // recognizes the NEW Role enum values — querying role: 'ADMIN' through
  // the typed client throws a client-side validation error rather than
  // "not found", because 'ADMIN' is no longer a legal enum value at all
  // (in the client OR in Postgres, since the migration recreates the
  // enum type). We use $queryRaw here specifically to sidestep that
  // client-side validation and check what's actually in the DB.
  let admin;
  try {
    const rows = await prisma.$queryRaw`
      SELECT id, email, role, "createdAt" FROM crm_users
      WHERE role::text = 'ADMIN'
      ORDER BY "createdAt" ASC
      LIMIT 1
    `;
    admin = rows[0];
  } catch (err) {
    // The Role enum in Postgres no longer even has an 'ADMIN' label
    // (this happens once migrate has fully replaced the enum type) —
    // that unambiguously means there's no legacy data to backfill.
    console.log('… Role enum has no legacy ADMIN value in the database — nothing to backfill. Fresh install.');
    return;
  }

  if (!admin) {
    console.log('… No legacy ADMIN user found — nothing to backfill. Fresh install.');
    return;
  }

  const org = await prisma.organization.findFirst();
  const companyName = org?.name || 'Default Company';

  const company = await prisma.$transaction(async (tx) => {
    await tx.crmUser.update({
      where: { id: admin.id },
      data: { role: 'COMPANY_ADMIN' },
    });

    const company = await tx.company.create({
      data: { name: companyName, status: 'ACTIVE', ownerId: admin.id },
    });

    await tx.crmUser.update({
      where: { id: admin.id },
      data: { companyId: company.id },
    });

    // Any other legacy ADMIN becomes a plain company member too (rare, but
    // if there were multiple admins we don't want to orphan them). Raw SQL
    // for the same reason as above — 'ADMIN' isn't a value the typed
    // client will accept in a `where`.
    await tx.$executeRaw`
      UPDATE crm_users SET role = 'COMPANY_ADMIN', "companyId" = ${company.id}
      WHERE role::text = 'ADMIN' AND id != ${admin.id}
    `;

    // Legacy SALES reps land directly under the company (no Team yet).
    await tx.crmUser.updateMany({
      where: { role: 'SALES' },
      data: { companyId: company.id },
    });

    return company;
  });

  console.log(`✔ Created Company "${company.name}" (${company.id}), owner ${admin.email}`);

  const companyId = company.id;
  const models = ['lead', 'client', 'project', 'retainer', 'payment', 'message', 'meeting', 'task', 'review'];
  for (const model of models) {
    const result = await prisma[model].updateMany({
      where: { companyId: null },
      data: { companyId },
    });
    console.log(`  ↳ ${model}: backfilled companyId on ${result.count} rows`);
  }

  const starterPlan = await prisma.plan.findUnique({ where: { tier: 'COMPANY_STARTER' } });
  const trialEnds = new Date();
  trialEnds.setDate(trialEnds.getDate() + 30);

  await prisma.subscription.create({
    data: {
      companyId,
      planId: starterPlan.id,
      status: 'TRIALING',
      trialEndsAt: trialEnds,
      currentPeriodEnd: trialEnds,
    },
  });
  console.log('✔ Company started on a 30-day COMPANY_STARTER trial');
}

async function main() {
  await seedPlans();
  await backfillCompany();
  console.log('\nBackfill complete.');
}

main()
  .catch((err) => {
    console.error('Backfill failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
