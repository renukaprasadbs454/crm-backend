import prisma from '../utils/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { getPagination, paginated } from '../utils/pagination.js';
import { memberScope, leadScope, tenantStampFor } from '../utils/scope.js';

function emptyToNull(v) {
  return v === '' || v === undefined ? null : v;
}

function toDate(v) {
  if (!v || v === '') return null;
  return new Date(v);
}

function num(v) {
  return Number(v || 0);
}

/**
 * Validate a foreign CRM record before attaching it to a newly-created or
 * updated record. Prisma relations alone do not prevent a user from sending
 * an ID belonging to another tenant, so every cross-module reference is
 * checked against the same scope rules used for reads.
 */
async function assertRelatedInScope(model, id, actor, ownerField, label = 'Related record') {
  if (!id) return;
  const scope = model === 'lead' ? await leadScope(actor) : await memberScope(actor, ownerField);
  const found = await prisma[model].findFirst({
    where: { AND: [{ id }, scope] },
    select: { id: true },
  });
  if (!found) throw new AppError(`${label} not found`, 404);
}

/** Validate an assignee/owner is a user the actor is allowed to manage. */
async function assertAssignableUser(userId, actor, label = 'Assignee') {
  if (!userId) return;
  if (!['COMPANY_ADMIN', 'TL'].includes(actor.role)) {
    if (userId !== actor.id) throw new AppError(`${label} is not allowed`, 403);
    return;
  }
  const target = await prisma.crmUser.findUnique({
    where: { id: userId },
    select: { id: true, companyId: true, role: true, isActive: true },
  });
  if (!target || !target.isActive || target.companyId !== actor.companyId) {
    throw new AppError(`${label} not found in your company`, 404);
  }
  if (actor.role === 'TL') {
    const { getTeamMemberIds } = await import('../utils/scope.js');
    const memberIds = await getTeamMemberIds(actor);
    if (!memberIds.includes(userId)) throw new AppError(`${label} is outside your team`, 403);
  }
}

async function ensureOrg() {
  const existing = await prisma.organization.findFirst();
  if (existing) return existing;
  return prisma.organization.create({ data: { name: 'Skill99', publicSlug: 'skill99' } });
}

