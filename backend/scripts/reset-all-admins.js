const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');

async function hashPassword(plain) {
  const salt = crypto.randomBytes(16).toString('hex');
  const cost = 32768;
  const blockSize = 8;
  const parallel = 3;
  const key = await new Promise((resolve, reject) => {
    crypto.scrypt(
      plain,
      Buffer.from(salt, 'hex'),
      64,
      { N: cost, r: blockSize, p: parallel, maxmem: 64 * 1024 * 1024 },
      (err, derived) => (err ? reject(err) : resolve(derived)),
    );
  });
  return `scrypt:${cost}:${blockSize}:${parallel}:${salt}:${key.toString('hex')}`;
}

(async () => {
  const prisma = new PrismaClient();

  // Delete all existing admins
  await prisma.platformAdmin.deleteMany();
  console.log('🗑️ All platform_admin rows removed.');

  // Create a fresh admin
  const newPassword = 'NewStrongPass123!'; // >=12 chars
  const passwordHash = await hashPassword(newPassword);
  const adminEmail = 'admin@example.com';

  await prisma.platformAdmin.create({
    data: {
      email: adminEmail,
      passwordHash,
      status: 'ACTIVE',
      mfaSecretEncrypted: null,
      mfaEnrollmentSecretEncrypted: null,
    },
  });

  console.log(`✅ New admin created (email: ${adminEmail}, password: ${newPassword})`);
  await prisma.$disconnect();
})();
