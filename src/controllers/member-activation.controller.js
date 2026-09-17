import * as activation from '../services/member-activation.service.js';
import { parseBody, activationEmailSchema, activationOtpSchema, activationPasswordSchema } from '../validators/schemas.js';
import { ok } from '../utils/response.js';
import { asyncHandler } from '../middleware/errorHandler.js';

export const requestOtp = asyncHandler(async (req, res) => {
  const body = parseBody(activationEmailSchema, req.body);
  return ok(res, await activation.requestActivationOtp(body.identifier, body.channel), `OTP sent to ${body.channel}`);
});

export const verifyOtp = asyncHandler(async (req, res) => {
  const body = parseBody(activationOtpSchema, req.body);
  return ok(res, await activation.verifyActivationOtp(body.identifier, body.otp, body.channel), 'OTP verified');
});

export const setPassword = asyncHandler(async (req, res) => {
  const body = parseBody(activationPasswordSchema, req.body);
  return ok(res, await activation.setActivationPassword(body.setupToken, body.password), 'Account activated');
});
