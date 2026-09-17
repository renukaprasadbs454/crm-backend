import * as callService from '../services/call.service.js';
import { initiateCallSchema, callDispositionSchema, callEventSchema, registerDeviceSchema, heartbeatSchema, parseBody } from '../validators/schemas.js';
import { ok } from '../utils/response.js';
import { asyncHandler } from '../middleware/errorHandler.js';

export const dashboard = asyncHandler(async (req, res) => ok(res, await callService.getDashboard(req.user)));
export const list = asyncHandler(async (req, res) => ok(res, await callService.listCalls(req.query, req.user)));
export const initiate = asyncHandler(async (req, res) => {
  const body = parseBody(initiateCallSchema, req.body);
  return ok(res, await callService.initiateCall(body, req.user), 'Call queued', 201);
});
export const get = asyncHandler(async (req, res) => ok(res, await callService.getCall(req.params.id, req.user)));
export const event = asyncHandler(async (req, res) => {
  const body = parseBody(callEventSchema, req.body);
  return ok(res, await callService.recordEvent(req.params.id, body, req.user), 'Call event recorded');
});
export const disposition = asyncHandler(async (req, res) => ok(res, await callService.updateDisposition(req.params.id, parseBody(callDispositionSchema, req.body), req.user), 'Call disposition saved'));
export const talkTime = asyncHandler(async (req, res) => ok(res, await callService.getTalkTime(req.user, req.query.date)));

export const registerDevice = asyncHandler(async (req, res) => {
  const body = parseBody(registerDeviceSchema, req.body);
  return ok(res, await callService.registerDevice(body, req.user), 'Device paired', 201);
});
export const myDevice = asyncHandler(async (req, res) => ok(res, await callService.getMyDevice(req.user)));
export const heartbeat = asyncHandler(async (req, res) => {
  const body = parseBody(heartbeatSchema, req.body);
  return ok(res, await callService.heartbeat(req.user, body), 'Device heartbeat updated');
});
export const devices = asyncHandler(async (req, res) => ok(res, await callService.listDevices(req.user)));
export const revokeDevice = asyncHandler(async (req, res) => ok(res, await callService.revokeDevice(req.params.id, req.user), 'Device revoked'));
export const pendingCommands = asyncHandler(async (req, res) => ok(res, await callService.pendingCommands(req.user)));
export const acknowledgeCommand = asyncHandler(async (req, res) => ok(res, await callService.acknowledgeCommand(req.params.id, req.user, req.body?.status)));
export const deleteRecording = asyncHandler(async (req, res) => ok(res, await callService.deleteRecording(req.params.id, req.params.recordingId, req.user), 'Recording deleted'));
export const uploadRecording = asyncHandler(async (req, res) => ok(res, await callService.uploadRecording(req.params.id, req.file, req.user), 'Recording uploaded', 201));
