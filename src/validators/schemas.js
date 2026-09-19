import { z } from 'zod';

const phoneRegex = /^[0-9+\-\s()]{7,20}$/;

const INTEREST_VALUES = ['INTERESTED', 'NOT_INTERESTED', 'ON_HOLD'];
const STAGE_VALUES = [
  'NEW',
  'CONTACTED',
  'QUALIFIED',
  'DEMO_SCHEDULED',
  'NEGOTIATING',
  'WON',
  'LOST',
];
const ACTIVITY_VALUES = [
  'NOTE',
  'CALL',
  'EMAIL',
  'WHATSAPP',
  'MEETING',
  'STAGE_CHANGE',
  'ASSIGNMENT',
  'CONVERSION',
  'SYSTEM',
];

// The company/organisation selector on the frontend starts out as an empty
// string ('') before the company list finishes loading (or if it ever comes
// back empty). Treat '' and null the same as "not provided" instead of
// hard-failing validation with "Invalid uuid" — that 400 was rejecting the
// Company Owner / Company Admin / Team Lead / Sales logins before the
// request ever reached the database, so those roles could never sign in
// via that page.
const emptyToUndefined = (v) => (v === '' || v === null ? undefined : v);
const optionalCompanyId = z.preprocess(emptyToUndefined, z.string().uuid().optional());
const optionalCompanyName = z.preprocess(emptyToUndefined, z.string().min(2).optional());

export const loginSchema = z.object({
  identifier: z.string().min(3),
  password: z.string().min(6),
  companyId: optionalCompanyId,
  companyName: optionalCompanyName,
  role: z.enum(['PLATFORM_ADMIN', 'COMPANY_ADMIN', 'TL', 'SALES', 'SOLO']).optional(),
});

export const loginOtpRequestSchema = z.object({
  identifier: z.string().min(3),
  channel: z.enum(['email', 'whatsapp']).default('email'),
  companyId: optionalCompanyId,
  companyName: optionalCompanyName,
  role: z.enum(['COMPANY_ADMIN', 'TL', 'SALES', 'SOLO']).optional(),
});

export const loginOtpVerifySchema = z.object({
  identifier: z.string().min(3),
  otp: z.string().regex(/^\d{6}$/, 'OTP must be 6 digits'),
  channel: z.enum(['email', 'whatsapp']).default('email'),
  companyId: optionalCompanyId,
  companyName: optionalCompanyName,
  role: z.enum(['COMPANY_ADMIN', 'TL', 'SALES', 'SOLO']).optional(),
});

export const activationEmailSchema = z.object({
  identifier: z.string().min(3),
  channel: z.enum(['email', 'whatsapp']).default('whatsapp'),
});

export const activationOtpSchema = z.object({
  identifier: z.string().min(3),
  otp: z.string().regex(/^\d{6}$/, 'OTP must be 6 digits'),
  channel: z.enum(['email', 'whatsapp']).default('whatsapp'),
});

export const activationPasswordSchema = z.object({
  setupToken: z.string().min(20),
  password: z.string().min(8).max(128),
});

export const passwordResetRequestSchema = z.object({
  identifier: z.string().min(3),
  channel: z.enum(['whatsapp', 'email']),
  companyId: optionalCompanyId,
  companyName: optionalCompanyName,
  role: z.enum(['PLATFORM_ADMIN', 'COMPANY_ADMIN', 'TL', 'SALES', 'SOLO']).optional(),
});

export const passwordResetVerifySchema = z.object({
  identifier: z.string().min(3),
  otp: z.string().regex(/^\d{6}$/, 'OTP must be 6 digits'),
  companyId: optionalCompanyId,
  companyName: optionalCompanyName,
  role: z.enum(['PLATFORM_ADMIN', 'COMPANY_ADMIN', 'TL', 'SALES', 'SOLO']).optional(),
});

export const passwordResetSchema = z.object({
  resetToken: z.string().min(20),
  password: z.string().min(8).max(128),
});

