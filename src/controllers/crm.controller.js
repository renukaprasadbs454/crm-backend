import * as authService from '../services/auth.service.js';
import * as leadService from '../services/lead.service.js';
import * as activityService from '../services/activity.service.js';
import {
  loginSchema,
  loginOtpRequestSchema,
  loginOtpVerifySchema,
  passwordResetRequestSchema,
  passwordResetVerifySchema,
  passwordResetSchema,
  createLeadSchema,
  updateLeadSchema,
  publicLeadSchema,
  updateStageSchema,
  createActivitySchema,
  convertLeadSchema,
  parseBody,
} from '../validators/schemas.js';
import { ok } from '../utils/response.js';
import { asyncHandler } from '../middleware/errorHandler.js';

export const login = asyncHandler(async (req, res) => {
  const body = parseBody(loginSchema, req.body);
  const result = await authService.login(body);
  return ok(res, result, 'Logged in');
});

export const requestLoginOtp = asyncHandler(async (req, res) => {
  const body = parseBody(loginOtpRequestSchema, req.body);
  const result = await authService.requestLoginOtp(body);
  return ok(res, result, 'Login OTP sent to WhatsApp');
});

export const verifyLoginOtp = asyncHandler(async (req, res) => {
  const body = parseBody(loginOtpVerifySchema, req.body);
  const result = await authService.verifyLoginOtp(body);
  return ok(res, result, 'Logged in');
});

export const requestPasswordReset = asyncHandler(async (req, res) => {
  const body = parseBody(passwordResetRequestSchema, req.body);
  const result = await authService.requestPasswordReset(body);
  return ok(res, result, `${body.channel === 'email' ? 'Email' : 'WhatsApp'} reset code sent`);
});

export const verifyPasswordReset = asyncHandler(async (req, res) => {
  const body = parseBody(passwordResetVerifySchema, req.body);
  const result = await authService.verifyPasswordResetOtp(body);
  return ok(res, result, 'OTP verified');
});

export const resetPassword = asyncHandler(async (req, res) => {
  const body = parseBody(passwordResetSchema, req.body);
  const result = await authService.resetPassword(body);
  return ok(res, result, 'Password reset successfully');
});

export const loginCompanies = asyncHandler(async (req, res) => {
  const companies = await authService.listLoginCompanies(req.query.search);
  return ok(res, companies);
});

export const me = asyncHandler(async (req, res) => {
  const user = await authService.getMe(req.user.id);
  return ok(res, user);
});

export const createLead = asyncHandler(async (req, res) => {
  const body = parseBody(createLeadSchema, req.body);
  const lead = await leadService.createLead(body, req.user);
  return ok(res, lead, 'Lead created', 201);
});

/** Public, unauthenticated capture endpoint for the sales page/landing form. */
export const publicCreateLead = asyncHandler(async (req, res) => {
  const body = parseBody(publicLeadSchema, req.body);
  const result = await leadService.publicCreateLead(body);
  return ok(res, { id: result.id }, 'Thanks — we will reach out shortly', 201);
});

export const listLeads = asyncHandler(async (req, res) => {
  const data = await leadService.listLeads(req.query, req.user);
  return ok(res, data);
});

export const getLead = asyncHandler(async (req, res) => {
  const lead = await leadService.getLeadById(req.params.id, req.user);
  return ok(res, lead);
});

export const updateLead = asyncHandler(async (req, res) => {
  const body = parseBody(updateLeadSchema, req.body);
  const lead = await leadService.updateLead(req.params.id, body, req.user);
  return ok(res, lead, 'Lead updated');
});

export const updateLeadStage = asyncHandler(async (req, res) => {
  const body = parseBody(updateStageSchema, req.body);
  const lead = await leadService.updateStage(req.params.id, body, req.user);
  return ok(res, lead, 'Stage updated');
});

export const convertLead = asyncHandler(async (req, res) => {
  const body = parseBody(convertLeadSchema, req.body);
  const lead = await leadService.convertLead(req.params.id, body, req.user);
  return ok(res, lead, 'Lead converted');
});

export const deleteLead = asyncHandler(async (req, res) => {
  await leadService.deleteLead(req.params.id, req.user);
  return ok(res, null, 'Lead deleted');
});

export const listLeadActivities = asyncHandler(async (req, res) => {
  // Enforces access scope (throws 403/404 if not permitted).
  await leadService.getLeadById(req.params.id, req.user);
  const activities = await activityService.listActivities(req.params.id);
  return ok(res, activities);
});

export const addLeadActivity = asyncHandler(async (req, res) => {
  await leadService.getLeadById(req.params.id, req.user);
  const body = parseBody(createActivitySchema, req.body);
  const activity = await activityService.logActivity({
    leadId: req.params.id,
    authorId: req.user.id,
    type: body.type,
    body: body.body,
  });
  return ok(res, activity, 'Activity added', 201);
});

export const dashboard = asyncHandler(async (req, res) => {
  const stats = await leadService.getDashboardStats(req.user);
  return ok(res, stats);
});
