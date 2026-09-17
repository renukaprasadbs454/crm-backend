import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import prisma from '../utils/prisma.js';
import { signToken, verifyToken } from '../utils/jwt.js';
import { AppError } from '../middleware/errorHandler.js';
import { env } from '../config/env.js';
import { sendOtpWhatsApp } from './whatsapp.service.js';
import { sendEmail } from './email.service.js';

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    phone: user.phone,
    role: user.role,
    isActive: user.isActive,
    isVerified: user.isVerified,
    passwordSetAt: user.passwordSetAt,
    companyId: user.companyId ?? null,
    teamId: user.teamId ?? null,
  };
}

function hashOtp(code) {
  return crypto.createHash('sha256').update(`${code}:${env.jwtSecret}`).digest('hex');
}

function generateOtp() {
  return String(crypto.randomInt(100000, 1000000));
}


function maskEmail(email) {
  const [local, domain] = String(email || '').split('@');
  if (!domain) return 'your email';
  const visible = local.length <= 2 ? local.slice(0, 1) : local.slice(0, 2);
  return `${visible}${'*'.repeat(Math.max(1, local.length - visible.length))}@${domain}`;
}

function maskPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length < 4) return 'your WhatsApp';
  return `+${'*'.repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;
}

function normalizeIdentifier(value) {
  return String(value || '').trim().toLowerCase();
}

async function resolveUser({ identifier, companyId, companyName, role }) {
  const value = normalizeIdentifier(identifier);
  if (!value) throw new AppError('Email or mobile number is required', 400);

  const companyFilter = companyId
    ? { companyId }
    : companyName
      ? { company: { name: { equals: companyName.trim(), mode: 'insensitive' } } }
      : {};

  const roleFilter = role ? { role } : {};

  const emailUser = value.includes('@')
    ? await prisma.crmUser.findFirst({
        where: { email: value, ...companyFilter, ...roleFilter },
        include: { company: { select: { id: true, name: true, status: true } } },
      })
    : null;

  if (emailUser) return emailUser;

  const phoneDigits = value.replace(/\D/g, '');
  if (!phoneDigits) throw new AppError('Enter a valid email or mobile number', 400);

  const candidates = await prisma.crmUser.findMany({
    where: {
      ...companyFilter,
      ...roleFilter,
      OR: [
        { phone: { contains: phoneDigits } },
        { phone: { contains: phoneDigits.replace(/^91/, '') } },
      ],
    },
    include: { company: { select: { id: true, name: true, status: true } } },
  });

  return candidates[0] || null;
}

function assertLoginAllowed(user, requestedRole) {
  if (!user || !user.isActive) throw new AppError('Invalid login details', 401);
  if (requestedRole && user.role !== requestedRole) {
    throw new AppError(`This account is not a ${requestedRole === 'TL' ? 'Team Lead' : requestedRole === 'SALES' ? 'Sales Rep' : requestedRole === 'COMPANY_ADMIN' ? 'Company Admin' : requestedRole} account.`, 403);
  }
  if (user.company && ['SUSPENDED', 'CANCELLED'].includes(user.company.status)) {
    throw new AppError('This company workspace is currently unavailable. Contact your administrator.', 403);
  }
  if (!user.isVerified || !user.passwordSetAt) {
    throw new AppError('Account not activated. Complete WhatsApp verification first.', 403);
  }
}

export async function login({ identifier, password, companyId, companyName, role }) {
  const user = await resolveUser({ identifier, companyId, companyName, role });
  assertLoginAllowed(user, role);

  const match = await bcrypt.compare(password, user.password);
  if (!match) throw new AppError('Invalid login details', 401);

  const token = signToken({ sub: user.id, role: user.role });
  return {
    token,
    user: publicUser(user),
    company: user.company ? { id: user.company.id, name: user.company.name, status: user.company.status } : null,
  };
}

async function createOtp(user, purpose) {
  if (!user.phone) throw new AppError('No WhatsApp number is registered for this account.', 400);

  const recent = await prisma.otpChallenge.findFirst({
    where: {
      userId: user.id,
      purpose,
      consumedAt: null,
      createdAt: { gte: new Date(Date.now() - 60_000) },
    },
    orderBy: { createdAt: 'desc' },
  });
  if (recent) throw new AppError('Please wait 60 seconds before requesting another OTP', 429);

  const otp = generateOtp();
  const expiresAt = new Date(Date.now() + env.otpExpiryMinutes * 60_000);
  const challenge = await prisma.otpChallenge.create({
    data: { userId: user.id, purpose, codeHash: hashOtp(otp), expiresAt },
  });

  try {
    await sendOtpWhatsApp(user.phone, otp);
  } catch (error) {
    await prisma.otpChallenge.delete({ where: { id: challenge.id } });
    throw error;
  }

  return { expiresInSeconds: env.otpExpiryMinutes * 60, phone: user.phone };
}

export async function requestLoginOtp({ identifier, companyId, companyName, role }) {
  const user = await resolveUser({ identifier, companyId, companyName, role });
  assertLoginAllowed(user, role);
  return createOtp(user, 'LOGIN');
}

export async function verifyLoginOtp({ identifier, otp, companyId, companyName, role }) {
  const user = await resolveUser({ identifier, companyId, companyName, role });
  assertLoginAllowed(user, role);

  const challenge = await prisma.otpChallenge.findFirst({
    where: { userId: user.id, purpose: 'LOGIN', consumedAt: null },
    orderBy: { createdAt: 'desc' },
  });

  if (!challenge || challenge.expiresAt < new Date()) {
    throw new AppError('OTP expired. Request a new OTP.', 400);
  }
  if (challenge.attempts >= env.otpMaxAttempts) {
    throw new AppError('Too many incorrect attempts. Request a new OTP.', 429);
  }

  const expected = Buffer.from(challenge.codeHash);
  const actual = Buffer.from(hashOtp(otp));
  const valid = expected.length === actual.length && crypto.timingSafeEqual(expected, actual);

  if (!valid) {
    await prisma.otpChallenge.update({
      where: { id: challenge.id },
      data: { attempts: { increment: 1 } },
    });
    throw new AppError('Incorrect OTP', 400);
  }

  await prisma.otpChallenge.update({
    where: { id: challenge.id },
    data: { consumedAt: new Date() },
  });

  const token = signToken({ sub: user.id, role: user.role });
  return {
    token,
    user: publicUser(user),
    company: user.company ? { id: user.company.id, name: user.company.name, status: user.company.status } : null,
  };
}

export async function requestPasswordReset({ identifier, channel = 'whatsapp', companyId, companyName, role }) {
  const user = await resolveUser({ identifier, companyId, companyName, role });
  if (!user || !user.isActive) throw new AppError('No active account was found for those details.', 404);
  if (user.company && ['SUSPENDED', 'CANCELLED'].includes(user.company.status)) {
    throw new AppError('This company workspace is currently unavailable.', 403);
  }

  const normalizedChannel = String(channel).toLowerCase();
  if (!['whatsapp', 'email'].includes(normalizedChannel)) {
    throw new AppError('Choose WhatsApp or email for the verification code.', 400);
  }
  if (normalizedChannel === 'whatsapp' && !user.phone) {
    throw new AppError('No WhatsApp number is registered for this account. Choose email instead.', 400);
  }
  if (normalizedChannel === 'email' && !user.email) {
    throw new AppError('No email is registered for this account. Choose WhatsApp instead.', 400);
  }

  const recent = await prisma.otpChallenge.findFirst({
    where: { userId: user.id, purpose: 'PASSWORD_RESET', consumedAt: null, createdAt: { gte: new Date(Date.now() - 60_000) } },
    orderBy: { createdAt: 'desc' },
  });
  if (recent) throw new AppError('Please wait 60 seconds before requesting another reset code.', 429);

  const otp = generateOtp();
  const expiresAt = new Date(Date.now() + env.otpExpiryMinutes * 60_000);
  const challenge = await prisma.otpChallenge.create({
    data: { userId: user.id, purpose: 'PASSWORD_RESET', codeHash: hashOtp(otp), expiresAt },
  });

  try {
    if (normalizedChannel === 'whatsapp') {
      await sendOtpWhatsApp(user.phone, otp);
    } else {
      await sendEmail({
        to: user.email,
        subject: 'Skill99 CRM password reset code',
        text: `Your Skill99 CRM password reset code is ${otp}. It expires in ${env.otpExpiryMinutes} minutes. Do not share this code.`,
        html: `<p>Your Skill99 CRM password reset code is <strong>${otp}</strong>.</p><p>It expires in ${env.otpExpiryMinutes} minutes. Do not share this code.</p>`,
      });
    }
  } catch (error) {
    await prisma.otpChallenge.delete({ where: { id: challenge.id } });
    throw error;
  }

  return { channel: normalizedChannel, expiresInSeconds: env.otpExpiryMinutes * 60, destination: normalizedChannel === 'whatsapp' ? maskPhone(user.phone) : maskEmail(user.email) };
}

export async function verifyPasswordResetOtp({ identifier, otp, companyId, companyName, role }) {
  const user = await resolveUser({ identifier, companyId, companyName, role });
  if (!user || !user.isActive) throw new AppError('Invalid reset details', 401);

  const challenge = await prisma.otpChallenge.findFirst({
    where: { userId: user.id, purpose: 'PASSWORD_RESET', consumedAt: null },
    orderBy: { createdAt: 'desc' },
  });
  if (!challenge || challenge.expiresAt < new Date()) throw new AppError('OTP expired. Request a new code.', 400);
  if (challenge.attempts >= env.otpMaxAttempts) throw new AppError('Too many incorrect attempts. Request a new code.', 429);

  const expected = Buffer.from(challenge.codeHash);
  const actual = Buffer.from(hashOtp(otp));
  const valid = expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  if (!valid) {
    await prisma.otpChallenge.update({ where: { id: challenge.id }, data: { attempts: { increment: 1 } } });
    throw new AppError('Incorrect OTP', 400);
  }

  await prisma.otpChallenge.update({ where: { id: challenge.id }, data: { consumedAt: new Date() } });
  const resetToken = signToken({ sub: user.id, role: user.role, type: 'PASSWORD_RESET' }, `${env.otpExpiryMinutes}m`);
  return { resetToken, expiresInSeconds: env.otpExpiryMinutes * 60 };
}

export async function resetPassword({ resetToken, password }) {
  let decoded;
  try { decoded = verifyToken(resetToken); }
  catch { throw new AppError('Reset session expired. Request a new OTP.', 401); }
  if (decoded?.type !== 'PASSWORD_RESET' || !decoded?.sub) throw new AppError('Invalid password reset session.', 401);

  const user = await prisma.crmUser.findUnique({ where: { id: decoded.sub } });
  if (!user || !user.isActive) throw new AppError('Account not available.', 404);
  const passwordHash = await bcrypt.hash(password, 12);
  const updated = await prisma.crmUser.update({
    where: { id: user.id },
    data: { password: passwordHash, isVerified: true, verifiedAt: user.verifiedAt || new Date(), passwordSetAt: new Date() },
    include: { company: { select: { id: true, name: true, status: true } } },
  });
  await prisma.otpChallenge.deleteMany({ where: { userId: user.id, purpose: 'PASSWORD_RESET', consumedAt: null } });
  const token = signToken({ sub: updated.id, role: updated.role });
  return { token, user: publicUser(updated), company: updated.company ? { id: updated.company.id, name: updated.company.name, status: updated.company.status } : null };
}

export async function getMe(userId) {
  const user = await prisma.crmUser.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      phone: true,
      role: true,
      isActive: true,
      isVerified: true,
      passwordSetAt: true,
      timezone: true,
      createdAt: true,
      companyId: true,
      teamId: true,
      company: { select: { id: true, name: true, status: true } },
      ledTeam: { select: { id: true, name: true } },
    },
  });
  if (!user) throw new AppError('User not found', 404);
  const subscription = user.companyId
    ? await prisma.subscription.findUnique({ where: { companyId: user.companyId }, select: { status: true, currentPeriodEnd: true, trialEndsAt: true, plan: { select: { tier: true, name: true } } } })
    : await prisma.subscription.findUnique({ where: { soloUserId: user.id }, select: { status: true, currentPeriodEnd: true, trialEndsAt: true, plan: { select: { tier: true, name: true } } } });
  return { ...user, subscription };
}

export async function listLoginCompanies(search = '') {
  const q = String(search || '').trim();
  return prisma.company.findMany({
    where: {
      status: { in: ['TRIAL', 'ACTIVE'] },
      ...(q ? { name: { contains: q, mode: 'insensitive' } } : {}),
    },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
    take: 50,
  });
}
