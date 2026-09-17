/**
 * Tenancy scope resolution.
 *
 * Every CRM record (Lead, Client, Project, Payment, Task, Meeting, Message,
 * Review, Retainer) carries a denormalized `companyId` (and Lead also
 * carries `teamId`). This module is the single place that turns
 * `req.user` into a Prisma `where` filter, so no controller/service can
 * accidentally under-scope a query.
 *
 * Role → what they can see:
 *   PLATFORM_ADMIN  — no CRM record access at all. Use the platform-admin
 *                      services (company.service.js) instead, which only
 *                      expose aggregate counts, never record rows.
 *   COMPANY_ADMIN    — every record with companyId === their companyId.
 *   TL               — every record with companyId === their companyId
 *                       AND teamId === their ledTeam.id (for models that
 *                       carry teamId, i.e. Lead), OR — for models that
 *                       don't carry teamId (Client, Project, ...) — every
 *                       record whose owner/assignee is one of their team
 *                       members. See leadScope()/memberScope() below.
 *   SALES            — only records they created or are assigned/own.
 *   SOLO             — only records they created or are assigned/own,
 *                       with companyId/teamId both null.
 */
import { AppError } from '../middleware/errorHandler.js';
import prisma from './prisma.js';

/**
 * Returns the list of CrmUser ids a TL is allowed to see the work of:
 * themself + every member of the team they lead.
 */
export async function getTeamMemberIds(actor) {
  if (actor.role !== 'TL') return [actor.id];
  const team = await prisma.team.findUnique({
    where: { tlId: actor.id },
    select: { members: { select: { id: true } } },
  });
  const memberIds = team ? team.members.map((m) => m.id) : [];
  return [actor.id, ...memberIds];
}

/**
 * Scope for the Lead model, which carries companyId + teamId directly.
 * Safe to spread into an AND array.
 */
export async function leadScope(actor) {
  switch (actor.role) {
    case 'PLATFORM_ADMIN':
      throw new AppError('Platform admins cannot access CRM records', 403);
    case 'SOLO':
      return { companyId: null, OR: [{ assignedToId: actor.id }, { createdById: actor.id }] };
    case 'COMPANY_ADMIN':
      return { companyId: actor.companyId };
    case 'TL': {
      const team = await prisma.team.findUnique({ where: { tlId: actor.id }, select: { id: true } });
      // A TL with no Team row yet (shouldn't normally happen) sees nothing
      // but their own leads, rather than erroring.
      if (!team) return { companyId: actor.companyId, OR: [{ assignedToId: actor.id }, { createdById: actor.id }] };
      return { companyId: actor.companyId, OR: [{ teamId: team.id }, { assignedToId: actor.id }, { createdById: actor.id }] };
    }
    case 'SALES':
    default:
      return { OR: [{ assignedToId: actor.id }, { createdById: actor.id }] };
  }
}

/**
 * Scope for models that only carry companyId (Client, Project, Retainer,
 * Payment, Message, Meeting, Task, Review) and an owner/assignee-style
 * field. `ownerField` is the field name on that model holding the
 * responsible CrmUser id (e.g. 'ownerId', 'assigneeId', 'hostId',
 * 'recordedById', 'senderId'). Pass null if the model has no such field
 * (falls back to company-wide visibility for anyone inside the company).
 */
export async function memberScope(actor, ownerField) {
  switch (actor.role) {
    case 'PLATFORM_ADMIN':
      throw new AppError('Platform admins cannot access CRM records', 403);
    case 'SOLO':
      if (!ownerField) return { companyId: null };
      return { companyId: null, [ownerField]: actor.id };
    case 'COMPANY_ADMIN':
      return { companyId: actor.companyId };
    case 'TL': {
      if (!ownerField) return { companyId: actor.companyId };
      const memberIds = await getTeamMemberIds(actor);
      return { companyId: actor.companyId, [ownerField]: { in: memberIds } };
    }
    case 'SALES':
    default:
      if (!ownerField) return { companyId: actor.companyId };
      return { [ownerField]: actor.id };
  }
}

/**
 * Tenancy fields to stamp onto a newly-created record for this actor.
 * Spread this into `data` on every `prisma.<model>.create(...)` call.
 * Async because a TL's own `teamId` column is null (they LEAD a team, they
 * aren't a member row in it) — we have to look up Team.tlId to find the
 * team a TL's own new leads should be filed under.
 */
export async function tenantStampFor(actor) {
  if (actor.role === 'PLATFORM_ADMIN') {
    throw new AppError('Platform admins cannot create CRM records', 403);
  }
  if (actor.role === 'SOLO') return { companyId: null, teamId: null };
  if (actor.role === 'TL') {
    const team = await prisma.team.findUnique({ where: { tlId: actor.id }, select: { id: true } });
    return { companyId: actor.companyId, teamId: team?.id ?? null };
  }
  // COMPANY_ADMIN / COMPANY_ADMIN / SALES: use their own stored companyId/teamId as-is.
  return { companyId: actor.companyId ?? null, teamId: actor.teamId ?? null };
}

/**
 * Asserts a fetched record is inside the actor's scope; throws 403/404
 * without leaking whether the record exists to someone outside scope.
 * `recordCompanyId` / `recordTeamId` come from the row you already loaded.
 */
export function assertInCompany(actor, recordCompanyId) {
  if (actor.role === 'PLATFORM_ADMIN') {
    throw new AppError('Platform admins cannot access CRM records', 403);
  }
  if (actor.role === 'SOLO') {
    if (recordCompanyId !== null) throw new AppError('Not found', 404);
    return;
  }
  if (recordCompanyId !== actor.companyId) {
    throw new AppError('Not found', 404);
  }
}