// ── Signup (creates a brand-new workspace) ──────────────────────────────
export const registerSoloSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).optional(),
  name: z.string().min(2),
  companyName: z.string().min(2).max(120),
  phone: z.string().regex(phoneRegex),
  verificationChannel: z.enum(['email', 'whatsapp']).default('whatsapp'),
  planTier: z.enum(['SOLO_FREE', 'SOLO_PRO', 'SOLO_BUSINESS']).default('SOLO_FREE'),
  razorpayOrderId: z.string().min(1).optional(),
  razorpayPaymentId: z.string().min(1).optional(),
  razorpaySignature: z.string().min(1).optional(),
});

export const registerCompanySchema = z.object({
  companyName: z.string().min(2).max(120),
  industry: z.string().min(2).max(120).optional().nullable(),
  employeeCount: z.coerce.number().int().min(1).max(1000000).optional().nullable(),
  website: z.string().url().max(300).optional().nullable().or(z.literal('')),
  city: z.string().max(120).optional().nullable(),
  email: z.string().email(),
  password: z.string().min(8).max(128).optional(),
  name: z.string().min(2),
  phone: z.string().regex(phoneRegex),
  verificationChannel: z.enum(['email', 'whatsapp']).default('whatsapp'),
  planTier: z.enum(['COMPANY_STARTER', 'COMPANY_GROWTH', 'COMPANY_PRO', 'ENTERPRISE']).default('COMPANY_STARTER'),
  razorpayOrderId: z.string().min(1).optional(),
  razorpayPaymentId: z.string().min(1).optional(),
  razorpaySignature: z.string().min(1).optional(),
});

// ── Company-scoped member management (Company Owner / TL only) ─────────
export const createCompanyAdminSchema = z.object({
  email: z.string().email(),
  name: z.string().min(2),
  phone: z.string().regex(phoneRegex),
});

export const createTLSchema = z.object({
  email: z.string().email(),
  name: z.string().min(2),
  phone: z.string().regex(phoneRegex),
  teamName: z.string().min(1).max(120).optional(),
});

export const createSalesSchema = z.object({
  email: z.string().email(),
  name: z.string().min(2),
  phone: z.string().regex(phoneRegex),
  teamId: z.string().uuid().optional().nullable(),
});

export const updateMemberSchema = z.object({
  name: z.string().min(2).optional(),
  phone: z.string().regex(phoneRegex).optional().nullable(),
  isActive: z.boolean().optional(),
  teamId: z.string().uuid().optional().nullable(),
});

// ── Platform admin: create/manage Company tenants ───────────────────────
export const createCompanySchema = z.object({
  companyName: z.string().min(2).max(120),
  ownerEmail: z.string().email(),
  ownerPassword: z.string().min(8),
  ownerName: z.string().min(2),
  ownerPhone: z.string().regex(phoneRegex).optional().nullable(),
  verificationChannel: z.enum(['email', 'whatsapp']).default('email'),
  planTier: z.enum(['COMPANY_STARTER', 'COMPANY_GROWTH', 'COMPANY_PRO', 'ENTERPRISE']).default('COMPANY_STARTER'),
});

export const updateCompanyStatusSchema = z.object({
  status: z.enum(['TRIAL', 'ACTIVE', 'SUSPENDED', 'CANCELLED']),
});

export const updateSubscriptionSchema = z.object({
  planTier: z.enum(['SOLO_FREE', 'SOLO_PRO', 'SOLO_BUSINESS', 'COMPANY_STARTER', 'COMPANY_GROWTH', 'COMPANY_PRO', 'ENTERPRISE']),
  status: z.enum(['TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELLED', 'EXPIRED']).optional(),
});

export const updateSoloSubscriptionSchema = z.object({
  planTier: z.enum(['SOLO_FREE', 'SOLO_PRO', 'SOLO_BUSINESS']),
  status: z.enum(['TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELLED', 'EXPIRED']).optional(),
});

export const updatePlatformCompanySchema = z.object({
  companyName: z.string().min(2).max(120).optional(),
  ownerName: z.string().min(2).optional(),
  ownerEmail: z.string().email().optional(),
});

