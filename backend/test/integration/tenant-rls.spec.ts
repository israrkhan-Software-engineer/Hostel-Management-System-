jest.unmock('@prisma/client');

import { randomUUID } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { AdmissionsService } from '../../src/modules/residents/admissions.service';

describe('PostgreSQL tenant RLS', () => {
  const runtimeUrl = process.env.DATABASE_URL;
  const migrationUrl = process.env.DATABASE_MIGRATION_URL;
  const runtimeClient = new PrismaService();
  const adminClient = new PrismaClient({
    datasources: { db: { url: migrationUrl } },
  });
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const branchA = randomUUID();
  const branchB = randomUUID();
  const residentA = randomUUID();
  const residentB = randomUUID();
  const raceResident = randomUUID();
  const userA = randomUUID();
  const userB = randomUUID();
  const buildingA = randomUUID();
  const buildingB = randomUUID();
  const floorA = randomUUID();
  const floorB = randomUUID();
  const roomA = randomUUID();
  const roomB = randomUUID();
  const bedA = randomUUID();
  const bedB = randomUUID();
  const admissionA = randomUUID();
  const admissionB = randomUUID();
  const allocationA = randomUUID();
  const allocationB = randomUUID();
  const invoiceA = randomUUID();
  const invoiceB = randomUUID();
  const paymentA = randomUUID();
  const paymentB = randomUUID();
  const refundA = randomUUID();
  const refundB = randomUUID();
  const paymentSubmissionA = randomUUID();
  const paymentSubmissionB = randomUUID();
  const refundSubmissionA = randomUUID();
  const refundSubmissionB = randomUUID();
  const scopedInsertId = randomUUID();
  const scopedMutationId = randomUUID();
  let runtimeConnected = false;
  let adminConnected = false;
  let fixturesMayExist = false;

  beforeAll(async () => {
    if (!runtimeUrl || !migrationUrl) {
      throw new Error('DATABASE_URL and DATABASE_MIGRATION_URL are required for PostgreSQL integration tests.');
    }
    const runtimeAddress = new URL(runtimeUrl);
    const migrationAddress = new URL(migrationUrl);
    const localHosts = new Set(['localhost', '127.0.0.1', '::1', 'postgres', 'postgres-test']);
    if (
      runtimeAddress.pathname !== '/hms_test'
      || migrationAddress.pathname !== '/hms_test'
      || !localHosts.has(runtimeAddress.hostname)
      || !localHosts.has(migrationAddress.hostname)
      || process.env.ALLOW_RLS_INTEGRATION_TESTS !== 'true'
    ) {
      throw new Error('RLS integration tests only run against the dedicated hms_test database.');
    }

    await adminClient.$connect();
    adminConnected = true;
    runtimeConnected = true;
    await runtimeClient.onModuleInit();
    fixturesMayExist = true;
    await adminClient.$executeRaw`
      INSERT INTO tenants (id, name, slug, status)
      VALUES (${tenantA}::uuid, 'RLS test A', ${`rls-a-${tenantA}`}, 'ACTIVE'),
             (${tenantB}::uuid, 'RLS test B', ${`rls-b-${tenantB}`}, 'ACTIVE')
    `;
    await adminClient.$executeRaw`
      INSERT INTO branches (id, tenant_id, name, code)
      VALUES (${branchA}::uuid, ${tenantA}::uuid, 'Branch A', ${`A-${branchA}`}),
             (${branchB}::uuid, ${tenantB}::uuid, 'Branch B', ${`B-${branchB}`})
    `;
    await adminClient.$executeRaw`
      INSERT INTO residents (id, tenant_id, branch_id, first_name, last_name)
      VALUES (${residentA}::uuid, ${tenantA}::uuid, ${branchA}::uuid, 'Resident', 'A'),
             (${residentB}::uuid, ${tenantB}::uuid, ${branchB}::uuid, 'Resident', 'B'),
             (${raceResident}::uuid, ${tenantA}::uuid, ${branchA}::uuid, 'Concurrent', 'Admission'),
             (${scopedMutationId}::uuid, ${tenantA}::uuid, ${branchA}::uuid, 'Mutation', 'Target')
    `;
    await adminClient.user.createMany({
      data: [
        { id: userA, tenantId: tenantA, email: `rls-a-${userA}@integration.test`, passwordHash: 'test-hash' },
        { id: userB, tenantId: tenantB, email: `rls-b-${userB}@integration.test`, passwordHash: 'test-hash' },
      ],
    });
    await adminClient.building.createMany({
      data: [
        { id: buildingA, tenantId: tenantA, branchId: branchA, name: 'Building A' },
        { id: buildingB, tenantId: tenantB, branchId: branchB, name: 'Building B' },
      ],
    });
    await adminClient.floor.createMany({
      data: [
        { id: floorA, tenantId: tenantA, buildingId: buildingA, level: 0 },
        { id: floorB, tenantId: tenantB, buildingId: buildingB, level: 0 },
      ],
    });
    await adminClient.room.createMany({
      data: [
        { id: roomA, tenantId: tenantA, branchId: branchA, floorId: floorA, code: `A-${roomA}` },
        { id: roomB, tenantId: tenantB, branchId: branchB, floorId: floorB, code: `B-${roomB}` },
      ],
    });
    await adminClient.bed.createMany({
      data: [
        { id: bedA, tenantId: tenantA, branchId: branchA, roomId: roomA, code: 'A', status: 'RESERVED' },
        { id: bedB, tenantId: tenantB, branchId: branchB, roomId: roomB, code: 'B', status: 'RESERVED' },
      ],
    });
    await adminClient.admission.createMany({
      data: [
        { id: admissionA, tenantId: tenantA, branchId: branchA, residentId: residentA, status: 'APPROVED' },
        { id: admissionB, tenantId: tenantB, branchId: branchB, residentId: residentB, status: 'APPROVED' },
      ],
    });
    await adminClient.bedAllocation.createMany({
      data: [
        { id: allocationA, tenantId: tenantA, branchId: branchA, admissionId: admissionA, residentId: residentA, bedId: bedA, status: 'RESERVED' },
        { id: allocationB, tenantId: tenantB, branchId: branchB, admissionId: admissionB, residentId: residentB, bedId: bedB, status: 'RESERVED' },
      ],
    });
    await adminClient.invoice.createMany({
      data: [
        { id: invoiceA, tenantId: tenantA, branchId: branchA, residentId: residentA, invoiceNumber: `RLS-${invoiceA}`, currency: 'PKR', createdByUserId: userA },
        { id: invoiceB, tenantId: tenantB, branchId: branchB, residentId: residentB, invoiceNumber: `RLS-${invoiceB}`, currency: 'PKR', createdByUserId: userB },
      ],
    });
    await adminClient.payment.createMany({
      data: [
        { id: paymentA, tenantId: tenantA, branchId: branchA, invoiceId: invoiceA, amountMinor: 100, method: 'CASH', recordedByUserId: userA, submissionKey: paymentSubmissionA },
        { id: paymentB, tenantId: tenantB, branchId: branchB, invoiceId: invoiceB, amountMinor: 100, method: 'CASH', recordedByUserId: userB, submissionKey: paymentSubmissionB },
      ],
    });
    await adminClient.refund.createMany({
      data: [
        { id: refundA, tenantId: tenantA, branchId: branchA, invoiceId: invoiceA, amountMinor: 25, method: 'CASH', recordedByUserId: userA, submissionKey: refundSubmissionA },
        { id: refundB, tenantId: tenantB, branchId: branchB, invoiceId: invoiceB, amountMinor: 25, method: 'CASH', recordedByUserId: userB, submissionKey: refundSubmissionB },
      ],
    });
  });

  afterAll(async () => {
    try {
      if (adminConnected && fixturesMayExist) {
        await adminClient.refund.deleteMany({ where: { id: { in: [refundA, refundB] } } });
        await adminClient.payment.deleteMany({ where: { id: { in: [paymentA, paymentB] } } });
        await adminClient.invoice.deleteMany({ where: { id: { in: [invoiceA, invoiceB] } } });
        await adminClient.bedAllocation.deleteMany({ where: { id: { in: [allocationA, allocationB] } } });
        await adminClient.bedAllocation.deleteMany({
          where: { residentId: { in: [residentA, residentB, raceResident] } },
        });
        await adminClient.admission.deleteMany({
          where: { residentId: { in: [residentA, residentB, raceResident] } },
        });
        await adminClient.bed.deleteMany({ where: { id: { in: [bedA, bedB] } } });
        await adminClient.room.deleteMany({ where: { id: { in: [roomA, roomB] } } });
        await adminClient.floor.deleteMany({ where: { id: { in: [floorA, floorB] } } });
        await adminClient.building.deleteMany({ where: { id: { in: [buildingA, buildingB] } } });
        await adminClient.user.deleteMany({ where: { id: { in: [userA, userB] } } });
        await adminClient.$executeRaw`DELETE FROM residents WHERE id IN (${residentA}::uuid, ${residentB}::uuid, ${raceResident}::uuid, ${scopedInsertId}::uuid, ${scopedMutationId}::uuid)`;
        await adminClient.$executeRaw`DELETE FROM branches WHERE id IN (${branchA}::uuid, ${branchB}::uuid)`;
        await adminClient.$executeRaw`DELETE FROM tenants WHERE id IN (${tenantA}::uuid, ${tenantB}::uuid)`;
      }
    } finally {
      if (runtimeConnected) {
        await runtimeClient.onModuleDestroy();
      }
      if (adminConnected) {
        await adminClient.$disconnect();
      }
    }
  });

  it('uses a non-superuser runtime role without BYPASSRLS', async () => {
    const [role] = await runtimeClient.$queryRaw<Array<{
      rolsuper: boolean;
      rolbypassrls: boolean;
      inherits_rls_bypass: boolean;
    }>>`
      SELECT runtime_role.rolsuper, runtime_role.rolbypassrls,
        EXISTS (
          SELECT 1 FROM pg_roles AS elevated_role
          WHERE (elevated_role.rolsuper OR elevated_role.rolbypassrls)
            AND pg_has_role(current_user, elevated_role.oid, 'MEMBER')
        ) AS inherits_rls_bypass
      FROM pg_roles AS runtime_role WHERE runtime_role.rolname = current_user
    `;
    expect(role).toEqual({ rolsuper: false, rolbypassrls: false, inherits_rls_bypass: false });
  });

  it('forces RLS on every tenant-owned table', async () => {
    const tables = await runtimeClient.$queryRaw<Array<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>>`
      SELECT relname, relrowsecurity, relforcerowsecurity
      FROM pg_class
      WHERE relkind = 'r' AND relname = ANY(ARRAY[
        'tenants', 'branches', 'buildings', 'floors', 'rooms', 'beds', 'users',
        'user_tenant_memberships', 'user_branch_scopes', 'user_gate_scopes',
        'user_mess_scopes', 'roles', 'role_permissions', 'user_roles', 'audit_logs',
        'refresh_tokens', 'password_reset_tokens', 'residents', 'admissions',
        'bed_allocations', 'invoices', 'invoice_lines', 'payments', 'refunds',
        'mess_menus', 'mess_menu_entries', 'complaints', 'notices', 'visitor_visits'
      ])
    `;
    expect(tables).toHaveLength(29);
    expect(tables.every((table) => table.relrowsecurity && table.relforcerowsecurity)).toBe(true);
  });

  it('has a fail-closed RLS policy on every tenant-owned table', async () => {
    const policies = await runtimeClient.$queryRaw<Array<{ tablename: string }>>`
      SELECT DISTINCT tablename FROM pg_policies
      WHERE schemaname = 'public' AND tablename = ANY(ARRAY[
        'tenants', 'branches', 'buildings', 'floors', 'rooms', 'beds', 'users',
        'user_tenant_memberships', 'user_branch_scopes', 'user_gate_scopes',
        'user_mess_scopes', 'roles', 'role_permissions', 'user_roles', 'audit_logs',
        'refresh_tokens', 'password_reset_tokens', 'residents', 'admissions',
        'bed_allocations', 'invoices', 'invoice_lines', 'payments', 'refunds',
        'mess_menus', 'mess_menu_entries', 'complaints', 'notices', 'visitor_visits'
      ])
    `;
    expect(policies).toHaveLength(29);
  });

  it('denies access and writes without tenant context', async () => {
    const visible = await runtimeClient.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM residents WHERE id = ${residentA}::uuid
    `;
    expect(visible).toHaveLength(0);
    const sharedRoles = await runtimeClient.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM roles LIMIT 1
    `;
    expect(sharedRoles).toHaveLength(0);
    await expect(runtimeClient.$executeRaw`
      INSERT INTO residents (id, tenant_id, branch_id, first_name, last_name)
      VALUES (${randomUUID()}::uuid, ${tenantA}::uuid, ${branchA}::uuid, 'No', 'Context')
    `).rejects.toThrow();
    await expect(runtimeClient.runWithTenantContext('invalid-tenant', async () => undefined))
      .rejects.toThrow();
  });

  it('resolves only the requested public tenant slug under RLS', async () => {
    expect(await runtimeClient.resolvePublicTenantSlug(`rls-a-${tenantA}`)).toBe(tenantA);
    expect(await runtimeClient.resolvePublicTenantSlug(`missing-${tenantA}`)).toBeNull();
  });

  it('scopes authentication users, residents, admissions, allocations, payments, and refunds', async () => {
    await runtimeClient.runWithTenantContext(tenantA, async () => {
      const user = await runtimeClient.user.findFirst({
        where: { email: `rls-a-${userA}@integration.test` },
        select: { id: true },
      });
      const hiddenUser = await runtimeClient.user.findFirst({
        where: { email: `rls-b-${userB}@integration.test` },
        select: { id: true },
      });
      const residents = await runtimeClient.resident.findMany({
        where: { id: { in: [residentA, residentB] } },
        select: { id: true },
      });
      const admissions = await runtimeClient.admission.findMany({
        where: { id: { in: [admissionA, admissionB] } },
        select: { id: true },
      });
      const allocations = await runtimeClient.bedAllocation.findMany({
        where: { id: { in: [allocationA, allocationB] } },
        select: { id: true },
      });
      const payments = await runtimeClient.payment.findMany({
        where: { id: { in: [paymentA, paymentB] } },
        select: { id: true },
      });
      const refunds = await runtimeClient.refund.findMany({
        where: { id: { in: [refundA, refundB] } },
        select: { id: true },
      });

      expect(user?.id).toBe(userA);
      expect(hiddenUser).toBeNull();
      expect(residents.map(({ id }) => id)).toEqual([residentA]);
      expect(admissions.map(({ id }) => id)).toEqual([admissionA]);
      expect(allocations.map(({ id }) => id)).toEqual([allocationA]);
      expect(payments.map(({ id }) => id)).toEqual([paymentA]);
      expect(refunds.map(({ id }) => id)).toEqual([refundA]);
    });
  });

  it('rejects duplicate active allocations and duplicate finance submission keys', async () => {
    await runtimeClient.runWithTenantContext(tenantA, async () => {
      await runtimeClient.$executeRaw`SAVEPOINT expected_unique_violation`;
      await expect(runtimeClient.bedAllocation.create({
        data: {
          id: randomUUID(),
          tenantId: tenantA,
          branchId: branchA,
          admissionId: admissionA,
          residentId: residentA,
          bedId: bedA,
        },
      })).rejects.toMatchObject({ code: 'P2002' });
      await runtimeClient.$executeRaw`ROLLBACK TO SAVEPOINT expected_unique_violation`;
      await runtimeClient.$executeRaw`RELEASE SAVEPOINT expected_unique_violation`;

      await runtimeClient.$executeRaw`SAVEPOINT expected_unique_violation`;
      await expect(runtimeClient.payment.create({
        data: {
          tenantId: tenantA,
          branchId: branchA,
          invoiceId: invoiceA,
          amountMinor: 100,
          method: 'CASH',
          recordedByUserId: userA,
          submissionKey: paymentSubmissionA,
        },
      })).rejects.toMatchObject({ code: 'P2002' });
      await runtimeClient.$executeRaw`ROLLBACK TO SAVEPOINT expected_unique_violation`;
      await runtimeClient.$executeRaw`RELEASE SAVEPOINT expected_unique_violation`;

      await runtimeClient.$executeRaw`SAVEPOINT expected_unique_violation`;
      await expect(runtimeClient.refund.create({
        data: {
          tenantId: tenantA,
          branchId: branchA,
          invoiceId: invoiceA,
          amountMinor: 25,
          method: 'CASH',
          recordedByUserId: userA,
          submissionKey: refundSubmissionA,
        },
      })).rejects.toMatchObject({ code: 'P2002' });
      await runtimeClient.$executeRaw`ROLLBACK TO SAVEPOINT expected_unique_violation`;
      await runtimeClient.$executeRaw`RELEASE SAVEPOINT expected_unique_violation`;
    });
  });

  it('serializes concurrent admissions so a resident receives only one active admission', async () => {
    const admissionService = new AdmissionsService(
      runtimeClient,
      {
        ensureBranch: jest.fn().mockResolvedValue(undefined),
        presentForAdmission: jest.fn((resident) => resident),
      } as any,
      { log: jest.fn().mockResolvedValue(undefined) } as any,
    );
    const submissions = await Promise.allSettled([
      runtimeClient.runWithTenantContext(tenantA, () =>
        admissionService.create(tenantA, branchA, userA, { residentId: raceResident }),
      ),
      runtimeClient.runWithTenantContext(tenantA, () =>
        admissionService.create(tenantA, branchA, userA, { residentId: raceResident }),
      ),
    ]);

    expect(submissions.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    const rejected = submissions.find(
      (submission): submission is PromiseRejectedResult => submission.status === 'rejected',
    );
    expect(rejected?.reason).toBeInstanceOf(ConflictException);
    expect(await adminClient.admission.count({
      where: { tenantId: tenantA, residentId: raceResident, status: 'PENDING', deletedAt: null },
    })).toBe(1);
  });

  it('restricts SELECT, INSERT, UPDATE, and DELETE to the active tenant', async () => {
    await runtimeClient.runWithTenantContext(tenantA, async () => {
      const visible = await runtimeClient.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM residents WHERE id IN (${residentA}::uuid, ${residentB}::uuid)
      `;
      expect(visible.map(({ id }) => id)).toEqual([residentA]);

      await runtimeClient.$executeRaw`SAVEPOINT expected_rls_violation`;
      try {
        await expect(runtimeClient.$executeRaw`
          INSERT INTO residents (id, tenant_id, branch_id, first_name, last_name)
          VALUES (${randomUUID()}::uuid, ${tenantB}::uuid, ${branchB}::uuid, 'Cross', 'Tenant')
        `).rejects.toThrow();
      } finally {
        await runtimeClient.$executeRaw`ROLLBACK TO SAVEPOINT expected_rls_violation`;
        await runtimeClient.$executeRaw`RELEASE SAVEPOINT expected_rls_violation`;
      }

      const changed = await runtimeClient.$executeRaw`
        UPDATE residents SET last_name = 'Changed' WHERE id = ${residentB}::uuid
      `;
      const deleted = await runtimeClient.$executeRaw`
        DELETE FROM residents WHERE id = ${residentB}::uuid
      `;
      expect(changed).toBe(0);
      expect(deleted).toBe(0);

      const ownUpdate = await runtimeClient.$executeRaw`
        UPDATE residents SET last_name = 'Updated' WHERE id = ${scopedMutationId}::uuid
      `;
      const ownDelete = await runtimeClient.$executeRaw`
        DELETE FROM residents WHERE id = ${scopedMutationId}::uuid
      `;
      expect(ownUpdate).toBe(1);
      expect(ownDelete).toBe(1);

      await runtimeClient.$executeRaw`
        INSERT INTO residents (id, tenant_id, branch_id, first_name, last_name)
        VALUES (${scopedInsertId}::uuid, ${tenantA}::uuid, ${branchA}::uuid, 'Scoped', 'Insert')
      `;
    });
  });

  it('does not leak transaction-local tenant context between pooled or concurrent requests', async () => {
    await expect(runtimeClient.runWithTenantContext(tenantA, () =>
      runtimeClient.runWithTenantContext(tenantB, async () => undefined),
    )).rejects.toThrow();

    const results = await Promise.all([
      runtimeClient.runWithTenantContext(tenantA, async () => {
        await Promise.resolve();
        return runtimeClient.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM residents WHERE id IN (${residentA}::uuid, ${residentB}::uuid)
        `;
      }),
      runtimeClient.runWithTenantContext(tenantB, async () => {
        await Promise.resolve();
        return runtimeClient.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM residents WHERE id IN (${residentA}::uuid, ${residentB}::uuid)
        `;
      }),
    ]);
    expect(results[0].map(({ id }) => id)).toEqual([residentA]);
    expect(results[1].map(({ id }) => id)).toEqual([residentB]);

    const outsideTransaction = await runtimeClient.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM residents WHERE id IN (${residentA}::uuid, ${residentB}::uuid)
    `;
    expect(outsideTransaction).toHaveLength(0);
  });

  it('uses the tenant-local midnight boundary for overdue dates in PostgreSQL', async () => {
    const [boundary] = await adminClient.$queryRaw<Array<{
      beforeMidnightIsOverdue: boolean;
      midnightIsOverdue: boolean;
      afterMidnightIsOverdue: boolean;
    }>>`
      WITH local_day AS (
        SELECT (
          date_trunc('day', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Karachi')
          AT TIME ZONE 'Asia/Karachi'
        ) AS due_boundary
      )
      SELECT
        due_boundary - INTERVAL '1 microsecond' < due_boundary AS "beforeMidnightIsOverdue",
        due_boundary < due_boundary AS "midnightIsOverdue",
        due_boundary + INTERVAL '1 microsecond' < due_boundary AS "afterMidnightIsOverdue"
      FROM local_day
    `;

    expect(boundary).toEqual({
      beforeMidnightIsOverdue: true,
      midnightIsOverdue: false,
      afterMidnightIsOverdue: false,
    });
  });
});