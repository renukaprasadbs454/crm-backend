import 'dotenv/config';
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

try {
  for (const plan of PLAN_CATALOG) {
    await prisma.plan.upsert({ where: { tier: plan.tier }, update: plan, create: plan });
  }
  console.log(`Seeded ${PLAN_CATALOG.length} subscription plans.`);
} finally {
  await prisma.$disconnect();
}
