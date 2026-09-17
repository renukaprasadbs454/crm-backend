import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import prisma from '../utils/prisma.js';
import { signToken, verifyToken } from '../utils/jwt.js';
import { AppError } from '../middleware/errorHandler.js';
import { env } from '../config/env.js';
import { sendOtpWhatsApp } from './whatsapp.service.js';
import { sendEmail } from './email.service.js';

function hashOtp(code) {
  return crypto.createHash('sha256').update(`${code}:${env.jwtSecret}`).digest('hex');
}

function generateOtp() {
  return String(crypto.randomInt(100000, 1000000));
}

function activationPayload(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    phone: user.phone,
    role: user.role,
    companyId: user.companyId,
    teamId: user.teamId,
  };
}

async function findPendingSignup(identifier) {
  const value = String(identifier || '').trim();
  if (!value) return null;
  return value.includes('@')
    ? prisma.pendingSignup.findUnique({ where: { email: value.toLowerCase() } })
    : prisma.pendingSignup.findFirst({ where: { phone: { contains: value.replace(/\D/g, '') } }, orderBy: { createdAt: 'desc' } });
}

async function finalizePendingSignup(pending) {
  const data = pending.payload;
  const password = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 12);
  const result = await prisma.$transaction(async (tx) => {
    if (pending.role === 'SOLO') {
      const user = await tx.crmUser.create({ data: { email: pending.email, password, name: pending.name, companyName: data.companyName || null, phone: pending.phone || null, role: 'SOLO', isVerified: true, verifiedAt: new Date(), passwordSetAt: null } });
      const plan = await tx.plan.findUnique({ where: { tier: data.planTier } });
      if (!plan) throw new AppError('Signup plan is no longer available', 400);
      await tx.subscription.create({ data: { soloUserId: user.id, planId: plan.id, status: 'TRIALING', currentPeriodEnd: new Date(Date.now() + 7 * 86400000), trialEndsAt: new Date(Date.now() + 7 * 86400000), razorpayOrderId: data.razorpayOrderId || null, razorpayPaymentId: data.razorpayPaymentId || null, paidAt: data.razorpayPaymentId ? new Date() : null } });
      return user;
    }
    const user = await tx.crmUser.create({ data: { email: pending.email, password, name: pending.name, phone: data.phone || data.ownerPhone || null, role: 'COMPANY_ADMIN', isVerified: true, verifiedAt: new Date(), passwordSetAt: null } });
    const company = await tx.company.create({ data: { name: data.companyName, status: 'TRIAL', ownerId: user.id, industry: data.industry || null, employeeCount: data.employeeCount ? Number(data.employeeCount) : null, website: data.website || null, contactPhone: data.phone || data.ownerPhone || null, city: data.city || null } });
    await tx.crmUser.update({ where: { id: user.id }, data: { companyId: company.id } });
    const plan = await tx.plan.findUnique({ where: { tier: data.planTier } });
    if (!plan) throw new AppError('Signup plan is no longer available', 400);
    await tx.subscription.create({ data: { companyId: company.id, planId: plan.id, status: 'TRIALING', currentPeriodEnd: new Date(Date.now() + 7 * 86400000), trialEndsAt: new Date(Date.now() + 7 * 86400000), razorpayOrderId: data.razorpayOrderId || null, razorpayPaymentId: data.razorpayPaymentId || null, paidAt: data.razorpayPaymentId ? new Date() : null } });
    return user;
  });
  await prisma.pendingSignup.delete({ where: { id: pending.id } });
  return result;
}

async function findPendingUser(identifier) {
  const value = String(identifier || '').trim();
  const user = value.includes('@')
    ? await prisma.crmUser.findUnique({ where: { email: value.toLowerCase() } })
    : await prisma.crmUser.findFirst({ where: { phone: { contains: value.replace(/\D/g, '') } }, orderBy: { createdAt: 'desc' } });
  if (!user) throw new AppError('No account invitation was found for this email', 404);
  if (!['COMPANY_ADMIN', 'TL', 'SALES', 'SOLO'].includes(user.role)) throw new AppError('This account does not require member activation', 400);
  if (user.isVerified && user.passwordSetAt) throw new AppError('This account is already activated. Please sign in.', 409);
  return user;
}

