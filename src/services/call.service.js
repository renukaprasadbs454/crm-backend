import prisma from '../utils/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { leadScope, getTeamMemberIds } from '../utils/scope.js';
import * as activityService from './activity.service.js';
import { createRecordingKey, deleteRecording as deleteStoredRecording, putRecording } from './storage.service.js';

const transitions = {
  QUEUED: new Set(['DELIVERED', 'FAILED', 'EXPIRED']),
  DELIVERED: new Set(['RINGING', 'FAILED', 'EXPIRED']),
  RINGING: new Set(['CONNECTED', 'FAILED']),
  CONNECTED: new Set(['ENDED']),
  ENDED: new Set(),
  FAILED: new Set(),
  EXPIRED: new Set(),
};

function normalizePhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits || digits.length < 7) throw new AppError('A valid phone number is required', 400);
  return digits;
}

async function assertCallAccess(callId, actor) {
  const call = await prisma.callSession.findUnique({ where: { id: callId }, include: { lead: true, device: true } });
  if (!call) throw new AppError('Call not found', 404);
  if (actor.role === 'PLATFORM_ADMIN') throw new AppError('Forbidden', 403);
  if (actor.role === 'SOLO') {
    if (call.agentId !== actor.id || call.companyId !== null) throw new AppError('Call not found', 404);
  } else if (actor.role === 'SALES') {
    if (call.agentId !== actor.id || call.companyId !== actor.companyId) throw new AppError('Call not found', 404);
  } else if (actor.role === 'TL') {
    const ids = await getTeamMemberIds(actor);
    if (!ids.includes(call.agentId) || call.companyId !== actor.companyId) throw new AppError('Call not found', 404);
  } else if (actor.role === 'COMPANY_ADMIN') {
    if (call.companyId !== actor.companyId) throw new AppError('Call not found', 404);
  }
  return call;
}

async function resolveDevice(actor, requestedDeviceId) {
  const where = requestedDeviceId ? { id: requestedDeviceId } : { agentId: actor.id, status: 'ONLINE' };
  const device = await prisma.device.findFirst({ where });
  if (!device) throw new AppError('No paired online mobile device is available for this account.', 409);
  if (device.status === 'REVOKED') throw new AppError('This mobile device has been revoked.', 403);
  if (device.agentId !== actor.id) throw new AppError('That mobile device is not paired to your account.', 403);
  if (device.companyId !== (actor.companyId ?? null)) throw new AppError('Device tenant mismatch.', 403);
  if (device.status !== 'ONLINE' || !device.lastSeenAt || Date.now() - new Date(device.lastSeenAt).getTime() > 90_000) {
    throw new AppError('Mobile device is offline. Open the Skill99 Mobile Caller app and reconnect it.', 409);
  }
  return device;
}

export async function initiateCall(payload, actor) {
  if (!['COMPANY_ADMIN', 'TL', 'SALES', 'SOLO'].includes(actor.role)) throw new AppError('You do not have permission to initiate calls.', 403);
  const scope = await leadScope(actor);
  const lead = await prisma.lead.findFirst({ where: { id: payload.leadId, ...scope } });
  if (!lead) throw new AppError('Lead not found', 404);
  const device = await resolveDevice(actor, payload.deviceId);
  const phoneNumber = normalizePhone(lead.phone);
  const idempotencyKey = payload.idempotencyKey || crypto.randomUUID();
  const existing = await prisma.callSession.findUnique({ where: { idempotencyKey }, include: { lead: true } });
  if (existing) return existing;

  const call = await prisma.$transaction(async (tx) => {
    const created = await tx.callSession.create({
      data: {
        companyId: actor.companyId ?? null,
        agentId: actor.id,
        leadId: lead.id,
        deviceId: device.id,
        phoneNumber,
        direction: 'OUTBOUND',
        simSlot: device.selectedSimId ?? null,
        status: 'QUEUED',
        idempotencyKey,
      },
      include: { lead: true, agent: { select: { id: true, name: true } }, device: { select: { id: true, deviceName: true, selectedSimId: true, status: true } } },
    });
    await tx.deviceCommand.create({
      data: {
        deviceId: device.id,
        callId: created.id,
        commandType: 'CALL',
        status: 'QUEUED',
        payload: { callId: created.id, phoneNumber, simSubscriptionId: device.selectedSimId ?? null },
        expiresAt: new Date(Date.now() + 90_000),
      },
    });
    return created;
  });

  await activityService.logActivity({
    leadId: lead.id,
    authorId: actor.id,
    type: 'CALL',
    body: `Call queued to ${lead.phone}`,
    metadata: { callId: call.id, status: call.status },
  });
  return call;
}

