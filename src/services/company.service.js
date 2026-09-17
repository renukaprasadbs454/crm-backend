import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import prisma from '../utils/prisma.js';
import { signToken } from '../utils/jwt.js';
import { AppError } from '../middleware/errorHandler.js';
import { getTeamMemberIds } from '../utils/scope.js';
import { requestActivationOtp } from './member-activation.service.js';
import { env } from '../config/env.js';
import Razorpay from 'razorpay';

function razorpayClient() {
  if (!env.razorpayKeyId || !env.razorpayKeySecret) {
    throw new AppError('Razorpay is not configured. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.', 503);
  }
  return new Razorpay({ key_id: env.razorpayKeyId, key_secret: env.razorpayKeySecret });
}

async function verifyPayment(data, plan) {
  if ([data.razorpayOrderId, data.razorpayPaymentId, data.razorpaySignature].some((value) => !value)) {
    throw new AppError('Complete Razorpay payment before creating the workspace.', 402);
  }
  const expected = crypto.createHmac('sha256', env.razorpayKeySecret)
    .update(`${data.razorpayOrderId}|${data.razorpayPaymentId}`).digest('hex');
  if (expected !== data.razorpaySignature) throw new AppError('Razorpay payment verification failed.', 400);
  const order = await razorpayClient().orders.fetch(data.razorpayOrderId);
  if (order.status !== 'paid' || order.amount !== Math.round(Number(plan.priceMonthly) * 100) || order.currency !== plan.currency || order.notes?.planTier !== plan.tier) {
    throw new AppError('Razorpay order does not match the selected plan.', 400);
  }
}

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    companyName: user.companyName ?? null,
    phone: user.phone,
    role: user.role,
    isActive: user.isActive,
    isVerified: user.isVerified,
    passwordSetAt: user.passwordSetAt,
    companyId: user.companyId ?? null,
    teamId: user.teamId ?? null,
  };
}

async function getPlan(tier) {
  const plan = await prisma.plan.findUnique({ where: { tier } });
  if (!plan) throw new AppError(`Unknown plan tier: ${tier}`, 400);
  return plan;
}

function assertPlanType(plan, workspaceType) {
  if (plan.workspaceType !== workspaceType || !plan.isActive) {
    throw new AppError('This plan is not available for the selected workspace type.', 400);
  }
}

export async function createSignupOrder({ planTier }) {
  const plan = await getPlan(planTier);
  if (plan.tier === 'SOLO_FREE') {
    return { free: true, plan: { tier: plan.tier, name: plan.name, amount: 0, currency: plan.currency } };
  }
  if (Number(plan.priceMonthly) <= 0) throw new AppError('This plan requires a configured price before signup.', 400);
  const order = await razorpayClient().orders.create({
    amount: Math.round(Number(plan.priceMonthly) * 100),
    currency: plan.currency,
    receipt: `signup_${crypto.randomUUID()}`,
    notes: { planTier: plan.tier },
  });
  return { free: false, keyId: env.razorpayKeyId, orderId: order.id, amount: order.amount, currency: order.currency, plan: { tier: plan.tier, name: plan.name } };
}

function trialEndDate(days = 7) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

// ── Signup: brand-new workspaces ─────────────────────────────────────────

export async function registerSolo(data) {
  const email = data.email.toLowerCase();
  const existing = await prisma.crmUser.findUnique({ where: { email } });
  if (existing) throw new AppError('An account with this email already exists', 409);
  const pending = await prisma.pendingSignup.findUnique({ where: { email } });
  if (pending) throw new AppError('This signup is already waiting for verification', 409);

  const plan = await getPlan(data.planTier || 'SOLO_FREE');
  assertPlanType(plan, 'SOLO');
  if (plan.tier !== 'SOLO_FREE') await verifyPayment(data, plan);
  const { password: _password, ...payload } = data;
  const signup = await prisma.pendingSignup.create({ data: { email, phone: data.phone || null, name: data.name, role: 'SOLO', payload: { ...payload, email, planTier: plan.tier }, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) } });
  return { activationPending: true, email: signup.email, channel: data.verificationChannel };
}