export const updatePlatformSoloSchema = z.object({
  name: z.string().min(2).optional(),
  email: z.string().email().optional(),
  phone: z.string().regex(phoneRegex).optional().nullable(),
});

export const createPlatformSoloSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  phone: z.string().regex(phoneRegex).optional().nullable(),
  password: z.string().min(8),
  verificationChannel: z.enum(['email', 'whatsapp']).default('email'),
  planTier: z.enum(['SOLO_FREE', 'SOLO_PRO', 'SOLO_BUSINESS']).default('SOLO_FREE'),
});

export const subscriptionCheckoutSchema = z.object({
  planTier: z.enum(['SOLO_FREE', 'SOLO_PRO', 'SOLO_BUSINESS', 'COMPANY_STARTER', 'COMPANY_GROWTH', 'COMPANY_PRO', 'ENTERPRISE']),
  razorpayOrderId: z.string().min(1).optional(),
  razorpayPaymentId: z.string().min(1).optional(),
  razorpaySignature: z.string().min(1).optional(),
});

export const updatePlanSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  priceMonthly: z.coerce.number().min(0).max(99999999).optional(),
  maxUsers: z.coerce.number().int().min(0).nullable().optional(),
  maxTLs: z.coerce.number().int().min(0).nullable().optional(),
  maxLeads: z.coerce.number().int().min(0).nullable().optional(),
  storageGB: z.coerce.number().int().min(0).nullable().optional(),
  apiCallsPerMonth: z.coerce.number().int().min(0).nullable().optional(),
  isActive: z.boolean().optional(),
});

export const createPlanSchema = updatePlanSchema.extend({
  tier: z.enum(['SOLO_FREE', 'SOLO_PRO', 'SOLO_BUSINESS', 'COMPANY_STARTER', 'COMPANY_GROWTH', 'COMPANY_PRO', 'ENTERPRISE']),
  workspaceType: z.enum(['SOLO', 'COMPANY']),
  currency: z.string().length(3).default('INR'),
});

export const updateUserStatusSchema = z.object({ isActive: z.boolean() });

const leadFieldsSchema = z.object({
  phone: z.string().regex(phoneRegex, 'Valid phone is required'),
  fullName: z.string().min(1).optional().nullable(),
  email: z.string().email().optional().nullable().or(z.literal('')),
  detailType: z.enum(['COLLEGE', 'COMPANY']).default('COLLEGE'),
  collegeName: z.string().min(1).optional().nullable(),
  collegeCity: z.string().optional().nullable(),
  collegeCourse: z.string().optional().nullable(),
  collegeYear: z.string().optional().nullable(),
  companyName: z.string().min(1).optional().nullable(),
  companyCity: z.string().optional().nullable(),
  companyIndustry: z.string().optional().nullable(),
  companySize: z.string().optional().nullable(),
  interest: z.enum(INTEREST_VALUES).default('ON_HOLD'),
  stage: z.enum(STAGE_VALUES).default('NEW'),
  source: z.string().min(1).max(60).optional(),
  comments: z.string().optional().nullable(),
  assignedToId: z.string().uuid().optional().nullable(),
});

export const createLeadSchema = leadFieldsSchema.superRefine((data, ctx) => {
  const name = data.detailType === 'COMPANY' ? data.companyName : data.collegeName;
  if (!name?.trim()) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [data.detailType === 'COMPANY' ? 'companyName' : 'collegeName'], message: `${data.detailType === 'COMPANY' ? 'Company' : 'College'} name is required` });
});

export const updateLeadSchema = leadFieldsSchema.partial().extend({
  phone: z.string().regex(phoneRegex).optional(),
});

/**
 * Public, unauthenticated lead capture (future sales page / landing form).
 * Intentionally minimal and permissive — only phone + college are required.
 */
