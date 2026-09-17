import prisma from '../utils/prisma.js';

const activityInclude = {
  author: { select: { id: true, name: true, email: true, role: true } },
};

/**
 * Records a timeline entry for a lead. Safe to call inside other service
 * methods; `client` lets it participate in a transaction when needed.
 */
export async function logActivity(
  { leadId, authorId = null, type = 'NOTE', body = null, metadata = null },
  client = prisma
) {
  return client.leadActivity.create({
    data: { leadId, authorId, type, body, metadata },
  });
}

export async function listActivities(leadId) {
  return prisma.leadActivity.findMany({
    where: { leadId },
    include: activityInclude,
    orderBy: { createdAt: 'desc' },
  });
}