export async function listCalls({ page = 1, limit = 20, status }, actor) {
  const take = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const skip = (Math.max(Number(page) || 1, 1) - 1) * take;
  let actorScope;
  if (actor.role === 'SOLO' || actor.role === 'SALES') actorScope = { agentId: actor.id, companyId: actor.companyId ?? null };
  else if (actor.role === 'TL') actorScope = { companyId: actor.companyId, agentId: { in: await getTeamMemberIds(actor) } };
  else if (actor.role === 'COMPANY_ADMIN') actorScope = { companyId: actor.companyId };
  else throw new AppError('Forbidden', 403);
  const where = { ...actorScope, ...(status ? { status } : {}) };
  const [items, total] = await prisma.$transaction([
    prisma.callSession.findMany({
      where,
      orderBy: { initiatedAt: 'desc' },
      skip,
      take,
      include: {
        lead: { select: { id: true, fullName: true, phone: true } },
        agent: { select: { id: true, name: true } },
        device: { select: { id: true, deviceName: true, selectedSimId: true, status: true } },
        recordings: { where: { deletedAt: null }, select: { id: true, uploadStatus: true, storageKey: true, durationSeconds: true } },
      },
    }),
    prisma.callSession.count({ where }),
  ]);
  return { items, pagination: { page: Math.max(Number(page) || 1, 1), limit: take, total, pages: Math.max(Math.ceil(total / take), 1) } };
}

export async function getCall(callId, actor) {
  const call = await assertCallAccess(callId, actor);
  return prisma.callSession.findUnique({
    where: { id: call.id },
    include: {
      lead: { select: { id: true, fullName: true, phone: true, email: true } },
      agent: { select: { id: true, name: true } },
      device: { select: { id: true, deviceName: true, selectedSimId: true, status: true, lastSeenAt: true } },
      recordings: { where: { deletedAt: null }, select: { id: true, uploadStatus: true, storageKey: true, mimeType: true, sizeBytes: true, durationSeconds: true } },
    },
  });
}

