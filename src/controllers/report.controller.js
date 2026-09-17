import * as reportService from '../services/report.service.js';
import { ok } from '../utils/response.js';
import { asyncHandler } from '../middleware/errorHandler.js';

export const overview = asyncHandler(async (req, res) => {
  const data = await reportService.getOverview(req.user);
  return ok(res, data);
});

export const bySource = asyncHandler(async (req, res) => {
  const data = await reportService.getBySource(req.user);
  return ok(res, data);
});

export const byRep = asyncHandler(async (req, res) => {
  const data = await reportService.getByRep(req.user);
  return ok(res, data);
});