// ---------- Clients ----------
export async function listClients(query, actor) {
  const { page, limit, skip } = getPagination(query);
  const and = [await memberScope(actor, 'ownerId')];
  if (query.status) and.push({ status: query.status });
  if (query.search) {
    const s = query.search;
    and.push({
      OR: [
        { name: { contains: s, mode: 'insensitive' } },
        { email: { contains: s, mode: 'insensitive' } },
        { phone: { contains: s } },
        { company: { contains: s, mode: 'insensitive' } },
      ],
    });
  }
  const where = { AND: and };
  const [items, total] = await Promise.all([
    prisma.client.findMany({
      where,
      include: { owner: { select: { id: true, name: true } }, _count: { select: { projects: true, retainers: true } } },
      orderBy: { updatedAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.client.count({ where }),
  ]);
  return paginated(items, total, page, limit);
}

export async function getClient(id, actor) {
  const scope = await memberScope(actor, 'ownerId');
  const client = await prisma.client.findFirst({
    where: { AND: [{ id }, scope] },
    include: {
      owner: { select: { id: true, name: true, email: true } },
      lead: { select: { id: true, phone: true, stage: true } },
      projects: { orderBy: { updatedAt: 'desc' }, take: 20 },
      retainers: { orderBy: { updatedAt: 'desc' }, take: 10 },
      payments: { orderBy: { createdAt: 'desc' }, take: 10 },
    },
  });
  if (!client) throw new AppError('Client not found', 404);
  return client;
}

export async function createClient(data, actor) {
  const canAssignOthers = ['COMPANY_ADMIN', 'TL'].includes(actor.role);
  const ownerId = (canAssignOthers && data.ownerId) || actor.id;
  await assertAssignableUser(ownerId, actor, 'Client owner');
  await assertRelatedInScope('lead', data.leadId, actor, 'assignedToId', 'Lead');
  return prisma.client.create({
    data: {
      name: data.name,
      email: emptyToNull(data.email)?.toLowerCase?.() || emptyToNull(data.email),
      phone: emptyToNull(data.phone),
      company: emptyToNull(data.company),
      notes: emptyToNull(data.notes),
      status: data.status || 'ONBOARDING',
      ownerId,
      leadId: emptyToNull(data.leadId),
      companyId: (await tenantStampFor(actor)).companyId,
    },
  });
}

export async function updateClient(id, data, actor) {
  await getClient(id, actor);
  const payload = { ...data };
  if (payload.ownerId !== undefined) await assertAssignableUser(payload.ownerId, actor, 'Client owner');
  if (payload.leadId !== undefined) await assertRelatedInScope('lead', payload.leadId, actor, 'assignedToId', 'Lead');
  if (payload.email !== undefined) payload.email = emptyToNull(payload.email)?.toLowerCase?.() || emptyToNull(payload.email);
  if (payload.phone === '') payload.phone = null;
  if (payload.company === '') payload.company = null;
  if (payload.notes === '') payload.notes = null;
  if (payload.ownerId === '') payload.ownerId = null;
  if (!['COMPANY_ADMIN', 'TL'].includes(actor.role)) delete payload.ownerId;
  return prisma.client.update({ where: { id }, data: payload });
}

export async function deleteClient(id, actor) {
  await getClient(id, actor);
  await prisma.client.delete({ where: { id } });
  return true;
}

/** Used by lead convert — creates client if missing. Inherits the lead's tenancy. */
export async function createClientFromLead(lead, actor) {
  const existing = await prisma.client.findUnique({ where: { leadId: lead.id } });
  if (existing) return existing;
  return prisma.client.create({
    data: {
      name: lead.fullName || lead.phone,
      email: lead.email,
      phone: lead.phone,
      company: lead.collegeName,
      notes: lead.comments,
      status: 'ACTIVE',
      leadId: lead.id,
      ownerId: lead.assignedToId || actor.id,
      companyId: lead.companyId ?? null,
    },
  });
}

// ---------- Projects ----------
export async function listProjects(query, actor) {
  const { page, limit, skip } = getPagination(query);
  const and = [await memberScope(actor, 'ownerId')];
  if (query.status) and.push({ status: query.status });
  if (query.clientId) and.push({ clientId: query.clientId });
  if (query.search) and.push({ title: { contains: query.search, mode: 'insensitive' } });
  const where = { AND: and };
  const [items, total] = await Promise.all([
    prisma.project.findMany({
      where,
      include: {
        client: { select: { id: true, name: true } },
        owner: { select: { id: true, name: true } },
      },
      orderBy: { updatedAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.project.count({ where }),
  ]);
  return paginated(items, total, page, limit);
}

export async function getProject(id, actor) {
  const scope = await memberScope(actor, 'ownerId');
  const item = await prisma.project.findFirst({
    where: { AND: [{ id }, scope] },
    include: {
      client: true,
      owner: { select: { id: true, name: true } },
      payments: { orderBy: { createdAt: 'desc' }, take: 20 },
      tasks: { orderBy: { updatedAt: 'desc' }, take: 20 },
    },
  });
  if (!item) throw new AppError('Project not found', 404);
  return item;
}

export async function createProject(data, actor) {
  const canAssignOthers = ['COMPANY_ADMIN', 'TL'].includes(actor.role);
  const ownerId = (canAssignOthers && data.ownerId) || actor.id;
  await assertAssignableUser(ownerId, actor, 'Project owner');
  await assertRelatedInScope('client', data.clientId, actor, 'ownerId', 'Client');
  return prisma.project.create({
    data: {
      title: data.title,
      description: emptyToNull(data.description),
      status: data.status || 'NEW',
      budget: num(data.budget),
      startDate: toDate(data.startDate),
      endDate: toDate(data.endDate),
      clientId: data.clientId,
      ownerId,
      companyId: (await tenantStampFor(actor)).companyId,
    },
    include: { client: { select: { id: true, name: true } } },
  });
}

export async function updateProject(id, data, actor) {
  await getProject(id, actor);
  const payload = { ...data };
  if (payload.ownerId !== undefined) await assertAssignableUser(payload.ownerId, actor, 'Project owner');
  if (payload.clientId !== undefined) await assertRelatedInScope('client', payload.clientId, actor, 'ownerId', 'Client');
  if (payload.description === '') payload.description = null;
  if (payload.startDate !== undefined) payload.startDate = toDate(payload.startDate);
  if (payload.endDate !== undefined) payload.endDate = toDate(payload.endDate);
  if (payload.budget !== undefined) payload.budget = num(payload.budget);
  if (payload.ownerId === '') payload.ownerId = null;
  if (!['COMPANY_ADMIN', 'TL'].includes(actor.role)) delete payload.ownerId;
  return prisma.project.update({
    where: { id },
    data: payload,
    include: { client: { select: { id: true, name: true } } },
  });
}

export async function deleteProject(id, actor) {
  await getProject(id, actor);
  await prisma.project.delete({ where: { id } });
  return true;
}

// ---------- Retainers ----------
export async function listRetainers(query, actor) {
  const { page, limit, skip } = getPagination(query);
  const and = [await memberScope(actor, 'ownerId')];
  if (query.status) and.push({ status: query.status });
  if (query.clientId) and.push({ clientId: query.clientId });
  const where = { AND: and };
  const [items, total] = await Promise.all([
    prisma.retainer.findMany({
      where,
      include: {
        client: { select: { id: true, name: true } },
        owner: { select: { id: true, name: true } },
      },
      orderBy: { updatedAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.retainer.count({ where }),
  ]);
  return paginated(items, total, page, limit);
}

export async function getRetainer(id, actor) {
  const scope = await memberScope(actor, 'ownerId');
  const item = await prisma.retainer.findFirst({
    where: { AND: [{ id }, scope] },
    include: { client: true, owner: { select: { id: true, name: true } }, payments: true },
  });
  if (!item) throw new AppError('Retainer not found', 404);
  return item;
}

export async function createRetainer(data, actor) {
  const canAssignOthers = ['COMPANY_ADMIN', 'TL'].includes(actor.role);
  const ownerId = (canAssignOthers && data.ownerId) || actor.id;
  await assertAssignableUser(ownerId, actor, 'Retainer owner');
  await assertRelatedInScope('client', data.clientId, actor, 'ownerId', 'Client');
  return prisma.retainer.create({
    data: {
      title: data.title,
      description: emptyToNull(data.description),
      status: data.status || 'ACTIVE',
      monthlyAmount: num(data.monthlyAmount),
      startDate: toDate(data.startDate) || new Date(),
      endDate: toDate(data.endDate),
      clientId: data.clientId,
      ownerId,
      companyId: (await tenantStampFor(actor)).companyId,
    },
    include: { client: { select: { id: true, name: true } } },
  });
}

export async function updateRetainer(id, data, actor) {
  await getRetainer(id, actor);
  const payload = { ...data };
  if (payload.ownerId !== undefined) await assertAssignableUser(payload.ownerId, actor, 'Retainer owner');
  if (payload.clientId !== undefined) await assertRelatedInScope('client', payload.clientId, actor, 'ownerId', 'Client');
  if (payload.description === '') payload.description = null;
  if (payload.startDate !== undefined) payload.startDate = toDate(payload.startDate);
  if (payload.endDate !== undefined) payload.endDate = toDate(payload.endDate);
  if (payload.monthlyAmount !== undefined) payload.monthlyAmount = num(payload.monthlyAmount);
  if (payload.ownerId === '') payload.ownerId = null;
  if (!['COMPANY_ADMIN', 'TL'].includes(actor.role)) delete payload.ownerId;
  return prisma.retainer.update({
    where: { id },
    data: payload,
    include: { client: { select: { id: true, name: true } } },
  });
}

export async function deleteRetainer(id, actor) {
  await getRetainer(id, actor);
  await prisma.retainer.delete({ where: { id } });
  return true;
}

// ---------- Payments ----------
export async function listPayments(query, actor) {
  const { page, limit, skip } = getPagination(query);
  const and = [await memberScope(actor, 'recordedById')];
  if (query.type) and.push({ type: query.type });
  if (query.status) and.push({ status: query.status });
  if (query.clientId) and.push({ clientId: query.clientId });
  const where = { AND: and };
  const [items, total] = await Promise.all([
    prisma.payment.findMany({
      where,
      include: {
        client: { select: { id: true, name: true } },
        project: { select: { id: true, title: true } },
        retainer: { select: { id: true, title: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.payment.count({ where }),
  ]);
  return paginated(items, total, page, limit);
}

export async function getPayment(id, actor) {
  const scope = await memberScope(actor, 'recordedById');
  const item = await prisma.payment.findFirst({
    where: { AND: [{ id }, scope] },
    include: { client: true, project: true, retainer: true },
  });
  if (!item) throw new AppError('Payment not found', 404);
  return item;
}

export async function createPayment(data, actor) {
  await assertRelatedInScope('client', data.clientId, actor, 'ownerId', 'Client');
  await assertRelatedInScope('project', data.projectId, actor, 'ownerId', 'Project');
  await assertRelatedInScope('retainer', data.retainerId, actor, 'ownerId', 'Retainer');
  return prisma.payment.create({
    data: {
      title: data.title,
      amount: num(data.amount),
      type: data.type || 'REVENUE',
      status: data.status || 'PENDING',
      category: emptyToNull(data.category),
      paidAt: toDate(data.paidAt),
      notes: emptyToNull(data.notes),
      clientId: emptyToNull(data.clientId),
      projectId: emptyToNull(data.projectId),
      retainerId: emptyToNull(data.retainerId),
      recordedById: actor.id,
      companyId: (await tenantStampFor(actor)).companyId,
    },
  });
}

export async function updatePayment(id, data, actor) {
  await getPayment(id, actor);
  const payload = { ...data };
  if (payload.clientId !== undefined) await assertRelatedInScope('client', payload.clientId, actor, 'ownerId', 'Client');
  if (payload.projectId !== undefined) await assertRelatedInScope('project', payload.projectId, actor, 'ownerId', 'Project');
  if (payload.retainerId !== undefined) await assertRelatedInScope('retainer', payload.retainerId, actor, 'ownerId', 'Retainer');
  if (payload.amount !== undefined) payload.amount = num(payload.amount);
  if (payload.paidAt !== undefined) payload.paidAt = toDate(payload.paidAt);
  if (payload.category === '') payload.category = null;
  if (payload.notes === '') payload.notes = null;
  if (payload.clientId === '') payload.clientId = null;
  if (payload.projectId === '') payload.projectId = null;
  if (payload.retainerId === '') payload.retainerId = null;
  return prisma.payment.update({ where: { id }, data: payload });
}

export async function deletePayment(id, actor) {
  await getPayment(id, actor);
  await prisma.payment.delete({ where: { id } });
  return true;
}

// ---------- Messages ----------
export async function listMessages(query, actor) {
  const { page, limit, skip } = getPagination(query);
  const and = [await memberScope(actor, 'senderId')];
  if (query.channel) and.push({ channel: query.channel });
  if (query.clientId) and.push({ clientId: query.clientId });
  if (query.unread === 'true') and.push({ isRead: false });
  const where = { AND: and };
  const [items, total] = await Promise.all([
    prisma.message.findMany({
      where,
      include: {
        client: { select: { id: true, name: true } },
        sender: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.message.count({ where }),
  ]);
  return paginated(items, total, page, limit);
}

async function getMessageInScope(id, actor) {
  const scope = await memberScope(actor, 'senderId');
  const existing = await prisma.message.findFirst({ where: { AND: [{ id }, scope] } });
  if (!existing) throw new AppError('Message not found', 404);
  return existing;
}

export async function createMessage(data, actor) {
  await assertRelatedInScope('client', data.clientId, actor, 'ownerId', 'Client');
  return prisma.message.create({
    data: {
      subject: emptyToNull(data.subject),
      body: data.body,
      channel: data.channel || 'INTERNAL',
      clientId: emptyToNull(data.clientId),
      senderId: actor.id,
      companyId: (await tenantStampFor(actor)).companyId,
    },
    include: {
      client: { select: { id: true, name: true } },
      sender: { select: { id: true, name: true } },
    },
  });
}

export async function updateMessage(id, data, actor) {
  await getMessageInScope(id, actor);
  if (data.clientId !== undefined) await assertRelatedInScope('client', data.clientId, actor, 'ownerId', 'Client');
  return prisma.message.update({ where: { id }, data });
}

export async function deleteMessage(id, actor) {
  await getMessageInScope(id, actor);
  await prisma.message.delete({ where: { id } });
  return true;
}

// ---------- Meetings ----------
export async function listMeetings(query, actor) {
  const { page, limit, skip } = getPagination(query);
  const and = [await memberScope(actor, 'hostId')];
  if (query.status) and.push({ status: query.status });
  if (query.upcoming === 'true') and.push({ startsAt: { gte: new Date() }, status: 'SCHEDULED' });
  const where = { AND: and };
  const [items, total] = await Promise.all([
    prisma.meeting.findMany({
      where,
      include: {
        client: { select: { id: true, name: true } },
        project: { select: { id: true, title: true } },
        host: { select: { id: true, name: true } },
      },
      orderBy: { startsAt: 'asc' },
      skip,
      take: limit,
    }),
    prisma.meeting.count({ where }),
  ]);
  return paginated(items, total, page, limit);
}

async function getMeetingInScope(id, actor) {
  const scope = await memberScope(actor, 'hostId');
  const existing = await prisma.meeting.findFirst({ where: { AND: [{ id }, scope] } });
  if (!existing) throw new AppError('Meeting not found', 404);
  return existing;
}

export async function createMeeting(data, actor) {
  await assertRelatedInScope('client', data.clientId, actor, 'ownerId', 'Client');
  await assertRelatedInScope('project', data.projectId, actor, 'ownerId', 'Project');
  return prisma.meeting.create({
    data: {
      title: data.title,
      notes: emptyToNull(data.notes),
      startsAt: new Date(data.startsAt),
      endsAt: toDate(data.endsAt),
      status: data.status || 'SCHEDULED',
      location: emptyToNull(data.location),
      meetUrl: emptyToNull(data.meetUrl),
      reminderMin: data.reminderMin ?? null,
      clientId: emptyToNull(data.clientId),
      projectId: emptyToNull(data.projectId),
      hostId: actor.id,
      companyId: (await tenantStampFor(actor)).companyId,
    },
  });
}

export async function updateMeeting(id, data, actor) {
  await getMeetingInScope(id, actor);
  const payload = { ...data };
  if (payload.clientId !== undefined) await assertRelatedInScope('client', payload.clientId, actor, 'ownerId', 'Client');
  if (payload.projectId !== undefined) await assertRelatedInScope('project', payload.projectId, actor, 'ownerId', 'Project');
  if (payload.startsAt) payload.startsAt = new Date(payload.startsAt);
  if (payload.endsAt !== undefined) payload.endsAt = toDate(payload.endsAt);
  if (payload.notes === '') payload.notes = null;
  if (payload.location === '') payload.location = null;
  if (payload.meetUrl === '') payload.meetUrl = null;
  if (payload.clientId === '') payload.clientId = null;
  if (payload.projectId === '') payload.projectId = null;
  return prisma.meeting.update({ where: { id }, data: payload });
}

export async function deleteMeeting(id, actor) {
  await getMeetingInScope(id, actor);
  await prisma.meeting.delete({ where: { id } });
  return true;
}

// ---------- Tasks ----------
export async function listTasks(query, actor) {
  const { page, limit, skip } = getPagination(query);
  const and = [await memberScope(actor, 'assigneeId')];
  if (query.status) and.push({ status: query.status });
  // Company Owner/TL may narrow to a specific assignee within their scope.
  if (['COMPANY_ADMIN', 'TL'].includes(actor.role) && query.assigneeId) and.push({ assigneeId: query.assigneeId });
  if (query.clientId) and.push({ clientId: query.clientId });
  if (query.projectId) and.push({ projectId: query.projectId });
  const where = { AND: and };
  const [items, total] = await Promise.all([
    prisma.task.findMany({
      where,
      include: {
        client: { select: { id: true, name: true } },
        project: { select: { id: true, title: true } },
        assignee: { select: { id: true, name: true } },
      },
      orderBy: [{ status: 'asc' }, { dueAt: 'asc' }],
      skip,
      take: limit,
    }),
    prisma.task.count({ where }),
  ]);
  return paginated(items, total, page, limit);
}

async function getTaskInScope(id, actor) {
  const scope = await memberScope(actor, 'assigneeId');
  const existing = await prisma.task.findFirst({ where: { AND: [{ id }, scope] } });
  if (!existing) throw new AppError('Task not found', 404);
  return existing;
}

export async function createTask(data, actor) {
  const canAssignOthers = ['COMPANY_ADMIN', 'TL'].includes(actor.role);
  const assigneeId = (canAssignOthers && data.assigneeId) || actor.id;
  await assertAssignableUser(assigneeId, actor, 'Task assignee');
  await assertRelatedInScope('client', data.clientId, actor, 'ownerId', 'Client');
  await assertRelatedInScope('project', data.projectId, actor, 'ownerId', 'Project');
  return prisma.task.create({
    data: {
      title: data.title,
      description: emptyToNull(data.description),
      status: data.status || 'TODO',
      dueAt: toDate(data.dueAt),
      priority: data.priority ?? 2,
      clientId: emptyToNull(data.clientId),
      projectId: emptyToNull(data.projectId),
      assigneeId,
      companyId: (await tenantStampFor(actor)).companyId,
    },
  });
}

export async function updateTask(id, data, actor) {
  await getTaskInScope(id, actor);
  const payload = { ...data };
  if (payload.assigneeId !== undefined) await assertAssignableUser(payload.assigneeId, actor, 'Task assignee');
  if (payload.clientId !== undefined) await assertRelatedInScope('client', payload.clientId, actor, 'ownerId', 'Client');
  if (payload.projectId !== undefined) await assertRelatedInScope('project', payload.projectId, actor, 'ownerId', 'Project');
  if (payload.dueAt !== undefined) payload.dueAt = toDate(payload.dueAt);
  if (payload.description === '') payload.description = null;
  if (payload.clientId === '') payload.clientId = null;
  if (payload.projectId === '') payload.projectId = null;
  if (payload.assigneeId === '') payload.assigneeId = null;
  if (!['COMPANY_ADMIN', 'TL'].includes(actor.role)) delete payload.assigneeId;
  return prisma.task.update({ where: { id }, data: payload });
}

export async function deleteTask(id, actor) {
  await getTaskInScope(id, actor);
  await prisma.task.delete({ where: { id } });
  return true;
}

// ---------- Settings / Reviews / Dashboard ----------
export async function getOrganization() {
  return ensureOrg();
}

export async function updateOrganization(data) {
  const org = await ensureOrg();
  const payload = { ...data };
  if (payload.logoUrl === '') payload.logoUrl = null;
  return prisma.organization.update({ where: { id: org.id }, data: payload });
}

export async function updateProfile(userId, data) {
  const payload = { ...data };
  if (payload.phone === '') payload.phone = null;
  if (payload.password) {
    const bcrypt = await import('bcryptjs');
    payload.password = await bcrypt.hash(payload.password, 10);
  }
  // A user can never change their own role/company/team via self-service
  // profile update — that has to go through the company-admin endpoints.
  delete payload.role;
  delete payload.companyId;
  delete payload.teamId;
  return prisma.crmUser.update({
    where: { id: userId },
    data: payload,
    select: {
      id: true,
      email: true,
      name: true,
      phone: true,
      role: true,
      isActive: true,
      timezone: true,
      createdAt: true,
    },
  });
}

/** Public reviews are org-wide by design (a public testimonials page), not tenant-scoped. */
export async function listPublicReviews(slug) {
  const org = await prisma.organization.findUnique({ where: { publicSlug: slug } });
  if (!org) throw new AppError('Organization not found', 404);
  const reviews = await prisma.review.findMany({
    where: { isPublic: true },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  const avg =
    reviews.length === 0
      ? 0
      : Math.round((reviews.reduce((s, r) => s + r.rating, 0) / reviews.length) * 10) / 10;
  return { organization: { name: org.name, slug: org.publicSlug }, average: avg, count: reviews.length, reviews };
}

export async function createReview(data) {
  return prisma.review.create({
    data: {
      rating: data.rating,
      comment: emptyToNull(data.comment),
      reviewer: emptyToNull(data.reviewer),
      clientId: emptyToNull(data.clientId),
      isPublic: true,
    },
  });
}

export async function getBusinessDashboard(actor) {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const projectScope = await memberScope(actor, 'ownerId');
  const clientScope = await memberScope(actor, 'ownerId');
  const retainerScope = await memberScope(actor, 'ownerId');
  const paymentScope = await memberScope(actor, 'recordedById');
  const meetingScope = await memberScope(actor, 'hostId');

  const [
    projectNew,
    projectOngoing,
    projectCompleted,
    projectTotal,
    clientsTotal,
    activeRetainers,
    retainerAgg,
    monthRevenue,
    monthReceived,
    monthExpenses,
    allRevenue,
    allReceived,
    allExpenses,
    upcomingMeetings,
    recentClients,
  ] = await Promise.all([
    prisma.project.count({ where: { AND: [projectScope, { status: 'NEW' }] } }),
    prisma.project.count({ where: { AND: [projectScope, { status: 'ONGOING' }] } }),
    prisma.project.count({ where: { AND: [projectScope, { status: 'COMPLETED' }] } }),
    prisma.project.count({ where: projectScope }),
    prisma.client.count({ where: clientScope }),
    prisma.retainer.count({ where: { AND: [retainerScope, { status: 'ACTIVE' }] } }),
    prisma.retainer.aggregate({
      where: { AND: [retainerScope, { status: 'ACTIVE' }] },
      _sum: { monthlyAmount: true },
    }),
    prisma.payment.aggregate({
      where: { AND: [paymentScope, { type: 'REVENUE', createdAt: { gte: monthStart } }] },
      _sum: { amount: true },
    }),
    prisma.payment.aggregate({
      where: { AND: [paymentScope, { type: 'REVENUE', status: 'RECEIVED', paidAt: { gte: monthStart } }] },
      _sum: { amount: true },
    }),
    prisma.payment.aggregate({
      where: { AND: [paymentScope, { type: 'EXPENSE', status: 'RECEIVED', paidAt: { gte: monthStart } }] },
      _sum: { amount: true },
    }),
    prisma.payment.aggregate({
      where: { AND: [paymentScope, { type: 'REVENUE' }] },
      _sum: { amount: true },
    }),
    prisma.payment.aggregate({
      where: { AND: [paymentScope, { type: 'REVENUE', status: 'RECEIVED' }] },
      _sum: { amount: true },
    }),
    prisma.payment.aggregate({
      where: { AND: [paymentScope, { type: 'EXPENSE', status: 'RECEIVED' }] },
      _sum: { amount: true },
    }),
    prisma.meeting.findMany({
      where: { AND: [meetingScope, { startsAt: { gte: now }, status: 'SCHEDULED' }] },
      orderBy: { startsAt: 'asc' },
      take: 5,
      include: { client: { select: { id: true, name: true } } },
    }),
    prisma.client.findMany({
      where: clientScope,
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { id: true, name: true, status: true, createdAt: true },
    }),
  ]);

  const revenue = num(monthRevenue._sum.amount);
  const received = num(monthReceived._sum.amount);
  const expenses = num(monthExpenses._sum.amount);
  const totalValue = num(allRevenue._sum.amount);
  const amountReceived = num(allReceived._sum.amount);
  const totalExpenses = num(allExpenses._sum.amount);
  const pending = Math.max(0, totalValue - amountReceived);
  const collectedPct = totalValue ? Math.round((amountReceived / totalValue) * 1000) / 10 : 0;

  return {
    projects: {
      new: projectNew,
      ongoing: projectOngoing,
      completed: projectCompleted,
      total: projectTotal,
    },
    clientsTotal,
    retainers: {
      active: activeRetainers,
      mrr: num(retainerAgg._sum.monthlyAmount),
    },
    thisMonth: {
      revenue,
      received,
      expenses,
      moneyInAccount: received - expenses,
    },
    allTime: {
      totalProjectValue: totalValue,
      amountReceived,
      pending,
      totalExpenses,
      collectedPct,
    },
    upcomingMeetings,
    recentClients,
  };
}
