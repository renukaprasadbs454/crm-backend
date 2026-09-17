import crypto from 'node:crypto';
import prisma from '../utils/prisma.js';
import { env } from '../config/env.js';

function signatureOk(req) {
  if (!env.whatsappAppSecret) return env.nodeEnv !== 'production';
  const header = req.headers['x-hub-signature-256'];
  if (!header || !req.rawBody) return false;
  const expected = `sha256=${crypto.createHmac('sha256', env.whatsappAppSecret).update(req.rawBody).digest('hex')}`;
  return crypto.timingSafeEqual(Buffer.from(header), Buffer.from(expected));
}

export function verify(req, res) {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token && token === env.whatsappVerifyToken) return res.status(200).send(challenge);
  return res.sendStatus(403);
}

export async function receive(req, res) {
  if (!signatureOk(req)) return res.sendStatus(401);
  // Respond immediately so Meta does not retry while we process the event.
  res.sendStatus(200);
  const changes = req.body?.entry?.flatMap((entry) => entry.changes || []) || [];
  try {
    for (const change of changes) {
    const value = change.value;
    const messages = value?.messages || [];
    for (const message of messages) {
      const phone = String(message.from || '').replace(/\D/g, '');
      if (!phone) continue;
      const candidates = await prisma.lead.findMany({ where: { phone: { contains: phone.slice(-10) } }, take: 2 });
      const lead = candidates[0];
      if (!lead) continue;
      const text = message.text?.body || message.type || 'WhatsApp message received';
      await prisma.leadActivity.create({
        data: {
          leadId: lead.id,
          type: 'WHATSAPP',
          body: `Incoming WhatsApp: ${text}`,
          metadata: { provider: 'META', messageId: message.id, from: message.from, type: message.type },
        },
      });
    }
    }
  } catch (error) {
    console.error('[Skill99 CRM] WhatsApp webhook processing failed:', error.message);
  }
}