export async function registerCompany(data) {
  const email = data.email.toLowerCase();
  const existing = await prisma.crmUser.findUnique({ where: { email } });
  if (existing) throw new AppError('An account with this email already exists', 409);
  const pending = await prisma.pendingSignup.findUnique({ where: { email } });
  if (pending) throw new AppError('This signup is already waiting for verification', 409);

  const plan = await getPlan(data.planTier || 'COMPANY_STARTER');
  assertPlanType(plan, 'COMPANY');
  if (data.razorpayOrderId || data.razorpayPaymentId || data.razorpaySignature) await verifyPayment(data, plan);
  const { password: _password, ...payload } = data;
  const signup = await prisma.pendingSignup.create({ data: { email, phone: data.phone || null, name: data.name, role: 'COMPANY_ADMIN', payload: { ...payload, email, planTier: plan.tier }, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) } });
  return { activationPending: true, email: signup.email, channel: data.verificationChannel };
}

// ── Company-scoped member management ────────────────────────────────────

function assertPlanRoom(company, memberCount, tlCount, addingTL) {
  const plan = company.subscription?.plan;
  if (!plan) return; // no active plan on record — don't hard-block, billing flow handles this
  if (plan.maxUsers != null && memberCount + 1 > plan.maxUsers) {
    throw new AppError(`Your plan allows up to ${plan.maxUsers} users. Upgrade to add more.`, 402);
  }
  if (addingTL && plan.maxTLs != null && tlCount + 1 > plan.maxTLs) {
    throw new AppError(`Your plan allows up to ${plan.maxTLs} team leads. Upgrade to add more.`, 402);
  }
}

/** A Company Admin adds another Company Admin. New accounts activate through WhatsApp OTP. */
export async function addCompanyAdmin(data, actor) {
  if (actor.role !== 'COMPANY_ADMIN') throw new AppError('Only a Company Admin can add another Company Admin', 403);
  const email = data.email.toLowerCase();
  const existing = await prisma.crmUser.findUnique({ where: { email } });
  if (existing) throw new AppError('An account with this email already exists', 409);
  const company = await prisma.company.findUnique({
    where: { id: actor.companyId },
    include: { subscription: { include: { plan: true } }, members: { select: { id: true, isActive: true } } },
  });
  if (!company) throw new AppError('Company not found', 404);
  assertPlanRoom(company, company.members.filter((m) => m.isActive).length, 0, false);
  const password = await bcrypt.hash(`invite-${crypto.randomUUID()}`, 10);
  const admin = await prisma.crmUser.create({
    data: { email, password, name: data.name, phone: data.phone || null, role: 'COMPANY_ADMIN', companyId: company.id, isVerified: false, verifiedAt: null, passwordSetAt: null },
  });
  try { await requestActivationOtp(admin.email); }
  catch (err) { await prisma.crmUser.delete({ where: { id: admin.id } }); throw err; }
  return { ...publicUser(admin), activationPending: true, otpSentTo: admin.phone };
}

/** A Company Admin adds a TL (and their 1:1 Team) under their own company. */
export async function addTeamLead(data, actor) {
  if (!['COMPANY_ADMIN'].includes(actor.role)) throw new AppError('Only a Company Admin can add a Team Lead', 403);

  const email = data.email.toLowerCase();
  const existing = await prisma.crmUser.findUnique({ where: { email } });
  if (existing) throw new AppError('An account with this email already exists', 409);

  const company = await prisma.company.findUnique({
    where: { id: actor.companyId },
    include: { subscription: { include: { plan: true } }, members: { select: { id: true, isActive: true } }, teams: { select: { id: true } } },
  });
  if (!company) throw new AppError('Company not found', 404);
  assertPlanRoom(company, company.members.filter((m) => m.isActive).length, await prisma.crmUser.count({ where: { companyId: company.id, role: 'TL', isActive: true } }), true);

  const password = await bcrypt.hash(`invite-${crypto.randomUUID()}`, 10);

  const tl = await prisma.$transaction(async (tx) => {
    const created = await tx.crmUser.create({
      data: {
        email,
        password,
        name: data.name,
        phone: data.phone || null,
        role: 'TL',
        companyId: company.id,
        isVerified: false,
        verifiedAt: null,
        passwordSetAt: null,
      },
    });
    await tx.team.create({
      data: {
        name: data.teamName || `${data.name}'s Team`,
        companyId: company.id,
        tlId: created.id,
      },
    });
    return created;
  });

  try {
    await requestActivationOtp(tl.email);
  } catch (err) {
    await prisma.team.deleteMany({ where: { tlId: tl.id } });
    await prisma.crmUser.delete({ where: { id: tl.id } });
    throw err;
  }
  return { ...publicUser(tl), activationPending: true, otpSentTo: tl.phone };
}

