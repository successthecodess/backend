import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Add admin email
  await prisma.adminEmail.upsert({
    where: { email: 'daniel@enginearu.com' },
    update: { isActive: true },
    create: {
      email: 'daniel@enginearu.com',
      addedBy: 'system',
      isActive: true,
    },
  });

  console.log('✅ Admin email added: daniel@enginearu.com');
}

main()
  .catch((e) => {
    console.error(e);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });