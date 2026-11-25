const { PrismaClient } = require('@prisma/client');
const { hashPassword } = require('../src/common/utils/password.util');

(async () => {
  const prisma = new PrismaClient();
  const newPassword = 'NewStrongPass123!';
  const passwordHash = await hashPassword(newPassword);
  await prisma.platformAdmin.update({
    where: { email: 'israrali78906@gmail.com' },
    data: { passwordHash },
  });
  console.log('Password updated. Hash:', passwordHash);
  await prisma.$disconnect();
})();
