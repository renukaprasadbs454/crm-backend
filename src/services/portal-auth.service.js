import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import prisma from '../utils/prisma.js';
import { env } from '../config/env.js';
import { signToken } from '../utils/jwt.js';
import { AppError } from '../middleware/errorHandler.js';

function randomPassword() {
  return crypto.randomBytes(24).toString('hex');
}

function frontendCallbackUrl(type, token) {
  const base = env.frontendUrl.replace(/\/$/, '');
  return `${base}/auth/google/callback#token=${encodeURIComponent(token)}&type=${encodeURIComponent(type)}`;
}

function requireGoogleConfig() {
  if (!env.googleClientId || !env.googleClientSecret || !env.googleRedirectUri) {
    throw new AppError('Google auth is not configured on server', 400);
  }
}

export function buildGoogleStartUrl(mode = 'staff') {
  requireGoogleConfig();
  const state = Buffer.from(JSON.stringify({ mode })).toString('base64url');
  const params = new URLSearchParams({
    client_id: env.googleClientId,
    redirect_uri: env.googleRedirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'offline',
    prompt: 'consent',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

async function fetchGoogleUserFromCode(code) {
  requireGoogleConfig();
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.googleClientId,
      client_secret: env.googleClientSecret,
      redirect_uri: env.googleRedirectUri,
      grant_type: 'authorization_code',
    }),
  });
  if (!tokenRes.ok) {
    throw new AppError('Google token exchange failed', 400);
  }
  const tokenJson = await tokenRes.json();
  const accessToken = tokenJson.access_token;
  if (!accessToken) {
    throw new AppError('Google access token missing', 400);
  }

  const profileRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!profileRes.ok) {
    throw new AppError('Google profile fetch failed', 400);
  }
  return profileRes.json();
}

function parseState(state) {
  try {
    const decoded = Buffer.from(state || '', 'base64url').toString('utf8');
    const parsed = JSON.parse(decoded);
    return parsed?.mode === 'client' ? 'client' : 'staff';
  } catch {
    return 'staff';
  }
}

export async function handleGoogleCallback(code, state) {
  const mode = parseState(state);
  const profile = await fetchGoogleUserFromCode(code);
  const email = String(profile.email || '').toLowerCase();
  if (!email) throw new AppError('Google account email is required', 400);

  if (mode === 'client') {
    let client = await prisma.client.findFirst({
      where: { OR: [{ googleId: profile.sub || undefined }, { email }] },
    });
    if (!client) {
      client = await prisma.client.create({
        data: {
          name: profile.name || email,
          email,
          googleId: profile.sub || null,
          portalEnabled: true,
          status: 'ACTIVE',
        },
      });
    } else {
      client = await prisma.client.update({
        where: { id: client.id },
        data: {
          googleId: profile.sub || client.googleId,
          portalEnabled: true,
          lastLoginAt: new Date(),
          name: client.name || profile.name || email,
        },
      });
    }
    const token = signToken({ sub: client.id, kind: 'client' });
    return frontendCallbackUrl('client', token);
  }

  let user = await prisma.crmUser.findUnique({ where: { email } });
  if (!user) {
    user = await prisma.crmUser.create({
      data: {
        email,
        password: await bcrypt.hash(randomPassword(), 10),
        name: profile.name || email.split('@')[0],
        role: 'SALES',
        isActive: true,
      },
    });
  }
  const token = signToken({ sub: user.id, role: user.role, kind: 'staff' });
  return frontendCallbackUrl('staff', token);
}

