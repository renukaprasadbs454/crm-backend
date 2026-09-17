import * as modules from '../services/modules.service.js';
import {
  createClientSchema,
  updateClientSchema,
  createProjectSchema,
  updateProjectSchema,
  createRetainerSchema,
  updateRetainerSchema,
  createPaymentSchema,
  updatePaymentSchema,
  createMessageSchema,
  updateMessageSchema,
  createMeetingSchema,
  updateMeetingSchema,
  createTaskSchema,
  updateTaskSchema,
  updateOrgSchema,
  updateProfileSchema,
  createReviewSchema,
  parseBody,
} from '../validators/schemas.js';
import { ok } from '../utils/response.js';
import { asyncHandler } from '../middleware/errorHandler.js';

// Clients
export const listClients = asyncHandler(async (req, res) => ok(res, await modules.listClients(req.query, req.user)));
export const getClient = asyncHandler(async (req, res) => ok(res, await modules.getClient(req.params.id, req.user)));
export const createClient = asyncHandler(async (req, res) => {
  const body = parseBody(createClientSchema, req.body);
  return ok(res, await modules.createClient(body, req.user), 'Client created', 201);
});
export const updateClient = asyncHandler(async (req, res) => {
  const body = parseBody(updateClientSchema, req.body);
  return ok(res, await modules.updateClient(req.params.id, body, req.user), 'Client updated');
});
export const deleteClient = asyncHandler(async (req, res) => {
  await modules.deleteClient(req.params.id, req.user);
  return ok(res, null, 'Client deleted');
});

// Projects
export const listProjects = asyncHandler(async (req, res) => ok(res, await modules.listProjects(req.query, req.user)));
export const getProject = asyncHandler(async (req, res) => ok(res, await modules.getProject(req.params.id, req.user)));
export const createProject = asyncHandler(async (req, res) => {
  const body = parseBody(createProjectSchema, req.body);
  return ok(res, await modules.createProject(body, req.user), 'Project created', 201);
});
export const updateProject = asyncHandler(async (req, res) => {
  const body = parseBody(updateProjectSchema, req.body);
  return ok(res, await modules.updateProject(req.params.id, body, req.user), 'Project updated');
});
export const deleteProject = asyncHandler(async (req, res) => {
  await modules.deleteProject(req.params.id, req.user);
  return ok(res, null, 'Project deleted');
});

// Retainers
export const listRetainers = asyncHandler(async (req, res) => ok(res, await modules.listRetainers(req.query, req.user)));
export const getRetainer = asyncHandler(async (req, res) => ok(res, await modules.getRetainer(req.params.id, req.user)));
export const createRetainer = asyncHandler(async (req, res) => {
  const body = parseBody(createRetainerSchema, req.body);
  return ok(res, await modules.createRetainer(body, req.user), 'Retainer created', 201);
});
export const updateRetainer = asyncHandler(async (req, res) => {
  const body = parseBody(updateRetainerSchema, req.body);
  return ok(res, await modules.updateRetainer(req.params.id, body, req.user), 'Retainer updated');
});
export const deleteRetainer = asyncHandler(async (req, res) => {
  await modules.deleteRetainer(req.params.id, req.user);
  return ok(res, null, 'Retainer deleted');
});

// Payments
export const listPayments = asyncHandler(async (req, res) => ok(res, await modules.listPayments(req.query, req.user)));
export const getPayment = asyncHandler(async (req, res) => ok(res, await modules.getPayment(req.params.id, req.user)));
export const createPayment = asyncHandler(async (req, res) => {
  const body = parseBody(createPaymentSchema, req.body);
  return ok(res, await modules.createPayment(body, req.user), 'Payment recorded', 201);
});
export const updatePayment = asyncHandler(async (req, res) => {
  const body = parseBody(updatePaymentSchema, req.body);
  return ok(res, await modules.updatePayment(req.params.id, body, req.user), 'Payment updated');
});
export const deletePayment = asyncHandler(async (req, res) => {
  await modules.deletePayment(req.params.id, req.user);
  return ok(res, null, 'Payment deleted');
});

// Messages
export const listMessages = asyncHandler(async (req, res) => ok(res, await modules.listMessages(req.query, req.user)));
export const createMessage = asyncHandler(async (req, res) => {
  const body = parseBody(createMessageSchema, req.body);
  return ok(res, await modules.createMessage(body, req.user), 'Message sent', 201);
});
export const updateMessage = asyncHandler(async (req, res) => {
  const body = parseBody(updateMessageSchema, req.body);
  return ok(res, await modules.updateMessage(req.params.id, body, req.user), 'Message updated');
});
export const deleteMessage = asyncHandler(async (req, res) => {
  await modules.deleteMessage(req.params.id, req.user);
  return ok(res, null, 'Message deleted');
});

// Meetings
export const listMeetings = asyncHandler(async (req, res) => ok(res, await modules.listMeetings(req.query, req.user)));
export const createMeeting = asyncHandler(async (req, res) => {
  const body = parseBody(createMeetingSchema, req.body);
  return ok(res, await modules.createMeeting(body, req.user), 'Meeting scheduled', 201);
});
export const updateMeeting = asyncHandler(async (req, res) => {
  const body = parseBody(updateMeetingSchema, req.body);
  return ok(res, await modules.updateMeeting(req.params.id, body, req.user), 'Meeting updated');
});
export const deleteMeeting = asyncHandler(async (req, res) => {
  await modules.deleteMeeting(req.params.id, req.user);
  return ok(res, null, 'Meeting deleted');
});

// Tasks
export const listTasks = asyncHandler(async (req, res) => ok(res, await modules.listTasks(req.query, req.user)));
export const createTask = asyncHandler(async (req, res) => {
  const body = parseBody(createTaskSchema, req.body);
  return ok(res, await modules.createTask(body, req.user), 'Task created', 201);
});
export const updateTask = asyncHandler(async (req, res) => {
  const body = parseBody(updateTaskSchema, req.body);
  return ok(res, await modules.updateTask(req.params.id, body, req.user), 'Task updated');
});
export const deleteTask = asyncHandler(async (req, res) => {
  await modules.deleteTask(req.params.id, req.user);
  return ok(res, null, 'Task deleted');
});

// Settings / reviews / business dashboard
export const getOrg = asyncHandler(async (_req, res) => ok(res, await modules.getOrganization()));
export const updateOrg = asyncHandler(async (req, res) => {
  const body = parseBody(updateOrgSchema, req.body);
  return ok(res, await modules.updateOrganization(body), 'Organization updated');
});
export const updateProfile = asyncHandler(async (req, res) => {
  const body = parseBody(updateProfileSchema, req.body);
  return ok(res, await modules.updateProfile(req.user.id, body), 'Profile updated');
});
export const businessDashboard = asyncHandler(async (req, res) =>
  ok(res, await modules.getBusinessDashboard(req.user))
);
export const publicReviews = asyncHandler(async (req, res) =>
  ok(res, await modules.listPublicReviews(req.params.slug))
);
export const createReview = asyncHandler(async (req, res) => {
  const body = parseBody(createReviewSchema, req.body);
  return ok(res, await modules.createReview(body), 'Review submitted', 201);
});