export const publicLeadSchema = z.object({
  phone: z.string().regex(phoneRegex, 'A valid phone number is required'),
  fullName: z.string().min(1).max(120).optional().nullable(),
  email: z.string().email().optional().nullable().or(z.literal('')),
  detailType: z.enum(['COLLEGE', 'COMPANY']).default('COLLEGE'),
  collegeName: z.string().min(1).optional().nullable(),
  collegeCity: z.string().max(120).optional().nullable(),
  collegeCourse: z.string().max(120).optional().nullable(),
  collegeYear: z.string().max(60).optional().nullable(),
  companyName: z.string().min(1).optional().nullable(),
  companyCity: z.string().max(120).optional().nullable(),
  companyIndustry: z.string().max(120).optional().nullable(),
  companySize: z.string().max(120).optional().nullable(),
  source: z.string().min(1).max(60).optional(),
  message: z.string().max(2000).optional().nullable(),
}).superRefine((data, ctx) => {
  const name = data.detailType === 'COMPANY' ? data.companyName : data.collegeName;
  if (!name?.trim()) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [data.detailType === 'COMPANY' ? 'companyName' : 'collegeName'], message: 'Name is required' });
});

export const updateStageSchema = z.object({
  stage: z.enum(STAGE_VALUES),
  note: z.string().max(2000).optional().nullable(),
});

export const createActivitySchema = z.object({
  type: z.enum(ACTIVITY_VALUES).default('NOTE'),
  body: z.string().min(1, 'Activity body is required').max(4000),
});

export const convertLeadSchema = z.object({
  convertedRef: z.string().max(200).optional().nullable(),
  note: z.string().max(2000).optional().nullable(),
  createClient: z.boolean().optional().default(true),
});

export const updateProfileSchema = z.object({
  name: z.string().min(2).optional(),
  phone: z.string().regex(phoneRegex).optional().nullable(),
  timezone: z.string().min(2).max(60).optional(),
  password: z.string().min(6).optional(),
});


export const initiateCallSchema = z.object({
  leadId: z.string().uuid(),
  deviceId: z.string().uuid().optional(),
  idempotencyKey: z.string().min(8).max(120).optional(),
});

export const callEventSchema = z.object({
  eventId: z.string().min(8).max(120),
  state: z.enum(['DELIVERED', 'RINGING', 'CONNECTED', 'ENDED', 'FAILED', 'EXPIRED']),
  failureReason: z.string().max(500).optional().nullable(),
  payload: z.record(z.any()).optional().nullable(),
});

export const callDispositionSchema = z.object({
  disposition: z.string().min(1).max(80),
  notes: z.string().max(2000).optional().nullable(),
});

export const registerDeviceSchema = z.object({
  deviceId: z.string().min(8).max(200),
  deviceName: z.string().min(1).max(120),
  platform: z.string().max(40).default('ANDROID'),
  appVersion: z.string().max(40).default('1.0.0'),
  selectedSimId: z.string().max(200).optional().nullable(),
});

export const heartbeatSchema = z.object({
  deviceId: z.string().uuid(),
  appVersion: z.string().max(40).optional(),
  selectedSimId: z.string().max(200).optional().nullable(),
});

export const updateOrgSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  logoUrl: z.string().url().optional().nullable().or(z.literal('')),
  currency: z.string().min(3).max(8).optional(),
  publicSlug: z.string().min(2).max(60).regex(/^[a-z0-9-]+$/).optional(),
  reminderLeadMinutes: z.number().int().min(0).max(1440).optional(),
  browserNotifications: z.boolean().optional(),
});

export const createClientSchema = z.object({
  name: z.string().min(1),
  email: z.string().email().optional().nullable().or(z.literal('')),
  phone: z.string().regex(phoneRegex).optional().nullable(),
  company: z.string().max(120).optional().nullable(),
  notes: z.string().max(4000).optional().nullable(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'ONBOARDING']).default('ONBOARDING'),
  ownerId: z.string().uuid().optional().nullable(),
  leadId: z.string().uuid().optional().nullable(),
});
export const updateClientSchema = createClientSchema.partial();