export async function clientRegister({ name, email, password, phone, company }) {
  const normalizedEmail = email.toLowerCase();
  let client = await prisma.client.findUnique({ where: { email: normalizedEmail } });
  const passwordHash = await bcrypt.hash(password, 10);
  if (client) {
    client = await prisma.client.update({
      where: { id: client.id },
      data: {
        name: name || client.name,
        phone: phone || client.phone,
        company: company || client.company,
        passwordHash,
        portalEnabled: true,
        status: client.status || 'ACTIVE',
        lastLoginAt: new Date(),
      },
    });
  } else {
    client = await prisma.client.create({
      data: {
        name,
        email: normalizedEmail,
        phone: phone || null,
        company: company || null,
        passwordHash,
        portalEnabled: true,
        status: 'ACTIVE',
        lastLoginAt: new Date(),
      },
    });
  }
  const token = signToken({ sub: client.id, kind: 'client' });
  return { token, client: publicClient(client) };
}

function publicClient(client) {
  return {
    id: client.id,
    name: client.name,
    email: client.email,
    phone: client.phone,
    company: client.company,
    status: client.status,
  };
}

export async function clientLogin(email, password) {
  const client = await prisma.client.findUnique({ where: { email: email.toLowerCase() } });
  if (!client || !client.portalEnabled || !client.passwordHash) {
    throw new AppError('Invalid email or password', 401);
  }
  const ok = await bcrypt.compare(password, client.passwordHash);
  if (!ok) throw new AppError('Invalid email or password', 401);

  const updated = await prisma.client.update({
    where: { id: client.id },
    data: { lastLoginAt: new Date() },
  });
  const token = signToken({ sub: updated.id, kind: 'client' });
  return { token, client: publicClient(updated) };
}

export async function getClientMe(clientId) {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      company: true,
      status: true,
      createdAt: true,
    },
  });
  if (!client) throw new AppError('Client not found', 404);
  return client;
}

export async function getClientPortalDashboard(clientId) {
  const [client, projects, retainers, payments, meetings, tasks, messages] = await Promise.all([
    prisma.client.findUnique({
      where: { id: clientId },
      select: { id: true, name: true, company: true, status: true },
    }),
    prisma.project.findMany({
      where: { clientId },
      orderBy: { updatedAt: 'desc' },
      take: 8,
    }),
    prisma.retainer.findMany({
      where: { clientId },
      orderBy: { updatedAt: 'desc' },
      take: 6,
    }),
    prisma.payment.findMany({
      where: { clientId },
      orderBy: { createdAt: 'desc' },
      take: 12,
    }),
    prisma.meeting.findMany({
      where: { clientId },
      orderBy: { startsAt: 'asc' },
      take: 8,
    }),
    prisma.task.findMany({
      where: { clientId },
      orderBy: [{ status: 'asc' }, { dueAt: 'asc' }],
      take: 12,
    }),
    prisma.message.findMany({
      where: { clientId },
      orderBy: { createdAt: 'desc' },
      take: 12,
      include: { sender: { select: { name: true } } },
    }),
  ]);
  if (!client) throw new AppError('Client not found', 404);

  const totals = payments.reduce(
    (acc, p) => {
      const amount = Number(p.amount || 0);
      if (p.type === 'REVENUE') acc.projectValue += amount;
      if (p.type === 'REVENUE' && p.status === 'RECEIVED') acc.received += amount;
      if (p.type === 'EXPENSE' && p.status === 'RECEIVED') acc.expenses += amount;
      return acc;
    },
    { projectValue: 0, received: 0, expenses: 0 }
  );

  return {
    client,
    counts: {
      projects: projects.length,
      ongoingProjects: projects.filter((p) => p.status === 'ONGOING').length,
      completedProjects: projects.filter((p) => p.status === 'COMPLETED').length,
      retainers: retainers.filter((r) => r.status === 'ACTIVE').length,
      meetings: meetings.filter((m) => m.status === 'SCHEDULED').length,
      tasksOpen: tasks.filter((t) => t.status !== 'DONE').length,
      unreadMessages: messages.filter((m) => !m.isRead).length,
    },
    finance: {
      projectValue: totals.projectValue,
      received: totals.received,
      pending: Math.max(0, totals.projectValue - totals.received),
      expenses: totals.expenses,
      moneyInAccount: totals.received - totals.expenses,
    },
    projects,
    retainers,
    payments,
    meetings,
    tasks,
    messages,
  };
}
