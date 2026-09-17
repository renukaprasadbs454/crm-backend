import { Router } from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import {
  authenticate,
  requireRoles,
  blockPlatformAdmin,
  requireCompanyContext,
} from '../middleware/auth.middleware.js';
import * as ctrl from '../controllers/crm.controller.js';
import * as reports from '../controllers/report.controller.js';
import * as mod from '../controllers/modules.controller.js';
import * as company from '../controllers/company.controller.js';
import * as activation from '../controllers/member-activation.controller.js';
import * as calls from '../controllers/call.controller.js';
import * as whatsappWebhook from '../controllers/whatsapp.controller.js';

const router = Router();
const recordingUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

const publicLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests, please try again later' },
});

// ── Public ────────────────────────────────────────────────────────────
router.post('/public/leads', publicLimiter, ctrl.publicCreateLead);
router.get('/public/reviews/:slug', publicLimiter, mod.publicReviews);
router.post('/public/reviews', publicLimiter, mod.createReview);
router.get('/public/plans', publicLimiter, company.listPlans);

router.get('/auth/companies', publicLimiter, ctrl.loginCompanies);
router.post('/auth/login', publicLimiter, ctrl.login);
router.post('/auth/login/request-otp', publicLimiter, ctrl.requestLoginOtp);
router.post('/auth/login/verify-otp', publicLimiter, ctrl.verifyLoginOtp);
router.post('/auth/password-reset/request', publicLimiter, ctrl.requestPasswordReset);
router.post('/auth/password-reset/verify-otp', publicLimiter, ctrl.verifyPasswordReset);
router.post('/auth/password-reset/reset', publicLimiter, ctrl.resetPassword);
router.post('/auth/activation/request-otp', publicLimiter, activation.requestOtp);
router.post('/auth/activation/verify-otp', publicLimiter, activation.verifyOtp);
router.post('/auth/activation/set-password', publicLimiter, activation.setPassword);
// Signup — creates a brand-new workspace. Two distinct flows per the
// subscription model: a freelancer gets a SOLO workspace, a business gets
// a COMPANY workspace (+ becomes its first COMPANY_ADMIN).
router.post('/auth/register/solo', publicLimiter, company.registerSolo);
router.post('/auth/register/company', publicLimiter, company.registerCompany);
router.post('/auth/register/order', publicLimiter, company.createSignupOrder);

// Meta WhatsApp Cloud API webhook — unauthenticated by design, protected by
// Meta's verification token and X-Hub-Signature-256 in production.
router.get('/webhooks/whatsapp', whatsappWebhook.verify);
router.post('/webhooks/whatsapp', whatsappWebhook.receive);

router.use(authenticate);

router.get('/auth/me', ctrl.me);
router.post('/subscription/checkout', requireRoles('COMPANY_ADMIN', 'SOLO'), company.checkoutSubscription);
router.patch('/auth/profile', mod.updateProfile);

// Mobile Caller / Calls — all role checks happen server-side. The browser may
// display a role selector, but the backend derives the real role from the JWT
// subject and database record before every protected operation.
router.get('/calls/dashboard', requireRoles('COMPANY_ADMIN', 'TL', 'SALES', 'SOLO'), calls.dashboard);
router.get('/calls', requireRoles('COMPANY_ADMIN', 'TL', 'SALES', 'SOLO'), calls.list);
router.post('/calls/initiate', requireRoles('COMPANY_ADMIN', 'TL', 'SALES', 'SOLO'), calls.initiate);
router.get('/calls/:id', requireRoles('COMPANY_ADMIN', 'TL', 'SALES', 'SOLO'), calls.get);
router.post('/calls/:id/events', requireRoles('COMPANY_ADMIN', 'TL', 'SALES', 'SOLO'), calls.event);
router.patch('/calls/:id/disposition', requireRoles('COMPANY_ADMIN', 'TL', 'SALES', 'SOLO'), calls.disposition);
router.post('/calls/:id/recordings', requireRoles('COMPANY_ADMIN', 'TL', 'SALES', 'SOLO'), recordingUpload.single('file'), calls.uploadRecording);
router.delete('/calls/:id/recordings/:recordingId', requireRoles('COMPANY_ADMIN', 'TL', 'SALES', 'SOLO'), calls.deleteRecording);
router.get('/agents/me/talk-time', requireRoles('COMPANY_ADMIN', 'TL', 'SALES', 'SOLO'), calls.talkTime);

