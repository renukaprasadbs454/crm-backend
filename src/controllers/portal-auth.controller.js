import * as portalAuthService from '../services/portal-auth.service.js';
import { clientLoginSchema, clientRegisterSchema, parseBody } from '../validators/schemas.js';
import { ok } from '../utils/response.js';
import { asyncHandler } from '../middleware/errorHandler.js';

export const googleStart = asyncHandler(async (req, res) => {
  const mode = req.query.mode === 'client' ? 'client' : 'staff';
  const url = portalAuthService.buildGoogleStartUrl(mode);
  return ok(res, { url });
});

export const googleCallback = asyncHandler(async (req, res) => {
  const code = String(req.query.code || '');
  const state = String(req.query.state || '');
  const redirectUrl = await portalAuthService.handleGoogleCallback(code, state);
  return res.redirect(302, redirectUrl);
});

export const clientRegister = asyncHandler(async (req, res) => {
  const body = parseBody(clientRegisterSchema, req.body);
  const data = await portalAuthService.clientRegister(body);
  return ok(res, data, 'Client account created', 201);
});

export const clientLogin = asyncHandler(async (req, res) => {
  const body = parseBody(clientLoginSchema, req.body);
  const data = await portalAuthService.clientLogin(body.email, body.password);
  return ok(res, data, 'Client logged in');
});

export const clientMe = asyncHandler(async (req, res) => {
  const data = await portalAuthService.getClientMe(req.client.id);
  return ok(res, data);
});

export const clientDashboard = asyncHandler(async (req, res) => {
  const data = await portalAuthService.getClientPortalDashboard(req.client.id);
  return ok(res, data);
});
