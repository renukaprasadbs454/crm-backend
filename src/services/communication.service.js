import prisma from '../utils/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { env } from '../config/env.js';
import { sendEmail } from './email.service.js';
import { sendWhatsAppTemplate } from './whatsapp.service.js';

async function logAndSend({ companyId, leadId, senderId, provider, recipient, subject, template, sendFn }) {
  const log = await prisma.communicationLog.create({
    data: { companyId: companyId ?? null, leadId: leadId ?? null, senderId: senderId ?? null, provider, recipient, subject: subject ?? null, template: template ?? null },
  });
  try {
    const result = await sendFn();
    await prisma.communicationLog.update({
      where: { id: log.id },
      data: { status: 'SENT', sentAt: new Date(), messageId: result?.id ?? result?.messages?.[0]?.id ?? null, metadata: result ?? undefined },
    });
    return { ...log, status: 'SENT', result };
  } catch (error) {
    await prisma.communicationLog.update({ where: { id: log.id }, data: { status: 'FAILED', error: error.message } });
    throw error;
  }
}

export async function sendLeadWelcome({ lead, companyId, senderId = null }) {
  const subject = `Thanks for contacting Skill99${lead.fullName ? `, ${lead.fullName}` : ''}`;
  const body = `Hi ${lead.fullName || 'there'},\n\nThanks for reaching out to Skill99. Our team will contact you shortly.`;
  const tasks = [];

  if (env.automationLeadAckEmail && lead.email) {
    tasks.push(logAndSend({
      companyId,
      leadId: lead.id,
      senderId,
      provider: 'EMAIL',
      recipient: lead.email,
      subject,
      template: 'lead_welcome',
      sendFn: () => sendEmail({ to: lead.email, subject, text: body, html: `<p>Hi ${lead.fullName || 'there'},</p><p>Thanks for reaching out to Skill99. Our team will contact you shortly.</p>` }),
    }));
  }

  if (env.automationLeadAckWhatsapp && lead.phone) {
    tasks.push(logAndSend({
      companyId,
      leadId: lead.id,
      senderId,
      provider: 'WHATSAPP',
      recipient: lead.phone,
      template: env.whatsappLeadWelcomeTemplate,
      sendFn: () => sendWhatsAppTemplate(lead.phone, env.whatsappLeadWelcomeTemplate, [lead.fullName || 'there']),
    }));
  }

  if (!tasks.length) return [];
  return Promise.allSettled(tasks);
}

export async function sendStageChange({ lead, stage, companyId, senderId = null }) {
  const tasks = [];
  if (env.automationStageEmail && lead.email) {
    const subject = `Your Skill99 enquiry is now ${stage.replaceAll('_', ' ')}`;
    tasks.push(logAndSend({
      companyId, leadId: lead.id, senderId, provider: 'EMAIL', recipient: lead.email,
      subject, template: 'lead_stage_update',
      sendFn: () => sendEmail({ to: lead.email, subject, text: `Hi ${lead.fullName || 'there'}, your Skill99 enquiry has moved to ${stage.replaceAll('_', ' ')}.` }),
    }));
  }
  if (env.automationStageWhatsapp && lead.phone) {
    tasks.push(logAndSend({
      companyId, leadId: lead.id, senderId, provider: 'WHATSAPP', recipient: lead.phone,
      template: env.whatsappStageTemplate,
      sendFn: () => sendWhatsAppTemplate(lead.phone, env.whatsappStageTemplate, [lead.fullName || 'there', stage.replaceAll('_', ' ')]),
    }));
  }
  if (!tasks.length) return [];
  return Promise.allSettled(tasks);
}

export async function sendInterestChange({ lead, interest, companyId, senderId = null }) {
  const label = interest.replaceAll('_', ' ').toLowerCase();
  const subject = `Update on your Skill99 enquiry: ${label}`;
  const body = interest === 'INTERESTED'
    ? `Hi ${lead.fullName || 'there'},\n\nThanks for your interest in Skill99. Our team will contact you shortly to help you take the next step.`
    : interest === 'ON_HOLD'
      ? `Hi ${lead.fullName || 'there'},\n\nWe have kept your Skill99 enquiry on hold. Reply whenever you are ready and our team will help you.`
      : `Hi ${lead.fullName || 'there'},\n\nWe have updated your Skill99 enquiry as not interested. You are welcome to contact us again whenever your plans change.`;
  const tasks = [];

  if (env.automationInterestEmail && lead.email) {
    tasks.push(logAndSend({ companyId, leadId: lead.id, senderId, provider: 'EMAIL', recipient: lead.email, subject, template: 'lead_interest_update', sendFn: () => sendEmail({ to: lead.email, subject, text: body }) }));
  }
  if (env.automationInterestWhatsapp && lead.phone) {
    tasks.push(logAndSend({ companyId, leadId: lead.id, senderId, provider: 'WHATSAPP', recipient: lead.phone, template: env.whatsappInterestTemplate, sendFn: () => sendWhatsAppTemplate(lead.phone, env.whatsappInterestTemplate, [lead.fullName || 'there', label]) }));
  }
  return tasks.length ? Promise.allSettled(tasks) : [];
}

export async function sendLeadConversion({ lead, companyId, senderId = null }) {
  const subject = 'Your Skill99 enquiry has been converted';
  const body = `Hi ${lead.fullName || 'there'},\n\nYour Skill99 enquiry is now with our client success team. We will contact you shortly with the next steps.`;
  const tasks = [];
  if (env.automationStageEmail && lead.email) {
    tasks.push(logAndSend({ companyId, leadId: lead.id, senderId, provider: 'EMAIL', recipient: lead.email, subject, template: 'lead_converted', sendFn: () => sendEmail({ to: lead.email, subject, text: body }) }));
  }
  if (env.automationStageWhatsapp && lead.phone) {
    tasks.push(logAndSend({ companyId, leadId: lead.id, senderId, provider: 'WHATSAPP', recipient: lead.phone, template: env.whatsappStageTemplate, sendFn: () => sendWhatsAppTemplate(lead.phone, env.whatsappStageTemplate, [lead.fullName || 'there', 'converted to client']) }));
  }
  return tasks.length ? Promise.allSettled(tasks) : [];
}
