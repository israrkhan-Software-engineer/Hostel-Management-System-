import { createHash } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { PrismaClient } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PaymentProofStorageService } from '../src/common/storage/payment-proof-storage.service';

async function main() {
  const migrationUrl = process.env.DATABASE_MIGRATION_URL;
  if (!migrationUrl) throw new Error('DATABASE_MIGRATION_URL is required for payment proof migration');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const storage = app.get(PaymentProofStorageService);
  const prisma = new PrismaClient({ datasources: { db: { url: migrationUrl } } });
  let migrated = 0;
  try {
    await prisma.$connect();
    const [role] = await prisma.$queryRaw<Array<{ rolsuper: boolean; rolbypassrls: boolean }>>`
      SELECT rolsuper, rolbypassrls
      FROM pg_roles
      WHERE rolname = current_user
    `;
    if (!role || (!role.rolsuper && !role.rolbypassrls)) {
      throw new Error('DATABASE_MIGRATION_URL must use a migration-only role with PostgreSQL RLS bypass for the backfill');
    }
    const fetchBatch = () => prisma.payment.findMany({
        where: { proofData: { not: null }, proofStorageKey: null },
        select: {
          id: true,
          tenantId: true,
          proofData: true,
          proofFileName: true,
          proofMimeType: true,
        },
        orderBy: [{ tenantId: 'asc' }, { id: 'asc' }],
        take: 50,
      });
    let batch = await fetchBatch();
    while (batch.length > 0) {

      for (const payment of batch) {
        if (!payment.proofData || !payment.proofFileName || !payment.proofMimeType) {
          throw new Error(`Payment ${payment.id} has incomplete proof data; migration stopped without clearing it`);
        }
        const proofData = Buffer.from(payment.proofData);
        const proofSha256 = createHash('sha256').update(proofData).digest('hex');
        const proofStorageKey = `payment-proofs/${payment.tenantId}/${payment.id}`;
        await storage.put(proofStorageKey, proofData, payment.proofMimeType, proofSha256);
        const storedProof = await storage.get(proofStorageKey);
        if (createHash('sha256').update(storedProof).digest('hex') !== proofSha256) {
          throw new Error(`Payment ${payment.id} failed object-storage checksum verification; database bytes remain intact`);
        }

        const updated = await prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT set_config('hms.current_tenant_id', ${payment.tenantId}, TRUE)`;
          return tx.payment.updateMany({
            where: {
              id: payment.id,
              tenantId: payment.tenantId,
              proofData: { not: null },
              proofStorageKey: null,
            },
            data: { proofStorageKey, proofSha256, proofData: null },
          });
        });
        if (updated.count !== 1) {
          throw new Error(`Payment ${payment.id} changed during migration; its original database bytes remain intact`);
        }
        migrated += 1;
      }
      batch = await fetchBatch();
    }
    console.log(`Migrated ${migrated} payment proof file(s) to private object storage.`);
  } finally {
    await prisma.$disconnect();
    await app.close();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(`Payment proof migration failed: ${message}`);
  process.exitCode = 1;
});