/**
 * A Company Admin or TL adds a Sales rep. A TL can only assign into their own
 * team (or omit teamId, defaulting to their own team); a Company Admin may
 * assign into any team in the company, or leave teamId null (reports
 * directly to the Company Admin).
 */
export async function addSalesperson(data, actor) {
  if (!['COMPANY_ADMIN', 'TL'].includes(actor.role)) {
    throw new AppError('Only a Company Admin or Team Lead can add a salesperson', 403);
  }

  const email = data.email.toLowerCase();
  const existing = await prisma.crmUser.findUnique({ where: { email } });
  if (existing) throw new AppError('An account with this email already exists', 409);

  const company = await prisma.company.findUnique({
    where: { id: actor.companyId },
    include: { subscription: { include: { plan: true } }, members: { select: { id: true, isActive: true } }, teams: { select: { id: true } } },
  });
  if (!company) throw new AppError('Company not found', 404);
  assertPlanRoom(company, company.members.filter((m) => m.isActive).length, await prisma.crmUser.count({ where: { companyId: company.id, role: 'TL', isActive: true } }), false);

  let teamId = data.teamId ?? null;
  if (actor.role === 'TL') {
    const ownTeam = await prisma.team.findUnique({ where: { tlId: actor.id } });
    if (!ownTeam) throw new AppError('You do not lead a team yet', 400);
    teamId = ownTeam.id; // TL cannot assign into someone else's team
  } else if (teamId) {
    const team = await prisma.team.findFirst({ where: { id: teamId, companyId: company.id } });
    if (!team) throw new AppError('Team not found in your company', 404);
  }

  const password = await bcrypt.hash(`invite-${crypto.randomUUID()}`, 10);
  const sales = await prisma.crmUser.create({
    data: {
      email,
      password,
      name: data.name,
      phone: data.phone || null,
      role: 'SALES',
      companyId: company.id,
      teamId,
      isVerified: false,
      verifiedAt: null,
      passwordSetAt: null,
    },
  });

  try {
    await requestActivationOtp(sales.email);
  } catch (err) {
    await prisma.crmUser.delete({ where: { id: sales.id } });
    throw err;
  }
  return { ...publicUser(sales), activationPending: true, otpSentTo: sales.phone };
}

/** List members visible to the actor: Company Admin sees everyone, TL sees their own team. */
export async function listMembers(actor) {
  if (['COMPANY_ADMIN'].includes(actor.role)) {
    const members = await prisma.crmUser.findMany({
      where: { companyId: actor.companyId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, email: true, name: true, phone: true, role: true, isActive: true, isVerified: true, passwordSetAt: true, createdAt: true,
        teamId: true, team: { select: { id: true, name: true } }, ledTeam: { select: { id: true, name: true } },
      },
    });
    return members;
  }
  if (actor.role === 'TL') {
    const ids = await getTeamMemberIds(actor);
    return prisma.crmUser.findMany({
      where: { id: { in: ids } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, email: true, name: true, phone: true, role: true, isActive: true, isVerified: true, passwordSetAt: true, createdAt: true, teamId: true, team: { select: { id: true, name: true } } },
    });
  }
  // SALES/SOLO only ever see themself via /auth/me — not this endpoint.
  throw new AppError('Forbidden', 403);
}

export async function updateMember(id, data, actor) {
  if (!['COMPANY_ADMIN', 'TL'].includes(actor.role)) throw new AppError('Forbidden', 403);

  const target = await prisma.crmUser.findUnique({ where: { id } });
  if (!target || target.companyId !== actor.companyId) throw new AppError('User not found', 404);

  if (actor.role === 'TL') {
    const memberIds = await getTeamMemberIds(actor);
    if (!memberIds.includes(id) || target.role !== 'SALES') {
      throw new AppError('You can only manage salespeople on your own team', 403);
    }
    delete data.teamId; // a TL cannot move someone to a different team
  }

  const payload = { ...data };
  if (payload.phone === '') payload.phone = null;
  if (actor.role === 'TL') {
    // re-guard even if middleware/validators are bypassed somehow
    delete payload.teamId;
  } else if (payload.teamId) {
    const team = await prisma.team.findFirst({ where: { id: payload.teamId, companyId: actor.companyId } });
    if (!team) throw new AppError('Team not found in your company', 404);
  }

  const updated = await prisma.crmUser.update({ where: { id }, data: payload });
  return publicUser(updated);
}

