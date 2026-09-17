import 'dotenv/config';
import bcrypt from 'bcryptjs';
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
    await prisma.plan.upsert({ where: { tier: plan.tier }, update: plan, create: plan });
  }
}


/**
 * Demo-data seed for the multi-tenant schema. Creates one Company with a
 * Company Owner, one TL + their Team, one Sales rep under that team, and
 * a handful of leads/clients/projects/payments/etc, all correctly stamped
 * with companyId/teamId so the scoping rules in src/utils/scope.js show
 * the right data to whoever logs in.
 *
 * Run `npm run db:backfill-multitenant` at least once first, so the Plan
 * catalog exists — this script depends on the COMPANY_STARTER plan.
 */
async function main() {
  await seedPlans();
  const ownerEmail = (process.env.SEED_OWNER_EMAIL || 'owner@skill99.com').toLowerCase();
  const ownerPassword = process.env.SEED_OWNER_PASSWORD || 'Admin@123';
  const platformEmail = (process.env.SEED_ADMIN_EMAIL || 'admin@skill99.com').toLowerCase();
  const platformPassword = process.env.SEED_ADMIN_PASSWORD || 'Admin@123';
  const ownerName = process.env.SEED_OWNER_NAME || 'Skill99 Owner';

  const ownerHash = await bcrypt.hash(ownerPassword, 10);

  // ── Company + Owner ──────────────────────────────────────────────────
  let owner = await prisma.crmUser.findUnique({ where: { email: ownerEmail } });
  let company;

  if (owner?.companyId) {
    company = await prisma.company.findUnique({ where: { id: owner.companyId } });
  }

  if (!owner) {
    owner = await prisma.crmUser.create({
      data: { email: ownerEmail, password: ownerHash, name: ownerName, role: 'COMPANY_ADMIN', isVerified: true, verifiedAt: new Date(), passwordSetAt: new Date() },
    });
  } else {
    owner = await prisma.crmUser.update({
      where: { id: owner.id },
      data: { name: ownerName, password: ownerHash, role: 'COMPANY_ADMIN', isActive: true, isVerified: true, verifiedAt: new Date(), passwordSetAt: new Date() },
    });
  }

  if (!company) {
    company = await prisma.company.create({
      data: { name: 'Skill99', status: 'ACTIVE', ownerId: owner.id },
    });
    owner = await prisma.crmUser.update({ where: { id: owner.id }, data: { companyId: company.id } });
  }

  // ── Platform Admin (metadata/billing only) ────────────────────────────
  const platformHash = await bcrypt.hash(platformPassword, 10);
  const platformAdmin = await prisma.crmUser.upsert({
    where: { email: platformEmail },
    update: { name: 'Skill99 Platform Admin', password: platformHash, role: 'PLATFORM_ADMIN', companyId: null, teamId: null, isActive: true, isVerified: true, verifiedAt: new Date(), passwordSetAt: new Date() },
    create: { email: platformEmail, password: platformHash, name: 'Skill99 Platform Admin', role: 'PLATFORM_ADMIN', isActive: true, isVerified: true, verifiedAt: new Date(), passwordSetAt: new Date() },
  });

  // ── Solo demo workspace ───────────────────────────────────────────────
  const soloEmail = (process.env.SEED_SOLO_EMAIL || 'solo@skill99.com').toLowerCase();
  const soloPassword = process.env.SEED_SOLO_PASSWORD || 'Solo@12345';
  const soloHash = await bcrypt.hash(soloPassword, 10);
  const solo = await prisma.crmUser.upsert({
    where: { email: soloEmail },
    update: { name: 'Skill99 Solo User', password: soloHash, role: 'SOLO', companyId: null, teamId: null, isActive: true, isVerified: true, verifiedAt: new Date(), passwordSetAt: new Date(), phone: process.env.SEED_SOLO_PHONE || null },
    create: { email: soloEmail, password: soloHash, name: 'Skill99 Solo User', role: 'SOLO', isActive: true, isVerified: true, verifiedAt: new Date(), passwordSetAt: new Date(), phone: process.env.SEED_SOLO_PHONE || null },
  });
  const soloPlan = await prisma.plan.findUnique({ where: { tier: 'SOLO_FREE' } });
  if (soloPlan) {
    await prisma.subscription.upsert({
      where: { soloUserId: solo.id },
      update: {},
      create: { soloUserId: solo.id, planId: soloPlan.id, status: 'ACTIVE', currentPeriodEnd: new Date(Date.now() + 30 * 86400000) },
    });
  }

  const starterPlan = await prisma.plan.findUnique({ where: { tier: 'COMPANY_STARTER' } });
  if (starterPlan) {
    await prisma.subscription.upsert({
      where: { companyId: company.id },
      update: {},
      create: {
        companyId: company.id,
        planId: starterPlan.id,
        status: 'ACTIVE',
        currentPeriodEnd: new Date(Date.now() + 30 * 86400000),
      },
    });
  }

  // ── Company Admin demo ────────────────────────────────────────────────
  const companyAdminEmail = process.env.SEED_COMPANY_ADMIN_EMAIL || 'companyadmin@skill99.com';
  const companyAdminPassword = process.env.SEED_COMPANY_ADMIN_PASSWORD || 'Admin@12345';
  const companyAdminHash = await bcrypt.hash(companyAdminPassword, 10);
  const companyAdmin = await prisma.crmUser.upsert({
    where: { email: companyAdminEmail },
    update: { name: 'Skill99 Company Admin', password: companyAdminHash, role: 'COMPANY_ADMIN', companyId: company.id, teamId: null, isActive: true, isVerified: true, verifiedAt: new Date(), passwordSetAt: new Date() },
    create: { email: companyAdminEmail, password: companyAdminHash, name: 'Skill99 Company Admin', role: 'COMPANY_ADMIN', companyId: company.id, isActive: true, isVerified: true, verifiedAt: new Date(), passwordSetAt: new Date() },
  });

  // ── TL + Team ─────────────────────────────────────────────────────────
  const tlEmail = 'tl@skill99.com';
  const tlPassword = process.env.SEED_TL_PASSWORD || 'Tl@12345';
  const tlHash = await bcrypt.hash(tlPassword, 10);
  const tl = await prisma.crmUser.upsert({
    where: { email: tlEmail },
    update: {
      name: 'Priya (Team Lead)',
      password: tlHash,
      role: 'TL',
      companyId: company.id,
      teamId: null,
      isActive: true,
      isVerified: true,
      verifiedAt: new Date(),
      passwordSetAt: new Date(),
    },
    create: {
      email: tlEmail,
      password: tlHash,
      name: 'Priya (Team Lead)',
      role: 'TL',
      companyId: company.id,
      isActive: true,
      isVerified: true,
      verifiedAt: new Date(),
      passwordSetAt: new Date(),
    },
  });
  let team = await prisma.team.findUnique({ where: { tlId: tl.id } });
  if (!team) {
    team = await prisma.team.create({
      data: { name: "Priya's Team", companyId: company.id, tlId: tl.id },
    });
  }

  // ── Sales rep under that team ────────────────────────────────────────
  const salesEmail = 'sales@skill99.com';
  const salesPassword = process.env.SEED_SALES_PASSWORD || 'Sales@123';
  const salesHash = await bcrypt.hash(salesPassword, 10);
  const sales = await prisma.crmUser.upsert({
    where: { email: salesEmail },
    update: {
      name: 'Sales Rep',
      password: salesHash,
      role: 'SALES',
      companyId: company.id,
      teamId: team.id,
      isActive: true,
      isVerified: true,
      verifiedAt: new Date(),
      passwordSetAt: new Date(),
    },
    create: {
      email: salesEmail,
      password: salesHash,
      name: 'Sales Rep',
      role: 'SALES',
      companyId: company.id,
      teamId: team.id,
      isActive: true,
      isVerified: true,
      verifiedAt: new Date(),
      passwordSetAt: new Date(),
    },
  });

  let org = await prisma.organization.findFirst();
  if (!org) {
    org = await prisma.organization.create({
      data: { name: 'Skill99', publicSlug: 'skill99', currency: 'INR' },
    });
  }

  // ── Demo CRM data, all stamped with companyId/teamId ─────────────────
  const tenant = { companyId: company.id, teamId: team.id };

  const wonLead = await prisma.lead.upsert({
    where: { phone: '9900112233' },
    update: { ...tenant },
    create: {
      phone: '9900112233',
      fullName: 'Converted Alum',
      email: 'converted@example.com',
      collegeName: 'National College',
      collegeCity: 'Bengaluru',
      collegeCourse: 'B.Sc',
      collegeYear: 'Final year',
      interest: 'INTERESTED',
      stage: 'WON',
      source: 'REFERRAL',
      comments: 'Enrolled in the Full Stack program.',
      convertedAt: new Date(),
      convertedRef: 'STU-1001',
      assignedToId: sales.id,
      createdById: sales.id,
      ...tenant,
    },
  });

  await prisma.lead.upsert({
    where: { phone: '9876543210' },
    update: { ...tenant },
    create: {
      phone: '9876543210',
      fullName: 'Sample Student',
      email: 'student@example.com',
      collegeName: 'Sample Engineering College',
      collegeCity: 'Hyderabad',
      collegeCourse: 'B.Tech CSE',
      collegeYear: '3rd year',
      interest: 'INTERESTED',
      stage: 'QUALIFIED',
      source: 'MANUAL',
      comments: 'Called once — wants Full Stack info.',
      assignedToId: sales.id,
      createdById: sales.id,
      ...tenant,
    },
  });

  await prisma.lead.upsert({
    where: { phone: '9812345678' },
    update: { ...tenant },
    create: {
      phone: '9812345678',
      fullName: 'Website Enquiry',
      email: 'lead@example.com',
      collegeName: 'City Institute of Technology',
      collegeCity: 'Pune',
      collegeCourse: 'BCA',
      collegeYear: '2nd year',
      interest: 'ON_HOLD',
      stage: 'NEW',
      source: 'WEBSITE',
      comments: 'Submitted the callback form.',
      assignedToId: sales.id,
      createdById: sales.id,
      ...tenant,
    },
  });

  const client = await prisma.client.upsert({
    where: { leadId: wonLead.id },
    update: {
      name: 'Converted Alum',
      email: 'converted@example.com',
      phone: '9900112233',
      company: 'National College',
      status: 'ACTIVE',
      ownerId: sales.id,
      companyId: company.id,
    },
    create: {
      name: 'Converted Alum',
      email: 'converted@example.com',
      phone: '9900112233',
      company: 'National College',
      status: 'ACTIVE',
      leadId: wonLead.id,
      ownerId: sales.id,
      companyId: company.id,
    },
  });

  let project = await prisma.project.findFirst({ where: { clientId: client.id } });
  if (!project) {
    project = await prisma.project.create({
      data: {
        title: 'Full Stack Bootcamp',
        description: '12-week program enrollment',
        status: 'ONGOING',
        budget: 45000,
        clientId: client.id,
        ownerId: sales.id,
        startDate: new Date(),
        companyId: company.id,
      },
    });
  }

  let retainer = await prisma.retainer.findFirst({ where: { clientId: client.id } });
  if (!retainer) {
    retainer = await prisma.retainer.create({
      data: {
        title: 'Career Mentorship',
        status: 'ACTIVE',
        monthlyAmount: 2999,
        clientId: client.id,
        ownerId: sales.id,
        companyId: company.id,
      },
    });
  }

  const paymentCount = await prisma.payment.count({ where: { companyId: company.id } });
  if (paymentCount === 0) {
    await prisma.payment.createMany({
      data: [
        {
          title: 'Bootcamp fee — installment 1',
          amount: 15000,
          type: 'REVENUE',
          status: 'RECEIVED',
          paidAt: new Date(),
          clientId: client.id,
          projectId: project.id,
          recordedById: sales.id,
          companyId: company.id,
        },
        {
          title: 'Ad spend',
          amount: 2500,
          type: 'EXPENSE',
          status: 'RECEIVED',
          paidAt: new Date(),
          category: 'Marketing',
          recordedById: owner.id,
          companyId: company.id,
        },
      ],
    });
  }

  const meetingCount = await prisma.meeting.count({ where: { companyId: company.id } });
  if (meetingCount === 0) {
    const starts = new Date();
    starts.setDate(starts.getDate() + 2);
    starts.setHours(11, 0, 0, 0);
    await prisma.meeting.create({
      data: {
        title: 'Onboarding call',
        startsAt: starts,
        status: 'SCHEDULED',
        clientId: client.id,
        hostId: sales.id,
        reminderMin: 15,
        companyId: company.id,
      },
    });
  }

  const taskCount = await prisma.task.count({ where: { companyId: company.id } });
  if (taskCount === 0) {
    await prisma.task.create({
      data: {
        title: 'Send welcome kit',
        status: 'TODO',
        priority: 1,
        clientId: client.id,
        projectId: project.id,
        assigneeId: sales.id,
        dueAt: new Date(Date.now() + 86400000),
        companyId: company.id,
      },
    });
  }

  const reviewCount = await prisma.review.count({ where: { companyId: company.id } });
  if (reviewCount === 0) {
    await prisma.review.create({
      data: {
        rating: 5,
        comment: 'Great mentoring sessions!',
        reviewer: 'Converted Alum',
        clientId: client.id,
        isPublic: true,
        companyId: company.id,
      },
    });
  }

  console.log('Seed complete');
  console.log(`Company: ${company.name} (${company.id})`);
  console.log(`Platform Admin: ${platformAdmin.email} / ${platformPassword}`);
  console.log(`Company Admin: ${owner.email} / ${ownerPassword}`);
  console.log(`Company Admin: ${companyAdminEmail} / ${companyAdminPassword}`);
  console.log(`Team Lead:     ${tlEmail} / ${tlPassword}`);
  console.log(`Sales:         ${salesEmail} / ${salesPassword}`);
  console.log(`Solo:          ${soloEmail} / ${soloPassword}`);
  console.log(`Org slug: ${org.publicSlug}`);
  console.log('\nPlatform Admin has metadata-only access; it cannot open CRM records.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