router.post('/devices/register', requireRoles('COMPANY_ADMIN', 'TL', 'SALES', 'SOLO'), calls.registerDevice);
router.get('/devices/me', requireRoles('COMPANY_ADMIN', 'TL', 'SALES', 'SOLO'), calls.myDevice);
router.post('/devices/heartbeat', requireRoles('COMPANY_ADMIN', 'TL', 'SALES', 'SOLO'), calls.heartbeat);
router.get('/devices/me/commands', requireRoles('COMPANY_ADMIN', 'TL', 'SALES', 'SOLO'), calls.pendingCommands);
router.post('/devices/commands/:id/ack', requireRoles('COMPANY_ADMIN', 'TL', 'SALES', 'SOLO'), calls.acknowledgeCommand);
router.get('/devices', requireRoles('COMPANY_ADMIN', 'TL'), calls.devices);
router.delete('/devices/:id', requireRoles('COMPANY_ADMIN'), calls.revokeDevice);

// ── CRM data routes ───────────────────────────────────────────────────
// PLATFORM_ADMIN is blocked from every CRM data route below — by design,
// that role only ever sees company metadata/usage (see the /admin/*
// routes further down), never a single Lead/Client/Payment/etc record.
// Scoped to its own sub-router so the block does NOT apply to the
// company-management or platform-admin routes mounted afterward.
const crmData = Router();
crmData.use(blockPlatformAdmin);

crmData.get('/dashboard', ctrl.dashboard);
crmData.get('/business-dashboard', mod.businessDashboard);

// Leads
crmData.get('/leads', ctrl.listLeads);
crmData.post('/leads', ctrl.createLead);
crmData.get('/leads/:id', ctrl.getLead);
crmData.patch('/leads/:id', ctrl.updateLead);
crmData.delete('/leads/:id', ctrl.deleteLead); // scope + role checked inside leadService.deleteLead
crmData.patch('/leads/:id/stage', ctrl.updateLeadStage);
crmData.post('/leads/:id/convert', ctrl.convertLead);
crmData.get('/leads/:id/activities', ctrl.listLeadActivities);
crmData.post('/leads/:id/activities', ctrl.addLeadActivity);

// Clients
crmData.get('/clients', mod.listClients);
crmData.post('/clients', mod.createClient);
crmData.get('/clients/:id', mod.getClient);
crmData.patch('/clients/:id', mod.updateClient);
crmData.delete('/clients/:id', requireRoles('COMPANY_ADMIN', 'SOLO'), mod.deleteClient);

// Projects
crmData.get('/projects', mod.listProjects);
crmData.post('/projects', mod.createProject);
crmData.get('/projects/:id', mod.getProject);
crmData.patch('/projects/:id', mod.updateProject);
crmData.delete('/projects/:id', requireRoles('COMPANY_ADMIN', 'SOLO'), mod.deleteProject);

// Retainers
crmData.get('/retainers', mod.listRetainers);
crmData.post('/retainers', mod.createRetainer);
crmData.get('/retainers/:id', mod.getRetainer);
crmData.patch('/retainers/:id', mod.updateRetainer);
crmData.delete('/retainers/:id', requireRoles('COMPANY_ADMIN', 'SOLO'), mod.deleteRetainer);

// Payments
crmData.get('/payments', mod.listPayments);
crmData.post('/payments', mod.createPayment);
crmData.get('/payments/:id', mod.getPayment);
crmData.patch('/payments/:id', mod.updatePayment);
crmData.delete('/payments/:id', requireRoles('COMPANY_ADMIN', 'SOLO'), mod.deletePayment);

// Messages
crmData.get('/messages', mod.listMessages);
crmData.post('/messages', mod.createMessage);
crmData.patch('/messages/:id', mod.updateMessage);
crmData.delete('/messages/:id', mod.deleteMessage);

// Meetings
crmData.get('/meetings', mod.listMeetings);
crmData.post('/meetings', mod.createMeeting);
crmData.patch('/meetings/:id', mod.updateMeeting);
crmData.delete('/meetings/:id', mod.deleteMeeting);

// Tasks
crmData.get('/tasks', mod.listTasks);
crmData.post('/tasks', mod.createTask);
crmData.patch('/tasks/:id', mod.updateTask);
crmData.delete('/tasks/:id', mod.deleteTask);

// Settings
crmData.get('/settings/organization', mod.getOrg);
crmData.patch('/settings/organization', requireRoles('COMPANY_ADMIN', 'SOLO'), mod.updateOrg);

