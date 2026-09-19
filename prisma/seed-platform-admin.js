import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

try {
  const email = (process.env.SEED_ADMIN_EMAIL || 'admin@skill99.com').toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD || 'change-this-admin-password';
  const passwordHash = await bcrypt.hash(password, 12);

  const admin = await prisma.crmUser.upsert({
    where: { email },
    update: {
      name: 'Skill99 Platform Admin',
      password: passwordHash,
      role: 'PLATFORM_ADMIN',
      companyId: null,
      teamId: null,
      isActive: true,
      isVerified: true,
      verifiedAt: new Date(),
      passwordSetAt: new Date(),
    },
    create: {
      email,
      password: passwordHash,
      name: 'Skill99 Platform Admin',
      role: 'PLATFORM_ADMIN',
      isActive: true,
      isVerified: true,
      verifiedAt: new Date(),
      passwordSetAt: new Date(),
    },
    select: { email: true, role: true },
  });

  console.log(`Platform admin ready: ${admin.email} (${admin.role})`);
} finally {
  await prisma.$disconnect();
}