export async function resendMemberOtp(id, actor) {
  if (!['COMPANY_ADMIN', 'TL'].includes(actor.role)) throw new AppError('Forbidden', 403);
  const target = await prisma.crmUser.findUnique({ where: { id } });
  if (!target || target.companyId !== actor.companyId) throw new AppError('User not found', 404);
  if (actor.role === 'TL') {
    const memberIds = await getTeamMemberIds(actor);
    if (!memberIds.includes(id) || target.role !== 'SALES') throw new AppError('You can only manage salespeople on your own team', 403);
  }
  if (target.isVerified && target.passwordSetAt) throw new AppError('This account is already activated', 409);
  if (!target.phone) throw new AppError('This member has no WhatsApp phone number', 400);
  return requestActivationOtp(target.email);
}

export async function removeMember(id, actor) {
  if (!['COMPANY_ADMIN'].includes(actor.role)) throw new AppError('Only a Company Admin can deactivate company users', 403);

  const target = await prisma.crmUser.findUnique({ where: { id } });
  if (!target || target.companyId !== actor.companyId) throw new AppError('User not found', 404);
  if (id === actor.id) throw new AppError('You cannot remove your own account', 400);

  if (target.role === 'COMPANY_ADMIN') {
    const otherAdmins = await prisma.crmUser.count({
      where: { companyId: actor.companyId, role: 'COMPANY_ADMIN', id: { not: target.id } },
    });
    if (otherAdmins === 0) {
      throw new AppError('Cannot remove the last Company Admin. Add another Company Admin first.', 400);
    }
  }

  // A Company Admin controls account lifecycle. Delete the login/user record;
  // historical CRM records keep their data because their user foreign keys
  // are configured with SetNull where applicable. For a TL, deleting the TL
  // cascades their Team and the Team members are detached from that team.
  await prisma.crmUser.delete({ where: { id } });
  return true;
}

// ── Company-level dashboards (Company Admin / TL) ───────────────────────
// These are still CRM-adjacent (counts derived from CRM rows) but only
// ever reachable by someone already inside the company — never Platform Admin.

export async function companyDashboard(actor) {
  if (!['COMPANY_ADMIN'].includes(actor.role)) throw new AppError('Forbidden', 403);
  const companyId = actor.companyId;

  const [teams, totalLeads, wonLeads, salesCount, tlCount] = await Promise.all([
    prisma.team.findMany({
      where: { companyId },
      include: { tl: { select: { id: true, name: true } }, members: { select: { id: true } } },
    }),
    prisma.lead.count({ where: { companyId } }),
    prisma.lead.count({ where: { companyId, stage: 'WON' } }),
    prisma.crmUser.count({ where: { companyId, role: 'SALES', isActive: true } }),
    prisma.crmUser.count({ where: { companyId, role: 'TL', isActive: true } }),
  ]);

  const perTeam = await Promise.all(
    teams.map(async (team) => {
      const [leadCount, wonCount] = await Promise.all([
        prisma.lead.count({ where: { teamId: team.id } }),
        prisma.lead.count({ where: { teamId: team.id, stage: 'WON' } }),
      ]);
      return {
        teamId: team.id,
        teamName: team.name,
        tl: team.tl,
        salesCount: team.members.length,
        leads: leadCount,
        won: wonCount,
      };
    })
  );

  return {
    totalLeads,
    wonLeads,
    conversionRate: totalLeads ? Math.round((wonLeads / totalLeads) * 1000) / 10 : 0,
    salesCount,
    tlCount,
    teams: perTeam,
  };
}