// Reports — company/team-scoped performance views.
crmData.get('/reports/overview', requireRoles('COMPANY_ADMIN', 'TL'), reports.overview);
crmData.get('/reports/by-source', requireRoles('COMPANY_ADMIN', 'TL'), reports.bySource);
crmData.get('/reports/by-rep', requireRoles('COMPANY_ADMIN', 'TL'), reports.byRep);

// ── Company / team management (Company Admin, TL) ───────────────────────
// IMPORTANT: these — and everything under Platform Admin below — MUST be
// registered before `router.use(crmData)`. `crmData.use(blockPlatformAdmin)`
// has no path scoping, so once mounted via `router.use(crmData)` it runs
// for every request reaching that point in `router`, not just crmData's
// own routes — and since it calls next(error), it short-circuits straight
// to the error handler, never letting Express reach routes registered
// *after* the mount, even ones with completely different paths. Registering
// these route groups first means Express fully resolves them before
// `crmData` (and its blockPlatformAdmin guard) is ever reached.
router.get('/company/dashboard', requireRoles('COMPANY_ADMIN'), company.companyDashboard);
router.get('/company/tl-dashboard', requireRoles('TL'), company.tlDashboard);
router.get('/company/members', requireCompanyContext, company.listMembers);
router.post('/company/admins', requireRoles('COMPANY_ADMIN'), company.addCompanyAdmin);
router.post('/company/team-leads', requireRoles('COMPANY_ADMIN'), company.addTeamLead);
router.post('/company/salespeople', requireRoles('COMPANY_ADMIN', 'TL'), company.addSalesperson);
router.patch('/company/members/:id', requireRoles('COMPANY_ADMIN', 'TL'), company.updateMember);
router.delete('/company/members/:id', requireRoles('COMPANY_ADMIN'), company.removeMember);
router.post('/company/members/:id/resend-otp', requireRoles('COMPANY_ADMIN', 'TL'), company.resendMemberOtp);

// ── Platform Admin ────────────────────────────────────────────────────
// Everything under here is metadata/aggregate-only, enforced in
// company.service.js — no route here ever touches a Lead/Client/etc row.
router.get('/admin/overview', requireRoles('PLATFORM_ADMIN'), company.platformOverview);
router.get('/admin/companies', requireRoles('PLATFORM_ADMIN'), company.listCompanies);
router.get('/admin/companies/:id', requireRoles('PLATFORM_ADMIN'), company.getCompanyMetadata);
router.post('/admin/companies', requireRoles('PLATFORM_ADMIN'), company.platformCreateCompany);
router.patch('/admin/companies/:id/status', requireRoles('PLATFORM_ADMIN'), company.updateCompanyStatus);
router.patch('/admin/companies/:id', requireRoles('PLATFORM_ADMIN'), company.updatePlatformCompany);
router.delete('/admin/companies/:id', requireRoles('PLATFORM_ADMIN'), company.deletePlatformCompany);
router.get('/admin/plans', requireRoles('PLATFORM_ADMIN'), company.listPlans);
router.patch('/admin/plans/:tier', requireRoles('PLATFORM_ADMIN'), company.updatePlan);
router.delete('/admin/plans/:tier', requireRoles('PLATFORM_ADMIN'), company.deletePlan);
router.post('/admin/plans', requireRoles('PLATFORM_ADMIN'), company.createPlan);
router.get('/admin/freelancers', requireRoles('PLATFORM_ADMIN'), company.listFreelancers);
router.post('/admin/freelancers', requireRoles('PLATFORM_ADMIN'), company.platformCreateSolo);
router.patch('/admin/freelancers/:id/subscription', requireRoles('PLATFORM_ADMIN'), company.updateSoloSubscription);
router.delete('/admin/freelancers/:id/subscription', requireRoles('PLATFORM_ADMIN'), company.deleteSoloSubscription);
router.patch('/admin/freelancers/:id/status', requireRoles('PLATFORM_ADMIN'), company.updateSoloStatus);
router.patch('/admin/freelancers/:id', requireRoles('PLATFORM_ADMIN'), company.updatePlatformSolo);
router.delete('/admin/freelancers/:id', requireRoles('PLATFORM_ADMIN'), company.deletePlatformSolo);
router.patch('/admin/companies/:id/subscription', requireRoles('PLATFORM_ADMIN'), company.updateCompanySubscription);
router.delete('/admin/companies/:id/subscription', requireRoles('PLATFORM_ADMIN'), company.deleteCompanySubscription);

router.use(crmData);

export default router;
