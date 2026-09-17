import prisma from '../utils/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { getPagination, paginated } from '../utils/pagination.js';
import { logActivity } from './activity.service.js';
import { leadScope, tenantStampFor, getTeamMemberIds } from '../utils/scope.js';
import { sendLeadWelcome, sendStageChange, sendInterestChange, sendLeadConversion } from './communication.service.js';
import { env } from '../config/env.js';

function normalizePhone(phone) {
  return String(phone || '').replace(/\s+/g, '').trim();
}

function normalizeEmail(email) {
  if (!email || email === '') return null;
  return email.toLowerCase();
}

const leadInclude = {
  assignedTo: {
    select: { id: true, name: true, email: true, role: true },
  },
};

export async function createLead(data, actor) {
  const phone = normalizePhone(data.phone);
  // Sales/TL/Solo default to assigning the lead to themself unless someone
  // with company-wide authority explicitly assigns it to a teammate.
  const canAssignOthers = ['COMPANY_ADMIN', 'TL'].includes(actor.role);
  const assignedToId = (canAssignOthers && data.assignedToId) || actor.id;

  const lead = await prisma.lead.create({
    data: {
      phone,
      fullName: data.fullName || null,
      email: normalizeEmail(data.email),
      detailType: data.detailType || 'COLLEGE',
      collegeName: data.collegeName || null,
      collegeCity: data.collegeCity || null,
      collegeCourse: data.collegeCourse || null,
      collegeYear: data.collegeYear || null,
      companyName: data.companyName || null,
      companyCity: data.companyCity || null,
      companyIndustry: data.companyIndustry || null,
      companySize: data.companySize || null,
      interest: data.interest || 'ON_HOLD',
      stage: data.stage || 'NEW',
      source: data.source || 'MANUAL',
      comments: data.comments || null,
      assignedToId,
      createdById: actor.id,
      ...(await tenantStampFor(actor)),
    },
    include: leadInclude,
  });

  await logActivity({
    leadId: lead.id,
    authorId: actor.id,
    type: 'SYSTEM',
    body: 'Lead created',
    metadata: { source: lead.source, stage: lead.stage },
  });

  void sendLeadWelcome({ lead, companyId: lead.companyId, senderId: actor.id }).catch((error) => console.error('[Skill99 CRM] Lead welcome automation failed:', error.message));

  if (assignedToId) {
    await logActivity({
      leadId: lead.id,
      authorId: actor.id,
      type: 'ASSIGNMENT',
      body: 'Lead assigned',
      metadata: { to: assignedToId },
    });
  }

  return lead;
}

/**
 * Public, unauthenticated capture. Never throws on duplicate phone —
 * instead it appends an inquiry activity to the existing lead so no
 * website submission is ever lost.
 */
export async function publicCreateLead(data) {
  const phone = normalizePhone(data.phone);
  const source = data.source || 'WEBSITE';

  // Public enquiries must land in a real tenant. For a single-company/demo
  // deployment PUBLIC_LEAD_COMPANY_ID is preferred; otherwise the first
  // active company is used. The browser never chooses the tenant.
  const company = await prisma.company.findFirst({
    where: {
      ...(env.publicLeadCompanyId ? { id: env.publicLeadCompanyId } : {}),
      status: { in: ['TRIAL', 'ACTIVE'] },
    },
    orderBy: { createdAt: 'asc' },
  });
  if (!company) throw new AppError('Website enquiries are not configured yet. Create an organisation first.', 503);

  const assignee = await prisma.crmUser.findFirst({
    where: { companyId: company.id, role: 'SALES', isActive: true },
    orderBy: { createdAt: 'asc' },
    select: { id: true, teamId: true },
  }) || await prisma.crmUser.findFirst({
    where: { companyId: company.id, role: 'COMPANY_ADMIN', isActive: true },
    orderBy: { createdAt: 'asc' },
    select: { id: true, teamId: true },
  });

  const existing = await prisma.lead.findUnique({ where: { phone } });
  if (existing) {
    // If an old public lead was created before tenant routing existed, attach
    // it to the configured company so it becomes visible in CRM Leads.
    if (!existing.companyId) {
      const updated = await prisma.lead.update({
        where: { id: existing.id },
        data: { companyId: company.id, teamId: assignee?.teamId ?? null, assignedToId: assignee?.id ?? existing.assignedToId },
      });
      await logActivity({ leadId: updated.id, type: 'SYSTEM', body: 'Existing website enquiry linked to company workspace', metadata: { companyId: company.id, source } });
    } else if (existing.companyId !== company.id) {
      // Do not reveal or move another tenant's lead from a public endpoint.
      return { id: existing.id, duplicate: true };
    }
    await logActivity({
      leadId: existing.id,
      type: 'SYSTEM',
      body: 'Repeat website inquiry',
      metadata: { source, message: data.message || null, collegeName: data.collegeName || null },
    });
    return { id: existing.id, duplicate: true };
  }

  const lead = await prisma.lead.create({
    data: {
      phone,
      fullName: data.fullName || null,
      email: normalizeEmail(data.email),
      detailType: data.detailType || 'COLLEGE',
      collegeName: data.collegeName || null,
      collegeCity: data.collegeCity || null,
      collegeCourse: data.collegeCourse || null,
      collegeYear: data.collegeYear || null,
      companyName: data.companyName || null,
      companyCity: data.companyCity || null,
      companyIndustry: data.companyIndustry || null,
      companySize: data.companySize || null,
      interest: 'ON_HOLD',
      stage: 'NEW',
      source,
      comments: data.message || null,
      companyId: company.id,
      teamId: assignee?.teamId ?? null,
      assignedToId: assignee?.id ?? null,
    },
  });

  await logActivity({
    leadId: lead.id,
    type: 'SYSTEM',
    body: 'Lead captured from website',
    metadata: { source, message: data.message || null, companyId: company.id, assignedToId: assignee?.id ?? null },
  });

  void sendLeadWelcome({ lead, companyId: company.id, senderId: null }).catch((error) => console.error('[Skill99 CRM] Public lead automation failed:', error.message));

  return { id: lead.id, duplicate: false };
}