export const createProjectSchema = z.object({
  title: z.string().min(1),
  description: z.string().max(4000).optional().nullable(),
  status: z.enum(['NEW', 'ONGOING', 'COMPLETED', 'CANCELLED']).default('NEW'),
  budget: z.coerce.number().min(0).default(0),
  startDate: z.string().datetime().optional().nullable().or(z.literal('')),
  endDate: z.string().datetime().optional().nullable().or(z.literal('')),
  clientId: z.string().uuid(),
  ownerId: z.string().uuid().optional().nullable(),
});
export const updateProjectSchema = createProjectSchema.partial().extend({
  clientId: z.string().uuid().optional(),
});

export const createRetainerSchema = z.object({
  title: z.string().min(1),
  description: z.string().max(4000).optional().nullable(),
  status: z.enum(['ACTIVE', 'PAUSED', 'CANCELLED']).default('ACTIVE'),
  monthlyAmount: z.coerce.number().min(0).default(0),
  startDate: z.string().datetime().optional().nullable().or(z.literal('')),
  endDate: z.string().datetime().optional().nullable().or(z.literal('')),
  clientId: z.string().uuid(),
  ownerId: z.string().uuid().optional().nullable(),
});
export const updateRetainerSchema = createRetainerSchema.partial().extend({
  clientId: z.string().uuid().optional(),
});

export const createPaymentSchema = z.object({
  title: z.string().min(1),
  amount: z.coerce.number().positive(),
  type: z.enum(['REVENUE', 'EXPENSE']).default('REVENUE'),
  status: z.enum(['PENDING', 'RECEIVED', 'FAILED', 'REFUNDED']).default('PENDING'),
  category: z.string().max(60).optional().nullable(),
  paidAt: z.string().datetime().optional().nullable().or(z.literal('')),
  notes: z.string().max(4000).optional().nullable(),
  clientId: z.string().uuid().optional().nullable(),
  projectId: z.string().uuid().optional().nullable(),
  retainerId: z.string().uuid().optional().nullable(),
});
export const updatePaymentSchema = createPaymentSchema.partial();

export const createMessageSchema = z.object({
  subject: z.string().max(200).optional().nullable(),
  body: z.string().min(1).max(8000),
  channel: z.enum(['INTERNAL', 'CLIENT']).default('INTERNAL'),
  clientId: z.string().uuid().optional().nullable(),
});
export const updateMessageSchema = z.object({
  isRead: z.boolean().optional(),
  subject: z.string().max(200).optional().nullable(),
  body: z.string().min(1).max(8000).optional(),
});

export const createMeetingSchema = z.object({
  title: z.string().min(1),
  notes: z.string().max(4000).optional().nullable(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime().optional().nullable().or(z.literal('')),
  status: z.enum(['SCHEDULED', 'COMPLETED', 'CANCELLED', 'NO_SHOW']).default('SCHEDULED'),
  location: z.string().max(200).optional().nullable(),
  meetUrl: z.string().url().optional().nullable().or(z.literal('')),
  reminderMin: z.number().int().min(0).max(1440).optional().nullable(),
  clientId: z.string().uuid().optional().nullable(),
  projectId: z.string().uuid().optional().nullable(),
});
export const updateMeetingSchema = createMeetingSchema.partial();

export const createTaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().max(4000).optional().nullable(),
  status: z.enum(['TODO', 'IN_PROGRESS', 'DONE', 'CANCELLED']).default('TODO'),
  dueAt: z.string().datetime().optional().nullable().or(z.literal('')),
  priority: z.number().int().min(1).max(3).default(2),
  clientId: z.string().uuid().optional().nullable(),
  projectId: z.string().uuid().optional().nullable(),
  assigneeId: z.string().uuid().optional().nullable(),
});
export const updateTaskSchema = createTaskSchema.partial();

export const createReviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(2000).optional().nullable(),
  reviewer: z.string().max(120).optional().nullable(),
  clientId: z.string().uuid().optional().nullable(),
});

export function parseBody(schema, body) {
  return schema.parse(body);
}
