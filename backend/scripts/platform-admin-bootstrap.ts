import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/common/utils/password.util';

const databaseUrl = process.env.DATABASE_MIGRATION_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_MIGRATION_URL is required.');
}
if (!process.stdin.isTTY || !process.stdout.isTTY) {
  throw new Error('Run this command directly in a terminal; secret prompts require an interactive TTY.');
}

const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

async function readSecret(prompt: string, hidden = true): Promise<string> {
  const input = process.stdin;
  process.stdout.write(prompt);
  input.setRawMode(true);
  input.resume();
  return new Promise((resolve, reject) => {
    let value = '';
    const cleanup = () => {
      input.setRawMode(false);
      input.pause();
      input.removeListener('data', onData);
      process.stdout.write('\n');
    };
    const onData = (chunk: Buffer) => {
      for (const character of chunk.toString('utf8')) {
        if (character === '\u0003') {
          cleanup();
          reject(new Error('Bootstrap cancelled.'));
          return;
        }
        if (character === '\r' || character === '\n') {
          cleanup();
          resolve(value);
          return;
        }
        if (character === '\u007f' || character === '\b') {
          value = value.slice(0, -1);
          if (!hidden) process.stdout.write('\b \b');
        } else if (character >= ' ') {
          value += character;
          if (!hidden) process.stdout.write(character);
        }
      }
    };
    input.on('data', onData);
  });
}

async function main() {
  await prisma.$connect();
  const [role] = await prisma.$queryRaw<Array<{ rolsuper: boolean; rolbypassrls: boolean }>>`
    SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user
  `;
  if (!role || (!role.rolsuper && !role.rolbypassrls)) {
    throw new Error('Bootstrap requires the elevated migration database role; runtime credentials are not accepted.');
  }
  if (await prisma.platformAdmin.count() > 0) {
    throw new Error('A platform administrator already exists; one-time bootstrap is disabled.');
  }

  const email = (await readSecret('Platform admin email: ')).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw new Error('Enter a valid email address (maximum 254 characters).');
  }
  const password = await readSecret('Password (minimum 12 characters): ');
  const confirmation = await readSecret('Confirm password: ');
  if (password.length < 12 || password.length > 128 || password !== confirmation) {
    throw new Error('Passwords must match and be 12-128 characters long.');
  }

  const admin = await prisma.platformAdmin.create({
    data: {
      email,
      passwordHash: await hashPassword(password),
      mfaSecretEncrypted: null,
    },
  });
  await prisma.platformAdminAuditLog.create({
    data: { platformAdminId: admin.id, action: 'platform.auth.bootstrap', metadata: {} },
  });
  process.stdout.write(`\nCreated platform administrator ${email}.\n`);
  process.stdout.write(
    'At first sign-in, scan the authenticator QR code to finish setup. Authenticator codes will be required on later sign-ins.\n',
  );
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());