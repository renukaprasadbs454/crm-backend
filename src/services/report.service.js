import prisma from '../utils/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { leadScope } from '../utils/scope.js';

const STAGES = [
  'NEW',
  'CONTACTED',
  'QUALIFIED',
  'DEMO_SCHEDULED',
  'NEGOTIATING',
  'WON',
  'LOST',
];

function rate(part, whole) {
  if (!whole) return 0;
  return Math.round((part / whole) * 1000) / 10; // one decimal place, %
}

// Reports are only ever reached by COMPANY_ADMIN or TL (see routes/index.js
// requireRoles gate) — both get a leadScope() that already confines every
// query below to their company/team, so no separate filter is needed here.

/**
 * Funnel counts by pipeline stage + overall conversion rate, scoped to
 * the caller's company (COMPANY_ADMIN) or team (TL).
 */
export async function getOverview(actor) {
  const scope = await leadScope(actor);

  const [total, byStageRaw, byInterestRaw, converted] = await Promise.all([
    prisma.lead.count({ where: scope }),
    prisma.lead.groupBy({ by: ['stage'], where: scope, _count: { _all: true } }),
    prisma.lead.groupBy({ by: ['interest'], where: scope, _count: { _all: true } }),
    prisma.lead.count({ where: { ...scope, NOT: { convertedAt: null } } }),
  ]);

  const stageCounts = Object.fromEntries(STAGES.map((s) => [s, 0]));
  for (const row of byStageRaw) stageCounts[row.stage] = row._count._all;

  const interestCounts = {};
  for (const row of byInterestRaw) interestCounts[row.interest] = row._count._all;

  const funnel = STAGES.map((stage) => ({ stage, count: stageCounts[stage] }));
  const won = stageCounts.WON;
  const lost = stageCounts.LOST;

  return {
    total,
    converted,
    conversionRate: rate(converted, total),
    winRate: rate(won, won + lost),
    funnel,
    byStage: stageCounts,
    byInterest: interestCounts,
  };
}

/**
 * Lead volume + conversions grouped by acquisition source, scoped to the
 * caller's company/team.
 */
export async function getBySource(actor) {
  const scope = await leadScope(actor);

  const [totals, conversions] = await Promise.all([
    prisma.lead.groupBy({ by: ['source'], where: scope, _count: { _all: true } }),
    prisma.lead.groupBy({
      by: ['source'],
      where: { ...scope, NOT: { convertedAt: null } },
      _count: { _all: true },
    }),
  ]);

  const convBySource = Object.fromEntries(
    conversions.map((r) => [r.source, r._count._all])
  );

  return totals
    .map((r) => {
      const total = r._count._all;
      const converted = convBySource[r.source] || 0;
      return {
        source: r.source,
        total,
        converted,
        conversionRate: rate(converted, total),
      };
    })
    .sort((a, b) => b.total - a.total);
}

/**
 * Per-rep performance, scoped to the caller's company/team: a Company
 * A Company Admin sees every rep in their company, a TL sees only their own team.
 */
export async function getByRep(actor) {
  if (['COMPANY_ADMIN'].includes(actor.role)) {
    return repBreakdown({ companyId: actor.companyId, role: { in: ['TL', 'SALES'] } }, actor);
  }
  if (actor.role === 'TL') {
    const team = await prisma.team.findUnique({ where: { tlId: actor.id }, select: { id: true } });
    if (!team) throw new AppError('You do not lead a team yet', 404);
    return repBreakdown({ teamId: team.id, role: 'SALES' }, actor);
  }
  throw new AppError('Forbidden', 403);
}

async function repBreakdown(userWhere, actor) {
  const leadScopeFilter = await leadScope(actor);

  const [reps, assignedTotals, wonTotals, convertedTotals] = await Promise.all([
    prisma.crmUser.findMany({
      where: userWhere,
      select: { id: true, name: true, email: true, role: true, isActive: true },
      orderBy: { name: 'asc' },
    }),
    prisma.lead.groupBy({
      by: ['assignedToId'],
      where: { ...leadScopeFilter, NOT: { assignedToId: null } },
      _count: { _all: true },
    }),
    prisma.lead.groupBy({
      by: ['assignedToId'],
      where: { ...leadScopeFilter, stage: 'WON', NOT: { assignedToId: null } },
      _count: { _all: true },
    }),
    prisma.lead.groupBy({
      by: ['assignedToId'],
      where: { ...leadScopeFilter, assignedToId: { not: null }, convertedAt: { not: null } },
      _count: { _all: true },
    }),
  ]);

  const assignedMap = Object.fromEntries(
    assignedTotals.map((r) => [r.assignedToId, r._count._all])
  );
  const wonMap = Object.fromEntries(wonTotals.map((r) => [r.assignedToId, r._count._all]));
  const convMap = Object.fromEntries(
    convertedTotals.map((r) => [r.assignedToId, r._count._all])
  );

  return reps.map((rep) => {
    const assigned = assignedMap[rep.id] || 0;
    const won = wonMap[rep.id] || 0;
    const converted = convMap[rep.id] || 0;
    return {
      id: rep.id,
      name: rep.name,
      email: rep.email,
      role: rep.role,
      isActive: rep.isActive,
      assigned,
      won,
      converted,
      conversionRate: rate(converted, assigned),
    };
  });
}
