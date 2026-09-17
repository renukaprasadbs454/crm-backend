import * as companyService from '../services/company.service.js';
import {
  registerSoloSchema,
  registerCompanySchema,
  createCompanyAdminSchema,
  createTLSchema,
  createSalesSchema,
  updateMemberSchema,
  createCompanySchema,
  updateCompanyStatusSchema,
  updateSubscriptionSchema,
  updateSoloSubscriptionSchema,
  updatePlanSchema,
  createPlanSchema,
  updateUserStatusSchema,
  updatePlatformCompanySchema,
  updatePlatformSoloSchema,
    createPlatformSoloSchema,
    subscriptionCheckoutSchema,
  parseBody,
} from '../validators/schemas.js';
import { ok } from '../utils/response.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { z } from 'zod';

// ── Signup ────────────────────────────────────────────────────────────
export const registerSolo = asyncHandler(async (req, res) => {
  const body = parseBody(registerSoloSchema, req.body);
  return ok(res, await companyService.registerSolo(body), 'Solo account created', 201);
});

export const registerCompany = asyncHandler(async (req, res) => {
  const body = parseBody(registerCompanySchema, req.body);
  return ok(res, await companyService.registerCompany(body), 'Company account created', 201);
});

export const createSignupOrder = asyncHandler(async (req, res) => {
  const body = parseBody(z.object({ planTier: z.string().min(1) }), req.body);
  return ok(res, await companyService.createSignupOrder(body));
});

// ── Company member management ─────────────────────────────────────────
export const addCompanyAdmin = asyncHandler(async (req, res) => {
  const body = parseBody(createCompanyAdminSchema, req.body);
  return ok(res, await companyService.addCompanyAdmin(body, req.user), 'Company Admin added', 201);
});

export const addTeamLead = asyncHandler(async (req, res) => {
  const body = parseBody(createTLSchema, req.body);
  return ok(res, await companyService.addTeamLead(body, req.user), 'Team Lead added', 201);
});

export const addSalesperson = asyncHandler(async (req, res) => {
  const body = parseBody(createSalesSchema, req.body);
  return ok(res, await companyService.addSalesperson(body, req.user), 'Salesperson added', 201);
});

export const listMembers = asyncHandler(async (req, res) => ok(res, await companyService.listMembers(req.user)));

export const updateMember = asyncHandler(async (req, res) => {
  const body = parseBody(updateMemberSchema, req.body);
  return ok(res, await companyService.updateMember(req.params.id, body, req.user), 'Member updated');
});

export const removeMember = asyncHandler(async (req, res) => {
  await companyService.removeMember(req.params.id, req.user);
  return ok(res, null, 'Member removed');
});
export const resendMemberOtp = asyncHandler(async (req, res) => {
  return ok(res, await companyService.resendMemberOtp(req.params.id, req.user), 'OTP sent to WhatsApp');
});


// ── Company / TL dashboards ─────────────────────────────────────────────
export const companyDashboard = asyncHandler(async (req, res) => ok(res, await companyService.companyDashboard(req.user)));
export const tlDashboard = asyncHandler(async (req, res) => ok(res, await companyService.tlDashboard(req.user)));

// ── Platform Admin (aggregate/metadata only — never CRM records) ────────
export const platformOverview = asyncHandler(async (_req, res) => ok(res, await companyService.platformOverview()));

export const listCompanies = asyncHandler(async (req, res) => ok(res, await companyService.listCompanies(req.query)));

export const getCompanyMetadata = asyncHandler(async (req, res) =>
  ok(res, await companyService.getCompanyMetadata(req.params.id))
);

export const updateCompanyStatus = asyncHandler(async (req, res) => {
  const body = parseBody(updateCompanyStatusSchema, req.body);
  return ok(res, await companyService.updateCompanyStatus(req.params.id, body.status), 'Company status updated');
});
export const updatePlatformCompany = asyncHandler(async (req, res) => ok(res, await companyService.updatePlatformCompany(req.params.id, parseBody(updatePlatformCompanySchema, req.body)), 'Company updated'));
export const deletePlatformCompany = asyncHandler(async (req, res) => { await companyService.deletePlatformCompany(req.params.id); return ok(res, null, 'Company deleted'); });

export const platformCreateCompany = asyncHandler(async (req, res) => {
  const body = parseBody(createCompanySchema, req.body);
  return ok(res, await companyService.platformCreateCompany(body), 'Company created', 201);
});

export const listPlans = asyncHandler(async (_req, res) => ok(res, await companyService.listPlans()));
export const updatePlan = asyncHandler(async (req, res) => {
  const body = parseBody(updatePlanSchema, req.body);
  return ok(res, await companyService.updatePlan(req.params.tier, body), 'Plan updated');
});
export const deletePlan = asyncHandler(async (req, res) => { await companyService.deletePlan(req.params.tier); return ok(res, null, 'Plan deleted'); });
export const createPlan = asyncHandler(async (req, res) => ok(res, await companyService.createPlan(parseBody(createPlanSchema, req.body)), 'Plan created', 201));
export const listFreelancers = asyncHandler(async (_req, res) => ok(res, await companyService.listFreelancers()));
export const platformCreateSolo = asyncHandler(async (req, res) => ok(res, await companyService.platformCreateSolo(parseBody(createPlatformSoloSchema, req.body)), 'Freelancer created', 201));
export const updateCompanySubscription = asyncHandler(async (req, res) => {
  const body = parseBody(updateSubscriptionSchema, req.body);
  return ok(res, await companyService.updateCompanySubscription(req.params.id, body), 'Subscription updated');
});
export const deleteCompanySubscription = asyncHandler(async (req, res) => { await companyService.deleteCompanySubscription(req.params.id); return ok(res, null, 'Subscription deleted'); });
export const updateSoloSubscription = asyncHandler(async (req, res) => {
  const body = parseBody(updateSoloSubscriptionSchema, req.body);
  return ok(res, await companyService.updateSoloSubscription(req.params.id, body), 'Subscription updated');
});
export const deleteSoloSubscription = asyncHandler(async (req, res) => { await companyService.deleteSoloSubscription(req.params.id); return ok(res, null, 'Subscription deleted'); });
export const updateSoloStatus = asyncHandler(async (req, res) => {
  const body = parseBody(updateUserStatusSchema, req.body);
  return ok(res, await companyService.updateSoloStatus(req.params.id, body.isActive), 'Freelancer status updated');
});
export const updatePlatformSolo = asyncHandler(async (req, res) => ok(res, await companyService.updatePlatformSolo(req.params.id, parseBody(updatePlatformSoloSchema, req.body)), 'Freelancer updated'));
export const deletePlatformSolo = asyncHandler(async (req, res) => { await companyService.deletePlatformSolo(req.params.id); return ok(res, null, 'Freelancer deleted'); });
export const checkoutSubscription = asyncHandler(async (req, res) => ok(res, await companyService.checkoutSubscription(req.user, parseBody(subscriptionCheckoutSchema, req.body)), 'Subscription activated'));