export async function requestActivationOtp(identifier, channel = 'whatsapp') {
  const pending = await findPendingSignup(identifier);
  if (pending) {
    const normalizedChannel = String(channel).toLowerCase();
    if (!['email', 'whatsapp'].includes(normalizedChannel)) throw new AppError('Choose email or WhatsApp verification.', 400);
    if (normalizedChannel === 'whatsapp' && !pending.phone) throw new AppError('No WhatsApp number is registered for this account. Choose email instead.', 400);
    if (pending.otpSentAt && pending.otpSentAt > new Date(Date.now() - 60_000)) throw new AppError('Please wait 60 seconds before requesting another OTP', 429);
    const otp = generateOtp();
    await prisma.pendingSignup.update({ where: { id: pending.id }, data: { otpChannel: normalizedChannel.toUpperCase(), otpCodeHash: hashOtp(otp), otpExpiresAt: new Date(Date.now() + env.otpExpiryMinutes * 60_000), otpAttempts: 0, otpSentAt: new Date() } });
    try {
      if (normalizedChannel === 'whatsapp') await sendOtpWhatsApp(pending.phone, otp);
      else await sendEmail({ to: pending.email, subject: 'Your Skill99 CRM verification code', text: `Your Skill99 CRM verification code is ${otp}. It expires in ${env.otpExpiryMinutes} minutes.` });
    } catch (error) {
      await prisma.pendingSignup.update({ where: { id: pending.id }, data: { otpCodeHash: null, otpSentAt: null } });
      throw error;
    }
    return { email: pending.email, phone: pending.phone, channel: normalizedChannel, expiresInSeconds: env.otpExpiryMinutes * 60 };
  }
  const user = await findPendingUser(identifier);
  const normalizedChannel = String(channel).toLowerCase();
  if (!['email', 'whatsapp'].includes(normalizedChannel)) throw new AppError('Choose email or WhatsApp verification.', 400);
  if (normalizedChannel === 'whatsapp' && !user.phone) throw new AppError('No WhatsApp number is registered for this account. Choose email instead.', 400);

  const recent = await prisma.otpChallenge.findFirst({
    where: { userId: user.id, purpose: 'USER_ACTIVATION', channel: normalizedChannel.toUpperCase(), consumedAt: null, createdAt: { gte: new Date(Date.now() - 60_000) } },
    orderBy: { createdAt: 'desc' },
  });
  if (recent) throw new AppError('Please wait 60 seconds before requesting another OTP', 429);

  const otp = generateOtp();
  const expiresAt = new Date(Date.now() + env.otpExpiryMinutes * 60_000);
  await prisma.otpChallenge.create({
    data: { userId: user.id, purpose: 'USER_ACTIVATION', channel: normalizedChannel.toUpperCase(), codeHash: hashOtp(otp), expiresAt },
  });

  try {
    if (normalizedChannel === 'whatsapp') await sendOtpWhatsApp(user.phone, otp);
    else await sendEmail({ to: user.email, subject: 'Your Skill99 CRM verification code', text: `Your Skill99 CRM verification code is ${otp}. It expires in ${env.otpExpiryMinutes} minutes.` });
  } catch (err) {
    await prisma.otpChallenge.deleteMany({ where: { userId: user.id, purpose: 'USER_ACTIVATION', channel: normalizedChannel.toUpperCase(), codeHash: hashOtp(otp) } });
    throw err;
  }

  return { email: user.email, phone: user.phone, channel: normalizedChannel, expiresInSeconds: env.otpExpiryMinutes * 60 };
}

export async function verifyActivationOtp(identifier, otp, channel = 'whatsapp') {
  const pending = await findPendingSignup(identifier);
  if (pending) {
    const normalizedChannel = String(channel).toUpperCase();
    if (pending.otpChannel !== normalizedChannel || !pending.otpCodeHash || !pending.otpExpiresAt || pending.otpExpiresAt < new Date()) throw new AppError('OTP expired. Request a new OTP.', 400);
    if (pending.otpAttempts >= env.otpMaxAttempts) throw new AppError('Too many incorrect attempts. Request a new OTP.', 429);
    const valid = crypto.timingSafeEqual(Buffer.from(pending.otpCodeHash), Buffer.from(hashOtp(otp)));
    if (!valid) { await prisma.pendingSignup.update({ where: { id: pending.id }, data: { otpAttempts: { increment: 1 } } }); throw new AppError('Incorrect OTP', 400); }
    const user = await finalizePendingSignup(pending);
    const setupToken = signToken({ kind: 'member_activation', sub: user.id }, '15m');
    return { setupToken, user: activationPayload(user) };
  }
  const user = await findPendingUser(identifier);
  const normalizedChannel = String(channel).toUpperCase();
  const challenge = await prisma.otpChallenge.findFirst({
    where: { userId: user.id, purpose: 'USER_ACTIVATION', channel: normalizedChannel, consumedAt: null },
    orderBy: { createdAt: 'desc' },
  });
  if (!challenge || challenge.expiresAt < new Date()) throw new AppError('OTP expired. Request a new OTP.', 400);
  if (challenge.attempts >= env.otpMaxAttempts) throw new AppError('Too many incorrect attempts. Request a new OTP.', 429);

  const valid = crypto.timingSafeEqual(Buffer.from(challenge.codeHash), Buffer.from(hashOtp(otp)));
  if (!valid) {
    await prisma.otpChallenge.update({ where: { id: challenge.id }, data: { attempts: { increment: 1 } } });
    throw new AppError('Incorrect OTP', 400);
  }

  await prisma.otpChallenge.update({ where: { id: challenge.id }, data: { consumedAt: new Date() } });
  const setupToken = signToken({ kind: 'member_activation', sub: user.id }, '15m');
  return { setupToken, user: activationPayload(user) };
}

export async function setActivationPassword(setupToken, password) {
  let decoded;
  try {
    decoded = verifyToken(setupToken);
  } catch {
    throw new AppError('Activation session expired. Please request a new OTP.', 401);
  }
  if (decoded.kind !== 'member_activation') throw new AppError('Invalid activation session', 401);

  const user = await prisma.crmUser.findUnique({ where: { id: decoded.sub } });
  if (!user) throw new AppError('User not found', 404);
  if (user.isVerified && user.passwordSetAt) throw new AppError('Account is already activated. Please sign in.', 409);

  const passwordHash = await bcrypt.hash(password, 12);
  const updated = await prisma.crmUser.update({
    where: { id: user.id },
    data: { password: passwordHash, isVerified: true, verifiedAt: new Date(), passwordSetAt: new Date(), isActive: true },
  });

  const token = signToken({ sub: updated.id, role: updated.role });
  return { token, user: activationPayload(updated) };
}
