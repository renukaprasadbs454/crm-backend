import { env } from '../config/env.js';
import { AppError } from '../middleware/errorHandler.js';

function normalizePhone(phone) {
  let digits = String(phone || '').replace(/\D/g, '');
  if (!digits) throw new AppError('A WhatsApp phone number is required', 400);
  if (digits.length === 10) digits = `${env.whatsappDefaultCountryCode}${digits}`;
  return `+${digits}`;
}

async function sendMetaTemplate(to, templateName, parameters = [], languageCode = env.whatsappTemplateLanguage) {
  if (!env.whatsappAccessToken || !env.whatsappPhoneNumberId) {
    throw new AppError('WhatsApp is not configured. Set WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID.', 503);
  }
  const url = `https://graph.facebook.com/${env.whatsappApiVersion}/${env.whatsappPhoneNumberId}/messages`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.whatsappAccessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: to.replace('+', ''),
      type: 'template',
      template: {
        name: templateName,
        language: { code: languageCode },
        ...(parameters.length ? { components: [{ type: 'body', parameters: parameters.map((text) => ({ type: 'text', text: String(text) })) }] } : {}),
      },
    }),
  });
  const body = await response.text();
  if (!response.ok) throw new AppError(`WhatsApp delivery failed: ${body.slice(0, 500)}`, 502);
  try { return JSON.parse(body); } catch { return {}; }
}

async function sendTwilioMessage(to, text) {
  if (!env.twilioAccountSid || !env.twilioAuthToken || !env.twilioWhatsAppFrom) {
    throw new AppError('Twilio WhatsApp is not configured.', 503);
  }
  const auth = Buffer.from(`${env.twilioAccountSid}:${env.twilioAuthToken}`).toString('base64');
  const params = new URLSearchParams({
    From: `whatsapp:${env.twilioWhatsAppFrom}`,
    To: `whatsapp:${to}`,
    Body: text,
  });
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.twilioAccountSid}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  const body = await response.text();
  if (!response.ok) throw new AppError(`WhatsApp delivery failed: ${body.slice(0, 500)}`, 502);
  try { return JSON.parse(body); } catch { return {}; }
}

export async function sendOtpWhatsApp(phone, otp) {
  const to = normalizePhone(phone);
  const provider = env.whatsappProvider;
  if (provider === 'meta') return sendMetaTemplate(to, env.whatsappTemplateName, [otp]);
  if (provider === 'twilio') return sendTwilioMessage(to, `Your Skill99 CRM verification code is ${otp}. It expires in ${env.otpExpiryMinutes} minutes. Do not share this code.`);
  if (env.nodeEnv === 'production') throw new AppError('WhatsApp provider is not configured for production.', 503);
  console.log(`[Skill99 CRM] DEV WhatsApp OTP for ${to}: ${otp}`);
  return { id: `dev-wa-${Date.now()}` };
}

export async function sendWhatsAppTemplate(phone, templateName, parameters = []) {
  const to = normalizePhone(phone);
  if (env.whatsappProvider === 'meta') return sendMetaTemplate(to, templateName, parameters);
  if (env.whatsappProvider === 'twilio') return sendTwilioMessage(to, parameters.join(' | ') || 'Skill99 CRM notification');
  if (env.nodeEnv === 'production') throw new AppError('WhatsApp provider is not configured for production.', 503);
  console.log(`[Skill99 CRM] DEV WhatsApp template ${templateName} -> ${to}:`, parameters);
  return { id: `dev-wa-${Date.now()}` };
}