export async function tlDashboard(actor) {
  if (actor.role !== 'TL') throw new AppError('Forbidden', 403);
  const team = await prisma.team.findUnique({
    where: { tlId: actor.id },
    include: { members: { select: { id: true, name: true, email: true, isActive: true } } },
  });
  if (!team) throw new AppError('You do not lead a team yet', 404);

  const [totalLeads, wonLeads] = await Promise.all([
    prisma.lead.count({ where: { teamId: team.id } }),
    prisma.lead.count({ where: { teamId: team.id, stage: 'WON' } }),
  ]);

  const perMember = await Promise.all(
    team.members.map(async (m) => {
      const [leadCount, wonCount] = await Promise.all([
        prisma.lead.count({ where: { assignedToId: m.id } }),
        prisma.lead.count({ where: { assignedToId: m.id, stage: 'WON' } }),
      ]);
      return { ...m, leads: leadCount, won: wonCount };
    })
  );

  return {
    teamId: team.id,
    teamName: team.name,
    totalLeads,
    wonLeads,
    conversionRate: totalLeads ? Math.round((wonLeads / totalLeads) * 1000) / 10 : 0,
    members: perMember,
  };
}

// ── Platform Admin: tenant + subscription management ────────────────────
// CRITICAL: every function below returns only counts/metadata. None of
// them ever select a Lead/Client/Project/Payment/etc. field. This is the
// enforced boundary described in the plan — Platform Admin manages
// tenants and billing, never touches business/CRM data.

export async function platformOverview() {
  const [
    totalCompanies,
    activeCompanies,
    trialCompanies,
    suspendedCompanies,
    totalTLs,
    totalSales,
    totalSoloUsers,
    totalLeads,
    activeSubscriptions,
  ] = await Promise.all([
    prisma.company.count(),
    prisma.company.count({ where: { status: 'ACTIVE' } }),
    prisma.company.count({ where: { status: 'TRIAL' } }),
    prisma.company.count({ where: { status: 'SUSPENDED' } }),
    prisma.crmUser.count({ where: { role: 'TL' } }),
    prisma.crmUser.count({ where: { role: 'SALES' } }),
    prisma.crmUser.count({ where: { role: 'SOLO' } }),
    prisma.lead.count(), // count only — no record fields are ever returned
    prisma.subscription.count({ where: { status: { in: ['ACTIVE', 'TRIALING'] } } }),
  ]);

  return {
    companies: { total: totalCompanies, active: activeCompanies, trial: trialCompanies, suspended: suspendedCompanies },
    users: { teamLeads: totalTLs, salespeople: totalSales, soloUsers: totalSoloUsers },
    totalLeadsAcrossPlatform: totalLeads,
    activeSubscriptions,
  };
}

export async function listCompanies(query) {
  const companies = await prisma.company.findMany({
    where: query.status ? { status: query.status } : undefined,
    orderBy: { createdAt: 'desc' },
    include: {
      owner: { select: { id: true, name: true, email: true } },
      subscription: { include: { plan: { select: { tier: true, name: true } } } },
      _count: { select: { members: true, teams: true } },
    },
  });

  // Attach lead COUNT per company (metadata), never the leads themselves.
  return Promise.all(
    companies.map(async (c) => {
      const leadCount = await prisma.lead.count({ where: { companyId: c.id } });
      return {
        id: c.id,
        name: c.name,
        status: c.status,
        owner: c.owner,
        plan: c.subscription?.plan ?? null,
        subscriptionStatus: c.subscription?.status ?? null,
        memberCount: c._count.members,
        teamCount: c._count.teams,
        leadCount,
        createdAt: c.createdAt,
      };
    })
  );
}

export async function getCompanyMetadata(id) {
  const company = await prisma.company.findUnique({
    where: { id },
    include: {
      owner: { select: { id: true, name: true, email: true } },
      subscription: { include: { plan: true } },
      teams: { select: { id: true, name: true, tlId: true } },
    },
  });
  if (!company) throw new AppError('Company not found', 404);

  const [salesCount, tlCount, leadCount, wonCount] = await Promise.all([
    prisma.crmUser.count({ where: { companyId: id, role: 'SALES' } }),
    prisma.crmUser.count({ where: { companyId: id, role: 'TL' } }),
    prisma.lead.count({ where: { companyId: id } }),
    prisma.lead.count({ where: { companyId: id, stage: 'WON' } }),
  ]);

  return {
    id: company.id,
    name: company.name,
    status: company.status,
    owner: company.owner,
    subscription: company.subscription,
    teams: company.teams,
    salesCount,
    tlCount,
    leadCount,
    wonCount,
    createdAt: company.createdAt,
  };
}

export async function updateCompanyStatus(id, status) {
  const company = await prisma.company.findUnique({ where: { id } });
  if (!company) throw new AppError('Company not found', 404);
  return prisma.company.update({ where: { id }, data: { status } });
}

