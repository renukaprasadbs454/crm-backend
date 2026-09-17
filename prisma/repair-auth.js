import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const accounts = [
  { key: 'platform', email: process.env.SEED_ADMIN_EMAIL || 'admin@skill99.com', password: process.env.SEED_ADMIN_PASSWORD || 'Admin@123', name: 'Skill99 Platform Admin', role: 'PLATFORM_ADMIN' },
  { key: 'owner', email: process.env.SEED_OWNER_EMAIL || 'owner@skill99.com', password: process.env.SEED_OWNER_PASSWORD || 'Admin@123', name: 'Skill99 Owner', role: 'COMPANY_ADMIN' },
  { key: 'admin', email: process.env.SEED_COMPANY_ADMIN_EMAIL || 'companyadmin@skill99.com', password: process.env.SEED_COMPANY_ADMIN_PASSWORD || 'Admin@12345', name: 'Skill99 Company Admin', role: 'COMPANY_ADMIN' },
  { key: 'tl', email: 'tl@skill99.com', password: process.env.SEED_TL_PASSWORD || 'Tl@12345', name: 'Priya (Team Lead)', role: 'TL' },
  { key: 'sales', email: 'sales@skill99.com', password: process.env.SEED_SALES_PASSWORD || 'Sales@123', name: 'Sales Rep', role: 'SALES' },
  { key: 'solo', email: process.env.SEED_SOLO_EMAIL || 'solo@skill99.com', password: process.env.SEED_SOLO_PASSWORD || 'Solo@12345', name: 'Skill99 Solo User', role: 'SOLO' },
];

async function main() {
  const ownerExisting = await prisma.crmUser.findUnique({ where: { email: accounts[1].email.toLowerCase() } });
  let company = ownerExisting?.companyId ? await prisma.company.findUnique({ where: { id: ownerExisting.companyId } }) : null;

  if (!company) {
    const existingCompany = await prisma.company.findFirst({ orderBy: { createdAt: 'asc' } });
    if (existingCompany) company = existingCompany;
  }

  if (!company) {
    throw new Error('No company workspace exists. Run `npm run db:seed` once to create the demo workspace.');
  }

  let team = await prisma.team.findFirst({ where: { companyId: company.id }, orderBy: { createdAt: 'asc' } });
  const owner = await upsertUser(accounts[1], { companyId: company.id });
  if (company.ownerId !== owner.id) {
    company = await prisma.company.update({ where: { id: company.id }, data: { ownerId: owner.id } });
  }

  await upsertUser(accounts[0], { companyId: null, teamId: null });
  await upsertUser(accounts[2], { companyId: company.id, teamId: null });

  const tl = await upsertUser(accounts[3], { companyId: company.id, teamId: null });
  if (!team) {
    team = await prisma.team.create({ data: { name: "Priya's Team", companyId: company.id, tlId: tl.id } });
  } else if (team.tlId !== tl.id) {
    team = await prisma.team.update({ where: { id: team.id }, data: { tlId: tl.id } });
  }

  await prisma.crmUser.update({ where: { id: tl.id }, data: { teamId: null } });
  await upsertUser(accounts[4], { companyId: company.id, teamId: team.id });
  await upsertUser(accounts[5], { companyId: null, teamId: null });

  const client = await prisma.client.findUnique({ where: { email: 'converted@example.com' } });
  if (client) {
    await prisma.client.update({
      where: { id: client.id },
      data: { status: 'ACTIVE', companyId: company.id },
    });
  } else {
    console.log('Demo client not found; run `npm run db:seed` to create it.');
  }

  console.log('Authentication repair complete.');
  for (const a of accounts) console.log(`${a.role.padEnd(16)} ${a.email} / ${a.password}`);
}

async function upsertUser(account, scope) {
  const password = await bcrypt.hash(account.password, 10);
  return prisma.crmUser.upsert({
    where: { email: account.email.toLowerCase() },
    update: {
      name: account.name,
      password,
      role: account.role,
      companyId: scope.companyId ?? null,
      teamId: scope.teamId ?? null,
      isActive: true,
      isVerified: true,
      verifiedAt: new Date(),
      passwordSetAt: new Date(),
    },
    create: {
      email: account.email.toLowerCase(),
      name: account.name,
      password,
      role: account.role,
      companyId: scope.companyId ?? null,
      teamId: scope.teamId ?? null,
      isActive: true,
      isVerified: true,
      verifiedAt: new Date(),
      passwordSetAt: new Date(),
    },
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
