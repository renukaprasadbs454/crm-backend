import { env } from '../config/env.js';
import { AppError } from '../middleware/errorHandler.js';
import nodemailer from 'nodemailer';

let smtpTransport;

function getSmtpTransport() {
  if (!env.smtpHost || !env.smtpUser || !env.smtpPassword || !env.emailFrom) {
    throw new AppError('SMTP email is not configured. Set SMTP_HOST, SMTP_USER, SMTP_PASSWORD, and EMAIL_FROM.', 503);
  }
  if (!smtpTransport) {
    smtpTransport = nodemailer.createTransport({
      host: env.smtpHost,
      port: env.smtpPort,
      secure: env.smtpSecure,
      auth: { user: env.smtpUser, pass: env.smtpPassword },
    });
  }
  return smtpTransport;
}

export async function sendEmail({ to, subject, html, text }) {
  if (!to) throw new AppError('Email recipient is required', 400);
  const provider = env.emailProvider;

  if (provider === 'smtp') {
    try {
      return await getSmtpTransport().sendMail({ from: env.emailFrom, to, subject, html, text });
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(`SMTP email delivery failed: ${error.message}`, 502);
    }
  }

  if (env.nodeEnv === 'production') {
    throw new AppError('Email provider is not configured for production.', 503);
  }

  console.log(`[Skill99 CRM] DEV email -> ${to} | ${subject}`);
  if (text) console.log(`[Skill99 CRM] DEV email body: ${text}`);
  return { id: `dev-email-${Date.now()}` };
}