export async function updatePlatformCompany(id, data) {
  const company = await prisma.company.findUnique({ where: { id }, select: { id: true, ownerId: true } });
  if (!company) throw new AppError('Company not found', 404);
  if (data.ownerEmail) {
    const duplicate = await prisma.crmUser.findFirst({ where: { email: data.ownerEmail.toLowerCase(), NOT: { id: company.ownerId } } });
    if (duplicate) throw new AppError('An account with this email already exists', 409);
  }
  return prisma.$transaction(async (tx) => {
    const updated = await tx.company.update({ where: { id }, data: data.companyName ? { name: data.companyName } : {} });
    if (data.ownerName || data.ownerEmail) await tx.crmUser.update({ where: { id: company.ownerId }, data: { ...(data.ownerName ? { name: data.ownerName } : {}), ...(data.ownerEmail ? { email: data.ownerEmail.toLowerCase() } : {}) } });
    return updated;
  });
}

export async function deletePlatformCompany(id) {
  const company = await prisma.company.findUnique({ where: { id }, select: { id: true } });
  if (!company) throw new AppError('Company not found', 404);
  return prisma.company.delete({ where: { id } });
}

/** Platform Admin creating a Company on a client's behalf (sales-assisted onboarding). */
export async function platformCreateCompany(data) {
  const email = data.ownerEmail.toLowerCase();
  const existing = await prisma.crmUser.findUnique({ where: { email } });
  if (existing) throw new AppError('An account with this email already exists', 409);
  if (await prisma.pendingSignup.findUnique({ where: { email } })) throw new AppError('This signup is already waiting for verification', 409);

  const plan = await getPlan(data.planTier || 'COMPANY_STARTER');
  const signup = await prisma.pendingSignup.create({ data: { email, phone: data.ownerPhone || null, name: data.ownerName, role: 'COMPANY_ADMIN', payload: { ...data, ownerEmail: email, planTier: plan.tier }, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) } });
  return { activationPending: true, email: signup.email, channel: data.verificationChannel };
}

export async function listPlans() {
  return prisma.plan.findMany({ where: { isActive: true }, orderBy: [{ workspaceType: 'asc' }, { priceMonthly: 'asc' }] });
}

export async function updatePlan(tier, data) {
  const plan = await prisma.plan.findUnique({ where: { tier } });
  if (!plan) throw new AppError('Plan not found', 404);
  return prisma.plan.update({ where: { tier }, data });
}

export async function deletePlan(tier) {
  const plan = await prisma.plan.findUnique({ where: { tier }, select: { id: true } });
  if (!plan) throw new AppError('Plan not found', 404);
  const subscriptionCount = await prisma.subscription.count({ where: { planId: plan.id } });
  if (subscriptionCount > 0) throw new AppError('This plan cannot be deleted while it has subscriptions. Delete those subscriptions first.', 409);
  await prisma.plan.delete({ where: { tier } });
}

export async function createPlan(data) {
  const existing = await prisma.plan.findUnique({ where: { tier: data.tier } });
  if (existing) throw new AppError('A plan with this tier already exists. Edit the existing plan instead.', 409);
  return prisma.plan.create({ data: { ...data, tier: data.tier.toUpperCase(), currency: data.currency.toUpperCase() } });
}

// Platform Admin freelancer metadata only. No CRM record fields are returned.
export async function platformCreateSolo(data) {
  const email = data.email.toLowerCase();
  if (await prisma.crmUser.findUnique({ where: { email } })) throw new AppError('An account with this email already exists', 409);
  if (await prisma.pendingSignup.findUnique({ where: { email } })) throw new AppError('This signup is already waiting for verification', 409);
  const plan = await getPlan(data.planTier);
  if (plan.workspaceType !== 'SOLO') throw new AppError('Selected plan is not a Solo plan', 400);
  const signup = await prisma.pendingSignup.create({ data: { email, phone: data.phone || null, name: data.name, role: 'SOLO', payload: { ...data, email, planTier: plan.tier }, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) } });
  return { activationPending: true, email: signup.email, channel: data.verificationChannel };
}

export async function listFreelancers() {
  const users = await prisma.crmUser.findMany({
    where: { role: 'SOLO' },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      isActive: true,
      createdAt: true,
      soloSubscription: { include: { plan: { select: { tier: true, name: true, priceMonthly: true } } } },
    },
  });
  return users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone,
    isActive: u.isActive,
    createdAt: u.createdAt,
    plan: u.soloSubscription?.plan ?? null,
    subscriptionStatus: u.soloSubscription?.status ?? null,
  }));
}