export async function recordEvent(callId, payload, actor) {
  const call = await assertCallAccess(callId, actor);
  const state = payload.state;
  if (!transitions[state]) throw new AppError('Invalid call state', 400);
  if (call.status === state) return call;
  if (!transitions[call.status].has(state)) throw new AppError(`Invalid call transition: ${call.status} → ${state}`, 409);
  const existingEvent = await prisma.callEvent.findUnique({ where: { eventId: payload.eventId } });
  if (existingEvent) return getCall(callId, actor);

  const now = new Date();
  const updates = { status: state };
  if (state === 'DELIVERED') updates.deliveredAt = now;
  if (state === 'RINGING') updates.ringingAt = now;
  if (state === 'CONNECTED') updates.connectedAt = now;
  if (state === 'ENDED') {
    updates.endedAt = now;
    if (call.connectedAt) updates.durationSeconds = Math.max(0, Math.round((now.getTime() - new Date(call.connectedAt).getTime()) / 1000));
  }
  if (state === 'FAILED' || state === 'EXPIRED') updates.failureReason = payload.failureReason || 'Call did not complete';

  const updated = await prisma.$transaction(async (tx) => {
    await tx.callEvent.create({ data: { callId, eventId: payload.eventId, state, payload: payload.payload ?? null } });
    return tx.callSession.update({ where: { id: callId }, data: updates, include: { lead: true, agent: { select: { id: true, name: true } }, device: { select: { id: true, deviceName: true, selectedSimId: true, status: true } } } });
  });

  if (state === 'ENDED' || state === 'FAILED' || state === 'EXPIRED') {
    const description = state === 'ENDED'
      ? `Call completed in ${updated.durationSeconds}s`
      : `Call ${state.toLowerCase()}: ${updated.failureReason || 'unknown reason'}`;
    await activityService.logActivity({ leadId: updated.leadId, authorId: updated.agentId, type: 'CALL', body: description, metadata: { callId: updated.id, status: updated.status, durationSeconds: updated.durationSeconds } });

    // Real CRM workflow: after a completed call, create a next-step task
    // automatically so the lead never falls out of the follow-up pipeline.
    if (state === 'ENDED') {
      await prisma.task.create({
        data: {
          title: `Follow up after call — ${updated.lead?.fullName || updated.phoneNumber}`,
          description: `Automatic follow-up generated from call ${updated.id}. Review the call outcome and contact the lead if required.`,
          status: 'TODO',
          priority: 2,
          assigneeId: updated.agentId,
          companyId: updated.companyId,
          dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      });
      await activityService.logActivity({ leadId: updated.leadId, authorId: updated.agentId, type: 'SYSTEM', body: 'Automatic follow-up task created after completed call', metadata: { callId: updated.id } });
    }
  }
  return updated;
}

export async function updateDisposition(callId, data, actor) {
  await assertCallAccess(callId, actor);
  return prisma.callSession.update({ where: { id: callId }, data: { disposition: data.disposition, notes: data.notes ?? null } });
}

export async function getDashboard(actor) {
  let actorScope;
  if (actor.role === 'SOLO' || actor.role === 'SALES') actorScope = { agentId: actor.id, companyId: actor.companyId ?? null };
  else if (actor.role === 'TL') actorScope = { companyId: actor.companyId, agentId: { in: await getTeamMemberIds(actor) } };
  else if (actor.role === 'COMPANY_ADMIN') actorScope = { companyId: actor.companyId };
  else throw new AppError('Forbidden', 403);
  const [totalCalls, connectedCalls, durationAgg, recordings] = await Promise.all([
    prisma.callSession.count({ where: actorScope }),
    prisma.callSession.count({ where: { ...actorScope, status: 'ENDED', connectedAt: { not: null } } }),
    prisma.callSession.aggregate({ where: { ...actorScope, status: 'ENDED', connectedAt: { not: null } }, _sum: { durationSeconds: true }, _avg: { durationSeconds: true } }),
    // Do not filter on a specific upload-status enum value in the dashboard.
    // This keeps the dashboard readable during deployments where an older
    // database has not yet received the UPLOADED enum value. The dedicated
    // recording migration adds that value; this count is intentionally
    // status-agnostic and only counts non-deleted recordings.
    prisma.callRecording.count({ where: { deletedAt: null, call: actorScope } }),
  ]);
  const durationSeconds = durationAgg._sum.durationSeconds || 0;
  return {
    totalCalls,
    connectedCalls,
    avgDurationSeconds: Math.round(durationAgg._avg.durationSeconds || 0),
    totalTalkSeconds: durationSeconds,
    recordings,
  };
}

export async function getTalkTime(actor, dateInput) {
  const date = dateInput ? new Date(`${dateInput}T00:00:00`) : new Date();
  if (Number.isNaN(date.getTime())) throw new AppError('Invalid date', 400);
  const next = new Date(date); next.setDate(next.getDate() + 1);
  let actorScope;
  if (actor.role === 'SOLO' || actor.role === 'SALES') actorScope = { agentId: actor.id, companyId: actor.companyId ?? null };
  else if (actor.role === 'TL') actorScope = { companyId: actor.companyId, agentId: { in: await getTeamMemberIds(actor) } };
  else if (actor.role === 'COMPANY_ADMIN') actorScope = { companyId: actor.companyId };
  else throw new AppError('Forbidden', 403);
  const calls = await prisma.callSession.findMany({ where: { ...actorScope, status: 'ENDED', connectedAt: { gte: date, lt: next }, durationSeconds: { gt: 0 } }, select: { durationSeconds: true } });
  return { date: date.toISOString().slice(0, 10), totalTalkSeconds: calls.reduce((sum, row) => sum + row.durationSeconds, 0), connectedCalls: calls.length };
}

export async function registerDevice(payload, actor) {
  if (!['COMPANY_ADMIN', 'TL', 'SALES', 'SOLO'].includes(actor.role)) throw new AppError('Forbidden', 403);
  const existing = await prisma.device.findUnique({ where: { deviceId: payload.deviceId } });
  if (existing && existing.agentId !== actor.id) throw new AppError('This device is already paired to another account.', 409);
  const device = existing
    ? await prisma.device.update({ where: { id: existing.id }, data: { deviceName: payload.deviceName, platform: payload.platform || 'ANDROID', appVersion: payload.appVersion || '1.0.0', selectedSimId: payload.selectedSimId ?? existing.selectedSimId, status: 'ONLINE', lastSeenAt: new Date(), companyId: actor.companyId ?? null } })
    : await prisma.device.create({ data: { companyId: actor.companyId ?? null, agentId: actor.id, deviceId: payload.deviceId, deviceName: payload.deviceName, platform: payload.platform || 'ANDROID', appVersion: payload.appVersion || '1.0.0', selectedSimId: payload.selectedSimId ?? null, status: 'ONLINE', lastSeenAt: new Date() } });
  return device;
}

export async function getMyDevice(actor) {
  return prisma.device.findFirst({ where: { agentId: actor.id }, orderBy: { updatedAt: 'desc' } });
}

export async function heartbeat(actor, payload = {}) {
  const device = await prisma.device.findFirst({ where: { id: payload.deviceId, agentId: actor.id } });
  if (!device) throw new AppError('Device not found', 404);
  if (device.status === 'REVOKED') throw new AppError('Device has been revoked.', 403);
  return prisma.device.update({ where: { id: device.id }, data: { status: 'ONLINE', lastSeenAt: new Date(), appVersion: payload.appVersion || device.appVersion, selectedSimId: payload.selectedSimId ?? device.selectedSimId } });
}

export async function listDevices(actor) {
  if (!['COMPANY_ADMIN', 'TL'].includes(actor.role)) throw new AppError('Forbidden', 403);
  const where = actor.role === 'COMPANY_ADMIN' ? { companyId: actor.companyId } : { companyId: actor.companyId, agentId: { in: await getTeamMemberIds(actor) } };
  return prisma.device.findMany({ where, orderBy: { lastSeenAt: 'desc' }, include: { agent: { select: { id: true, name: true, email: true, role: true } } } });
}

export async function revokeDevice(deviceId, actor) {
  if (!['COMPANY_ADMIN'].includes(actor.role)) throw new AppError('Forbidden', 403);
  const device = await prisma.device.findFirst({ where: { id: deviceId, companyId: actor.companyId } });
  if (!device) throw new AppError('Device not found', 404);
  return prisma.device.update({ where: { id: device.id }, data: { status: 'REVOKED' } });
}

export async function pendingCommands(actor) {
  const device = await getMyDevice(actor);
  if (!device || device.status === 'REVOKED') throw new AppError('No active mobile device is paired.', 409);
  const commands = await prisma.deviceCommand.findMany({ where: { deviceId: device.id, status: 'QUEUED', OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }, orderBy: { createdAt: 'asc' }, take: 10 });
  return commands;
}

export async function acknowledgeCommand(commandId, actor, status = 'ACKNOWLEDGED') {
  const device = await getMyDevice(actor);
  if (!device) throw new AppError('No paired device', 404);
  const command = await prisma.deviceCommand.findFirst({ where: { id: commandId, deviceId: device.id } });
  if (!command) throw new AppError('Command not found', 404);
  const nextStatus = status === 'DELIVERED' ? 'DELIVERED' : status === 'FAILED' ? 'FAILED' : 'ACKNOWLEDGED';
  return prisma.deviceCommand.update({ where: { id: command.id }, data: { status: nextStatus, deliveredAt: nextStatus !== 'QUEUED' ? new Date() : undefined, acknowledgedAt: nextStatus === 'ACKNOWLEDGED' ? new Date() : undefined } });
}

export async function deleteRecording(callId, recordingId, actor) {
  await assertCallAccess(callId, actor);
  const rec = await prisma.callRecording.findFirst({ where: { id: recordingId, callId, deletedAt: null } });
  if (!rec) throw new AppError('Recording not found', 404);
  await deleteStoredRecording(rec.storageKey);
  return prisma.callRecording.update({ where: { id: recordingId }, data: { deletedAt: new Date(), uploadStatus: 'DELETED' } });
}

export async function uploadRecording(callId, file, actor) {
  const call = await assertCallAccess(callId, actor);
  if (!file) throw new AppError('Recording file is required', 400);
  const storageKey = createRecordingKey(callId, file.originalname);
  const recording = await prisma.callRecording.create({ data: { callId, storageKey, mimeType: file.mimetype, sizeBytes: file.size, uploadStatus: 'UPLOADING' } });
  try {
    await putRecording(storageKey, file);
    return prisma.callRecording.update({ where: { id: recording.id }, data: { uploadStatus: 'UPLOADED' } });
  } catch (error) {
    await prisma.callRecording.update({ where: { id: recording.id }, data: { uploadStatus: 'FAILED' } });
    throw error;
  }
}
