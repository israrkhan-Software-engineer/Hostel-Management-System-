const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');

async function hashPassword(plain) {
  const salt = crypto.randomBytes(16).toString('hex');
  const cost = 32768;
  const blockSize = 8;
  const parallel = 3;
  const key = await new Promise((resolve, reject) => {
    crypto.scrypt(plain, Buffer.from(salt, 'hex'), 64, { N: cost, r: blockSize, p: parallel, maxmem: 64 * 1024 * 1024 }, (err, derived) => {
      if (err) reject(err);
      else resolve(derived);
    });
  });
  return `scrypt:${cost}:${blockSize}:${parallel}:${salt}:${key.toString('hex')}`;
}

(async () => {
  const prisma = new PrismaClient();
  const newPassword = 'NewStrongPass123!'; // >=12 chars
  const passwordHash = await hashPassword(newPassword);
  await prisma.platformAdmin.update({
    where: { email: 'israrali78906@gmail.com' },
    data: { passwordHash },
  });
  console.log('✅ Password updated. Hash:', passwordHash);
  await prisma.$disconnect();
})();