export async function listLeads(query, actor) {
  const { page, limit, skip } = getPagination(query);
  const and = [await leadScope(actor)];

  // Company Owners and TLs may additionally narrow to one rep within
  // their scope; SALES/SOLO are already pinned to themself by leadScope.
  if (['COMPANY_ADMIN', 'TL'].includes(actor.role) && query.assignedToId) {
    and.push({ assignedToId: query.assignedToId });
  }

  if (query.interest) and.push({ interest: query.interest });
  if (query.stage) and.push({ stage: query.stage });
  if (query.source) and.push({ source: query.source });
  if (query.collegeName) {
    and.push({ collegeName: { contains: query.collegeName, mode: 'insensitive' } });
  }
  if (query.search) {
    const s = query.search;
    and.push({
      OR: [
        { phone: { contains: s } },
        { fullName: { contains: s, mode: 'insensitive' } },
        { email: { contains: s, mode: 'insensitive' } },
        { collegeName: { contains: s, mode: 'insensitive' } },
      ],
    });
  }

  const where = and.length ? { AND: and } : {};

  const [items, total] = await Promise.all([
    prisma.lead.findMany({
      where,
      include: leadInclude,
      orderBy: { updatedAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.lead.count({ where }),
  ]);

  return paginated(items, total, page, limit);
}

export async function getLeadById(id, actor) {
  const scope = await leadScope(actor);
  const lead = await prisma.lead.findFirst({
    where: { AND: [{ id }, scope] },
    include: leadInclude,
  });
  // Returning a plain 404 (rather than 403) for out-of-scope leads avoids
  // confirming to a rep that a given lead ID exists at all.
  if (!lead) throw new AppError('Lead not found', 404);

  return lead;
}

export async function updateLead(id, data, actor) {
  const existing = await getLeadById(id, actor);

  const payload = { ...data };
  if (payload.phone) payload.phone = normalizePhone(payload.phone);
  if (payload.email !== undefined) payload.email = normalizeEmail(payload.email);
  if (payload.collegeCity === '') payload.collegeCity = null;
  if (payload.collegeCourse === '') payload.collegeCourse = null;
  if (payload.collegeYear === '') payload.collegeYear = null;
  if (payload.comments === '') payload.comments = null;
  if (payload.fullName === '') payload.fullName = null;

  const canReassign = ['COMPANY_ADMIN', 'TL'].includes(actor.role);
  if (!canReassign && payload.assignedToId && payload.assignedToId !== existing.assignedToId) {
    throw new AppError('You are not allowed to reassign this lead', 403);
  }
  // A TL may only reassign within their own team — enforced by re-running
  // leadScope on the target assignee via a lightweight membership check.
  if (actor.role === 'TL' && payload.assignedToId && payload.assignedToId !== existing.assignedToId) {
    const memberIds = await getTeamMemberIds(actor);
    if (!memberIds.includes(payload.assignedToId)) {
      throw new AppError('Cannot reassign outside your team', 403);
    }
  }

  const stageChanged = payload.stage && payload.stage !== existing.stage;
  const interestChanged = payload.interest && payload.interest !== existing.interest;
  const assigneeChanged =
    payload.assignedToId !== undefined && payload.assignedToId !== existing.assignedToId;

  const lead = await prisma.lead.update({
    where: { id },
    data: payload,
    include: leadInclude,
  });

  if (stageChanged) {
    void sendStageChange({ lead, stage: lead.stage, companyId: lead.companyId, senderId: actor.id }).catch((error) => console.error('[Skill99 CRM] Stage automation failed:', error.message));
    await logActivity({
      leadId: id,
      authorId: actor.id,
      type: 'STAGE_CHANGE',
      body: `Stage: ${existing.stage} → ${lead.stage}`,
      metadata: { from: existing.stage, to: lead.stage },
    });
  }

  if (interestChanged) {
    void sendInterestChange({ lead, interest: lead.interest, companyId: lead.companyId, senderId: actor.id }).catch((error) => console.error('[Skill99 CRM] Interest automation failed:', error.message));
    await logActivity({ leadId: id, authorId: actor.id, type: 'SYSTEM', body: `Interest: ${existing.interest} → ${lead.interest}`, metadata: { from: existing.interest, to: lead.interest } });
  }

  if (assigneeChanged) {
    await logActivity({
      leadId: id,
      authorId: actor.id,
      type: 'ASSIGNMENT',
      body: 'Assignment changed',
      metadata: { from: existing.assignedToId, to: lead.assignedToId },
    });
  }

  return lead;
}

export async function updateStage(id, { stage, note }, actor) {
  const existing = await getLeadById(id, actor);

  if (existing.stage === stage) {
    return existing;
  }

  const lead = await prisma.lead.update({
    where: { id },
    data: { stage },
    include: leadInclude,
  });

  void sendStageChange({ lead, stage: lead.stage, companyId: lead.companyId, senderId: actor.id }).catch((error) => console.error('[Skill99 CRM] Stage automation failed:', error.message));

  await logActivity({
    leadId: id,
    authorId: actor.id,
    type: 'STAGE_CHANGE',
    body: note || `Stage: ${existing.stage} → ${stage}`,
    metadata: { from: existing.stage, to: stage },
  });

  return lead;
}

export async function convertLead(id, { convertedRef, note, createClient = true }, actor) {
  const existing = await getLeadById(id, actor);

  const lead = await prisma.lead.update({
    where: { id },
    data: {
      stage: 'WON',
      convertedAt: existing.convertedAt || new Date(),
      convertedRef: convertedRef || existing.convertedRef || null,
    },
    include: leadInclude,
  });

  let client = null;
  if (createClient !== false) {
    const { createClientFromLead } = await import('./modules.service.js');
    client = await createClientFromLead(lead, actor);
  }

  await logActivity({
    leadId: id,
    authorId: actor.id,
    type: 'CONVERSION',
    body: note || 'Lead converted to client',
    metadata: { convertedRef: lead.convertedRef, from: existing.stage, clientId: client?.id || null },
  });

  void sendLeadConversion({ lead, companyId: lead.companyId, senderId: actor.id }).catch((error) => console.error('[Skill99 CRM] Conversion automation failed:', error.message));

  return { ...lead, client };
}

export async function deleteLead(id, actor) {
  await getLeadById(id, actor); // also enforces scope / throws 404 if out of scope
  if (!['COMPANY_ADMIN', 'SOLO'].includes(actor.role)) {
    throw new AppError('Only a Company Owner or Solo user can delete leads', 403);
  }
  await prisma.lead.delete({ where: { id } });
  return true;
}

export async function getDashboardStats(actor) {
  const scope = await leadScope(actor);

  const [total, interested, notInterested, onHold, won] = await Promise.all([
    prisma.lead.count({ where: scope }),
    prisma.lead.count({ where: { ...scope, interest: 'INTERESTED' } }),
    prisma.lead.count({ where: { ...scope, interest: 'NOT_INTERESTED' } }),
    prisma.lead.count({ where: { ...scope, interest: 'ON_HOLD' } }),
    prisma.lead.count({ where: { ...scope, stage: 'WON' } }),
  ]);

  return { total, interested, notInterested, onHold, won };
}
