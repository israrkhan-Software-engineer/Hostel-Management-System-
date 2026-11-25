import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/common/utils/password.util';

async function main() {
  const prisma = new PrismaClient();
  const newPassword = 'NewStrongPass123!'; // >=12 chars
  const passwordHash = await hashPassword(newPassword);
  await prisma.platformAdmin.update({
    where: { email: 'israrali78906@gmail.com' },
    data: { passwordHash },
  });
  console.log('Password updated. Hash:', passwordHash);
  await prisma.$disconnect();
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
