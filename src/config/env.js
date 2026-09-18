import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env') });

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT) || 4001,
  databaseUrl: process.env.DATABASE_URL || '',
  directUrl: process.env.DIRECT_URL || '',
  jwtSecret: process.env.JWT_SECRET || 'dev-only-change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5174',
  publicLeadCompanyId: process.env.PUBLIC_LEAD_COMPANY_ID || '',
  whatsappProvider: (process.env.WHATSAPP_PROVIDER || 'console').toLowerCase(),
  whatsappAccessToken: process.env.WHATSAPP_ACCESS_TOKEN || '',
  whatsappPhoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
  whatsappApiVersion: process.env.WHATSAPP_API_VERSION || 'v23.0',
  whatsappTemplateName: process.env.WHATSAPP_TEMPLATE_NAME || 'skill99_crm_otp',
  whatsappTemplateLanguage: process.env.WHATSAPP_TEMPLATE_LANGUAGE || 'en_US',
  twilioAccountSid: process.env.TWILIO_ACCOUNT_SID || '',
  twilioAuthToken: process.env.TWILIO_AUTH_TOKEN || '',
  twilioWhatsAppFrom: process.env.TWILIO_WHATSAPP_FROM || '',
  otpExpiryMinutes: Number(process.env.OTP_EXPIRY_MINUTES) || 10,
  otpMaxAttempts: Number(process.env.OTP_MAX_ATTEMPTS) || 5,
  whatsappDefaultCountryCode: String(process.env.WHATSAPP_DEFAULT_COUNTRY_CODE || '91').replace(/\D/g, ''),
  whatsappLeadWelcomeTemplate: process.env.WHATSAPP_LEAD_WELCOME_TEMPLATE || 'skill99_lead_welcome',
  whatsappStageTemplate: process.env.WHATSAPP_STAGE_TEMPLATE || 'skill99_lead_stage',
  whatsappInterestTemplate: process.env.WHATSAPP_INTEREST_TEMPLATE || 'skill99_lead_stage',
  whatsappVerifyToken: process.env.WHATSAPP_VERIFY_TOKEN || '',
  whatsappAppSecret: process.env.WHATSAPP_APP_SECRET || '',
  emailProvider: (process.env.EMAIL_PROVIDER || 'console').toLowerCase(),
  emailFrom: process.env.EMAIL_FROM || '',
  smtpHost: process.env.SMTP_HOST || '',
  smtpPort: Number(process.env.SMTP_PORT) || 587,
  smtpSecure: String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true',
  smtpUser: process.env.SMTP_USER || '',
  smtpPassword: process.env.SMTP_PASSWORD || '',
  razorpayKeyId: process.env.RAZORPAY_KEY_ID || '',
  razorpayKeySecret: process.env.RAZORPAY_KEY_SECRET || '',
  automationLeadAckEmail: String(process.env.AUTOMATION_LEAD_ACK_EMAIL || 'true').toLowerCase() === 'true',
  automationLeadAckWhatsapp: String(process.env.AUTOMATION_LEAD_ACK_WHATSAPP || 'true').toLowerCase() === 'true',
  automationStageEmail: String(process.env.AUTOMATION_STAGE_EMAIL || 'true').toLowerCase() === 'true',
  automationStageWhatsapp: String(process.env.AUTOMATION_STAGE_WHATSAPP || 'true').toLowerCase() === 'true',
  automationInterestEmail: String(process.env.AUTOMATION_INTEREST_EMAIL || 'true').toLowerCase() === 'true',
  automationInterestWhatsapp: String(process.env.AUTOMATION_INTEREST_WHATSAPP || 'true').toLowerCase() === 'true',
  storageProvider: (process.env.STORAGE_PROVIDER || 'local').toLowerCase(),
  recordingsDir: process.env.RECORDINGS_DIR || './uploads',
  r2AccountId: process.env.R2_ACCOUNT_ID || '',
  r2AccessKeyId: process.env.R2_ACCESS_KEY_ID || '',
  r2SecretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
  r2Bucket: process.env.R2_BUCKET || '',
  r2PublicUrl: (process.env.R2_PUBLIC_URL || '').replace(/\/$/, ''),
};

export const corsOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5174')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

export function assertProdSecrets() {
  if (env.nodeEnv === 'production') {
    required('DATABASE_URL');
    required('JWT_SECRET');
    if (!env.directUrl) required('DIRECT_URL');
    if (env.storageProvider === 'r2') {
      ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'].forEach(required);
    }
  }
}
