import { verifyToken } from '../utils/jwt.js';
import prisma from '../utils/prisma.js';
import { AppError } from './errorHandler.js';

export async function authenticate(req, _res, next) {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new AppError('Unauthorized', 401);
    }

    const token = header.slice(7);
    const decoded = verifyToken(token);

    const user = await prisma.crmUser.findUnique({
      where: { id: decoded.sub },
      select: {
        id: true,
        email: true,
        name: true,
        phone: true,
        role: true,
        isActive: true,
        companyId: true,
        teamId: true,
      },
    });

    if (!user || !user.isActive) {
      throw new AppError('Unauthorized', 401);
    }

    if (user.role === 'PLATFORM_ADMIN') {
      req.user = user;
      return next();
    }

    const subscription = user.companyId
      ? await prisma.subscription.findUnique({ where: { companyId: user.companyId }, select: { status: true, currentPeriodEnd: true } })
      : await prisma.subscription.findUnique({ where: { soloUserId: user.id }, select: { status: true, currentPeriodEnd: true } });
    const periodEnded = subscription?.currentPeriodEnd && subscription.currentPeriodEnd < new Date();
    const billingPath = req.path.startsWith('/auth/me') || req.path.startsWith('/subscription');
    if (!billingPath && (!subscription || ['CANCELLED', 'EXPIRED', 'PAST_DUE'].includes(subscription.status) || periodEnded)) {
      throw new AppError('Your subscription is inactive. Renew your plan to access the workspace.', 402);
    }

    req.user = user;
    next();
  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return next(new AppError('Invalid or expired token', 401));
    }
    next(err);
  }
}

export function requireRoles(...roles) {
  return (req, _res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(new AppError('Forbidden', 403));
    }
    next();
  };
}

/**
 * Hard gate for every CRM data route (leads/clients/projects/payments/...).
 * PLATFORM_ADMIN is deliberately excluded from all of it — that role only
 * ever touches company.controller.js (aggregate counts), never a single
 * CRM record. This is enforced here AND again inside scope.js so a bug in
 * one layer can't silently open the data up.
 */
export function blockPlatformAdmin(req, _res, next) {
  if (req.user?.role === 'PLATFORM_ADMIN') {
    return next(new AppError('Platform admins do not have access to CRM records', 403));
  }
  next();
}

/**
 * Company-management routes (add/list TL, add/list salespeople, view
 * company dashboard) — only the Company Owner of that company, or a TL
 * viewing their own slice, may proceed. Route handlers still re-check the
 * specific companyId/teamId being touched; this just filters out roles
 * that should never reach these routes at all (SOLO, PLATFORM_ADMIN).
 */
export function requireCompanyContext(req, _res, next) {
  if (!['COMPANY_ADMIN', 'TL', 'SALES'].includes(req.user?.role) || !req.user?.companyId) {
    return next(new AppError('Forbidden', 403));
  }
  next();
}