export async function updateCompanySubscription(companyId, data) {
  const plan = await getPlan(data.planTier);
  if (plan.workspaceType !== 'COMPANY') throw new AppError('Selected plan is not a Company plan', 400);
  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { id: true } });
  if (!company) throw new AppError('Company not found', 404);

  const subscription = await prisma.subscription.upsert({
    where: { companyId },
    update: {
      planId: plan.id,
      ...(data.status ? { status: data.status } : {}),
      currentPeriodEnd: trialEndDate(30),
    },
    create: {
      companyId,
      planId: plan.id,
      status: data.status || 'ACTIVE',
      currentPeriodEnd: trialEndDate(30),
    },
    include: { plan: true },
  });
  return subscription;
}

export async function deleteCompanySubscription(companyId) {
  const subscription = await prisma.subscription.findUnique({ where: { companyId }, select: { id: true } });
  if (!subscription) throw new AppError('Company has no subscription', 404);
  await prisma.subscription.delete({ where: { companyId } });
}

export async function updateSoloSubscription(userId, data) {
  const plan = await getPlan(data.planTier);
  if (plan.workspaceType !== 'SOLO') throw new AppError('Selected plan is not a Solo plan', 400);
  const user = await prisma.crmUser.findFirst({ where: { id: userId, role: 'SOLO' }, select: { id: true } });
  if (!user) throw new AppError('Freelancer not found', 404);
  return prisma.subscription.upsert({
    where: { soloUserId: userId },
    update: { planId: plan.id, ...(data.status ? { status: data.status } : {}), currentPeriodEnd: trialEndDate(30) },
    create: { soloUserId: userId, planId: plan.id, status: data.status || 'ACTIVE', currentPeriodEnd: trialEndDate(30) },
    include: { plan: true },
  });
}

export async function deleteSoloSubscription(userId) {
  const subscription = await prisma.subscription.findUnique({ where: { soloUserId: userId }, select: { id: true } });
  if (!subscription) throw new AppError('Freelancer has no subscription', 404);
  await prisma.subscription.delete({ where: { soloUserId: userId } });
}

export async function updateSoloStatus(userId, isActive) {
  const user = await prisma.crmUser.findFirst({ where: { id: userId, role: 'SOLO' }, select: { id: true } });
  if (!user) throw new AppError('Freelancer not found', 404);
  return prisma.crmUser.update({ where: { id: userId }, data: { isActive }, select: { id: true, isActive: true } });
}

export async function checkoutSubscription(actor, data) {
  const plan = await getPlan(data.planTier);
  const expectedType = actor.role === 'SOLO' ? 'SOLO' : 'COMPANY';
  assertPlanType(plan, expectedType);
  if (plan.tier !== 'SOLO_FREE') await verifyPayment(data, plan);
  const where = actor.role === 'SOLO' ? { soloUserId: actor.id } : { companyId: actor.companyId };
  return prisma.subscription.update({ where, data: { planId: plan.id, status: 'ACTIVE', currentPeriodEnd: trialEndDate(30), trialEndsAt: null, razorpayOrderId: data.razorpayOrderId || null, razorpayPaymentId: data.razorpayPaymentId || null, paidAt: data.razorpayPaymentId ? new Date() : null }, include: { plan: true } });
}

export async function updatePlatformSolo(userId, data) {
  const user = await prisma.crmUser.findFirst({ where: { id: userId, role: 'SOLO' }, select: { id: true } });
  if (!user) throw new AppError('Freelancer not found', 404);
  return prisma.crmUser.update({ where: { id: userId }, data: { ...(data.name ? { name: data.name } : {}), ...(data.email ? { email: data.email.toLowerCase() } : {}), ...(data.phone !== undefined ? { phone: data.phone } : {}) }, select: { id: true, name: true, email: true, phone: true } });
}

export async function deletePlatformSolo(userId) {
  const user = await prisma.crmUser.findFirst({ where: { id: userId, role: 'SOLO' }, select: { id: true } });
  if (!user) throw new AppError('Freelancer not found', 404);
  return prisma.crmUser.delete({ where: { id: userId } });
}
