/**
 * HMS Seed Script — Phase 1
 * Creates demo accounts for EVERY role across 2 tenants and 2 branches each.
 * Required: TESTING §4.2, IMPL Phase 1 exit criterion.
 * WARNING: Demo passwords are intentionally simple — NEVER run in production.
 */
import {
  PrismaClient,
  TenantStatus,
  UserStatus,
  BranchStatus,
  BedStatus,
  AdmissionStatus,
  AllocationStatus,
  PaymentStatus,
  PaymentMethod,
  ComplaintStatus,
  ComplaintPriority,
  NoticeStatus,
  MessMealType,
  VisitorVisitStatus,
  type Admission,
  type Bed,
  type Resident,
  type Room,
} from '@prisma/client';
import { hashPassword } from '../src/common/utils/password.util';
import { randomUUID } from 'crypto';

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL } },
});

const MODULES = [
  'tenants', 'branches', 'residents', 'admissions', 'allocations',
  'invoices', 'payments', 'payment_proofs', 'visitors', 'gate_passes',
  'gate_events', 'mess', 'complaints', 'maintenance', 'inventory',
  'notifications', 'notices', 'reports', 'exports', 'audit_logs', 'users',
  'roles', 'public_content', 'offline_sync', 'backups', 'attendance',
  'leave_requests', 'meal_attendance', 'meal_subscriptions', 'student_documents',
];

const ACTIONS = [
  'view', 'create', 'edit', 'delete', 'approve',
  'export', 'print', 'assign', 'verify', 'manage_settings',
] as const;

type Action = typeof ACTIONS[number];

const ROLE_PERMISSIONS: Record<string, Array<{ module: string; actions: Action[] }>> = {
  'System Admin': MODULES.map((m) => ({ module: m, actions: [...ACTIONS] })),
  'Owner': MODULES.map((m) => ({ module: m, actions: [...ACTIONS] })),
  'Warden': [
    { module: 'residents',     actions: ['view', 'edit'] },
    { module: 'admissions',    actions: ['view', 'create', 'edit', 'approve'] },
    { module: 'allocations',   actions: ['view', 'create', 'edit', 'assign'] },
    { module: 'complaints',    actions: ['view', 'edit', 'assign'] },
    { module: 'notices',       actions: ['view', 'create', 'edit'] },
    { module: 'mess',          actions: ['view'] },
    { module: 'visitors',      actions: ['view', 'create', 'approve'] },
    { module: 'gate_passes',   actions: ['view', 'approve'] },
    { module: 'attendance',    actions: ['view', 'create', 'edit'] },
    { module: 'leave_requests', actions: ['view', 'approve'] },
    { module: 'meal_attendance', actions: ['view'] },
    { module: 'meal_subscriptions', actions: ['view', 'create', 'edit', 'manage_settings'] },
    { module: 'student_documents', actions: ['view', 'create', 'edit', 'delete'] },
    { module: 'allocations', actions: ['view', 'assign'] },
    { module: 'exports', actions: ['export'] },
    { module: 'reports',       actions: ['view'] },
  ],
  'Receptionist': [
    { module: 'residents',     actions: ['view', 'create'] },
    { module: 'admissions',    actions: ['view', 'create'] },
    { module: 'allocations',   actions: ['view', 'assign'] },
    { module: 'complaints',    actions: ['view', 'create'] },
    { module: 'notices',       actions: ['view'] },
    { module: 'mess',          actions: ['view'] },
    { module: 'attendance',    actions: ['view'] },
    { module: 'leave_requests', actions: ['view'] },
    { module: 'meal_attendance', actions: ['view'] },
    { module: 'student_documents', actions: ['view'] },
  ],
  'Accountant': [
    { module: 'residents',     actions: ['view'] },
    { module: 'invoices',      actions: ['view', 'create', 'edit', 'assign', 'approve', 'manage_settings'] },
    { module: 'payments',      actions: ['view', 'create', 'verify', 'approve'] },
    { module: 'payment_proofs',actions: ['view', 'verify'] },
    { module: 'reports',       actions: ['view', 'export'] },
    { module: 'exports',       actions: ['export'] },
    { module: 'mess',          actions: ['view'] },
    { module: 'notices',       actions: ['view'] },
  ],
  'Security': [
    { module: 'visitors',      actions: ['view', 'create', 'edit'] },
    { module: 'gate_passes',   actions: ['view', 'verify'] },
    { module: 'gate_events',   actions: ['view', 'create'] },
    { module: 'residents',     actions: ['view'] },
    { module: 'mess',          actions: ['view'] },
    { module: 'notices',       actions: ['view'] },
  ],
  'Mess Staff': [
    { module: 'mess',          actions: ['view', 'create', 'edit'] },
    { module: 'meal_attendance', actions: ['view', 'create', 'edit'] },
    { module: 'meal_subscriptions', actions: ['view', 'create', 'edit', 'manage_settings'] },
    { module: 'residents',     actions: ['view'] },
    { module: 'complaints',    actions: ['view', 'create'] },
  ],
  'Maintenance Staff': [
    { module: 'maintenance',   actions: ['view', 'create', 'edit'] },
    { module: 'inventory',     actions: ['view', 'create', 'edit', 'assign'] },
    { module: 'complaints',    actions: ['view', 'edit', 'assign'] },
    { module: 'mess',          actions: ['view'] },
    { module: 'notices',       actions: ['view'] },
  ],
  'Resident': [
    { module: 'residents',     actions: ['view'] },
    { module: 'invoices',      actions: ['view'] },
    { module: 'payments',      actions: ['view', 'create'] },
    { module: 'payment_proofs',actions: ['view', 'create'] },
    { module: 'complaints',    actions: ['view', 'create'] },
    { module: 'gate_passes',   actions: ['view', 'create'] },
    { module: 'attendance',    actions: ['view'] },
    { module: 'leave_requests', actions: ['view', 'create'] },
    { module: 'meal_attendance', actions: ['view'] },
    { module: 'meal_subscriptions', actions: ['view'] },
    { module: 'student_documents', actions: ['view', 'create'] },
    { module: 'mess',          actions: ['view'] },
    { module: 'notices',       actions: ['view'] },
    { module: 'notifications', actions: ['view'] },
  ],
};

for (const [roleName, permissions] of Object.entries(ROLE_PERMISSIONS)) {
  if (roleName !== 'System Admin' && roleName !== 'Owner') {
    permissions.push(
      { module: 'branches', actions: ['view'] },
      { module: 'users', actions: ['view'] },
      { module: 'offline_sync', actions: ['view'] },
      { module: 'notifications', actions: ['view'] },
    );
  }
}

async function ensurePermissions() {
  for (const module of MODULES) {
    for (const action of ACTIONS) {
      await prisma.permission.upsert({
        where: { module_action: { module, action } },
        update: {},
        create: { module, action },
      });
    }
  }
  console.log('  ✓ Permissions seeded');
}

async function ensureTenantSystemRole(tenantId: string, roleName: string) {
  const matchingRoles = await prisma.role.findMany({
    where: { tenantId, name: roleName, isSystemRole: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    include: {
      permissions: { select: { permissionId: true } },
      userRoles: { select: { userId: true, tenantId: true } },
    },
  });
  const [canonicalRole, ...duplicateRoles] = matchingRoles;
  if (!canonicalRole) {
    return prisma.role.create({
      data: { tenantId, name: roleName, isSystemRole: true },
    });
  }

  for (const duplicateRole of duplicateRoles) {
    await prisma.$transaction(async (tx) => {
      await tx.rolePermission.createMany({
        data: duplicateRole.permissions.map(({ permissionId }) => ({
          roleId: canonicalRole.id,
          permissionId,
        })),
        skipDuplicates: true,
      });
      await tx.userRole.createMany({
        data: duplicateRole.userRoles.map(({ userId, tenantId: assignmentTenantId }) => ({
          userId,
          tenantId: assignmentTenantId,
          roleId: canonicalRole.id,
        })),
        skipDuplicates: true,
      });
      await tx.rolePermission.deleteMany({ where: { roleId: duplicateRole.id } });
      await tx.userRole.deleteMany({ where: { roleId: duplicateRole.id } });
      await tx.role.delete({ where: { id: duplicateRole.id } });
    });
  }

  return canonicalRole;
}

async function createTenantWithData(
  slug: string,
  name: string,
  roles: Record<string, string>,
) {
  // Tenant
  const tenant = await prisma.tenant.upsert({
    where: { slug },
    update: {},
    create: { slug, name, status: TenantStatus.ACTIVE, timezone: 'Asia/Karachi', currency: 'PKR', settings: {} },
  });

  const currentSubscription = await prisma.tenantSubscription.findFirst({
    where: { tenantId: tenant.id, status: { in: ['TRIAL', 'ACTIVE', 'SUSPENDED'] } },
    select: { id: true },
  });
  if (!currentSubscription) {
    const trialSettings = await prisma.trialSettings.findUnique({ where: { id: 1 } });
    if (!trialSettings) throw new Error('Apply the SaaS migration before seeding tenant subscriptions.');
    const startedAt = new Date();
    const endsAt = new Date(startedAt.getTime() + trialSettings.durationDays * 86_400_000);
    await prisma.tenantSubscription.create({
      data: {
        tenantId: tenant.id,
        planId: trialSettings.trialPlanId,
        status: 'TRIAL',
        trialStartedAt: startedAt,
        trialEndsAt: endsAt,
        periodStartedAt: startedAt,
        periodEndsAt: endsAt,
      },
    });
  }

  // System roles
  for (const [roleName, permDef] of Object.entries(ROLE_PERMISSIONS)) {
    const role = await ensureTenantSystemRole(tenant.id, roleName);
    roles[roleName] = role.id;

    // Assign permissions
    for (const { module, actions } of permDef) {
      for (const action of actions) {
        const perm = await prisma.permission.findUnique({ where: { module_action: { module, action } } });
        if (!perm) continue;
        await prisma.rolePermission.upsert({
          where: { roleId_permissionId: { roleId: role.id, permissionId: perm.id } },
          update: {},
          create: { roleId: role.id, permissionId: perm.id },
        });
      }
    }
  }

  // Branches
  const branch1 = await prisma.branch.upsert({
    where: { tenantId_code: { tenantId: tenant.id, code: 'B1' } },
    update: {},
    create: {
      tenantId: tenant.id, name: `${name} — Main Branch`, code: 'B1',
      status: BranchStatus.ACTIVE, operatingSettings: {},
    },
  });
  const branch2 = await prisma.branch.upsert({
    where: { tenantId_code: { tenantId: tenant.id, code: 'B2' } },
    update: {},
    create: {
      tenantId: tenant.id, name: `${name} — Annex`, code: 'B2',
      status: BranchStatus.ACTIVE, operatingSettings: {},
    },
  });

  // Demo users — one per role
  const demoUsers: Array<{ roleName: string; email: string; password: string }> = [
    { roleName: 'System Admin',       email: `sysadmin@${slug}.demo`,     password: 'Demo1234!' },
    { roleName: 'Owner',              email: `owner@${slug}.demo`,         password: 'Demo1234!' },
    { roleName: 'Warden',             email: `warden@${slug}.demo`,        password: 'Demo1234!' },
    { roleName: 'Receptionist',       email: `reception@${slug}.demo`,     password: 'Demo1234!' },
    { roleName: 'Accountant',         email: `accountant@${slug}.demo`,    password: 'Demo1234!' },
    { roleName: 'Security',           email: `security@${slug}.demo`,      password: 'Demo1234!' },
    { roleName: 'Mess Staff',         email: `mess@${slug}.demo`,          password: 'Demo1234!' },
    { roleName: 'Maintenance Staff',  email: `maintenance@${slug}.demo`,   password: 'Demo1234!' },
    { roleName: 'Resident',           email: `resident@${slug}.demo`,      password: 'Demo1234!' },
  ];

  for (const { roleName, email, password } of demoUsers) {
    const passwordHash = await hashPassword(password);
    const user = await prisma.user.upsert({
      where: { tenantId_email: { tenantId: tenant.id, email } },
      update: {},
      create: { tenantId: tenant.id, email, passwordHash, status: UserStatus.ACTIVE },
    });

    // Assign role
    const roleId = roles[roleName];
    if (roleId) {
      await prisma.userRole.upsert({
        where: { userId_tenantId_roleId: { userId: user.id, tenantId: tenant.id, roleId } },
        update: {},
        create: { userId: user.id, tenantId: tenant.id, roleId },
      });
    }

    // Scope staff (non-Owner/Admin) to branch1
    if (!['System Admin', 'Owner'].includes(roleName)) {
      await prisma.userBranchScope.upsert({
        where: { userId_branchId: { userId: user.id, branchId: branch1.id } },
        update: {},
        create: { userId: user.id, branchId: branch1.id },
      });
    }
  }

  const demoResidentEmail = `resident@${slug}.demo`;
  const demoResidentUser = await prisma.user.findUnique({
    where: { tenantId_email: { tenantId: tenant.id, email: demoResidentEmail } },
    select: { id: true },
  });
  if (demoResidentUser) {
    const existingDemoResident = await prisma.resident.findFirst({
      where: { tenantId: tenant.id, email: demoResidentEmail, deletedAt: null },
      select: { id: true },
    });
    if (!existingDemoResident) {
      await prisma.resident.create({
        data: {
          tenantId: tenant.id,
          branchId: branch1.id,
          userId: demoResidentUser.id,
          firstName: 'Demo',
          lastName: 'Resident',
          email: demoResidentEmail,
        },
      });
    } else {
      await prisma.resident.updateMany({
        where: {
          id: existingDemoResident.id,
          tenantId: tenant.id,
          userId: null,
        },
        data: { userId: demoResidentUser.id },
      });
    }
  }

  // Deactivated user for negative tests (SRS V2 TESTING §4.2)
  const deactivatedHash = await hashPassword('Demo1234!');
  const deactivatedUser = await prisma.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: `deactivated@${slug}.demo` } },
    update: {},
    create: {
      tenantId: tenant.id,
      email: `deactivated@${slug}.demo`,
      passwordHash: deactivatedHash,
      status: UserStatus.DEACTIVATED,
      tokenVersion: 1,
    },
  });
  const wardenRoleId = roles['Warden'];
  if (wardenRoleId) {
    await prisma.userRole.upsert({
      where: { userId_tenantId_roleId: { userId: deactivatedUser.id, tenantId: tenant.id, roleId: wardenRoleId } },
      update: {},
      create: { userId: deactivatedUser.id, tenantId: tenant.id, roleId: wardenRoleId },
    });
  }

  console.log(`  ✓ Tenant "${name}" seeded with ${demoUsers.length + 1} users, 2 branches`);
  return { tenant, branch1, branch2 };
}

async function seedOperationalData(
  slug: string,
  tenantId: string,
  branchId: string,
) {
  const userFor = async (email: string) => {
    const user = await prisma.user.findUnique({
      where: { tenantId_email: { tenantId, email: `${email}@${slug}.demo` } },
      select: { id: true },
    });
    if (!user) throw new Error(`Missing seeded demo user: ${email}@${slug}.demo`);
    return user;
  };

  const [residentUser, accountant, warden, security, messStaff, maintenance] =
    await Promise.all([
      userFor('resident'),
      userFor('accountant'),
      userFor('warden'),
      userFor('security'),
      userFor('mess'),
      userFor('maintenance'),
    ]);

  await prisma.userGateScope.upsert({
    where: { userId_branchId_gateRef: { userId: security.id, branchId, gateRef: 'MAIN-GATE' } },
    update: {},
    create: { userId: security.id, branchId, gateRef: 'MAIN-GATE' },
  });
  await prisma.userMessScope.upsert({
    where: { userId_branchId: { userId: messStaff.id, branchId } },
    update: {},
    create: { userId: messStaff.id, branchId },
  });

  const primaryResident = await prisma.resident.findFirstOrThrow({
    where: { tenantId, branchId, userId: residentUser.id, deletedAt: null },
  });
  const extraResidents: Resident[] = [];
  for (const [firstName, lastName, email] of [
    ['Ayesha', 'Khan', `ayesha.khan@${slug}.demo`],
    ['Bilal', 'Ahmed', `bilal.ahmed@${slug}.demo`],
    ['Sana', 'Ali', `sana.ali@${slug}.demo`],
    ['Omar', 'Raza', `omar.raza@${slug}.demo`],
    ['Hira', 'Malik', `hira.malik@${slug}.demo`],
  ]) {
    let resident = await prisma.resident.findFirst({
      where: { tenantId, branchId, email, deletedAt: null },
    });
    if (!resident) {
      resident = await prisma.resident.create({
        data: { tenantId, branchId, firstName, lastName, email },
      });
    }
    extraResidents.push(resident);
  }
  const [pendingResident, approvedResident, rejectedResident, checkedOutResident, cancelledResident] = extraResidents;

  const residentRole = await prisma.role.findFirstOrThrow({
    where: { tenantId, name: 'Resident', isSystemRole: true },
    select: { id: true },
  });
  const residentPasswordHash = await hashPassword('Demo1234!');
  for (const resident of extraResidents) {
    const email = resident.email;
    if (!email) throw new Error(`Missing email for demo resident ${resident.id}`);
    const studentUser = await prisma.user.upsert({
      where: { tenantId_email: { tenantId, email } },
      update: {},
      create: {
        tenantId,
        email,
        passwordHash: residentPasswordHash,
        status: UserStatus.ACTIVE,
      },
    });
    await prisma.userRole.upsert({
      where: {
        userId_tenantId_roleId: {
          userId: studentUser.id,
          tenantId,
          roleId: residentRole.id,
        },
      },
      update: {},
      create: { userId: studentUser.id, tenantId, roleId: residentRole.id },
    });
    await prisma.userBranchScope.upsert({
      where: { userId_branchId: { userId: studentUser.id, branchId } },
      update: {},
      create: { userId: studentUser.id, branchId },
    });
    if (resident.userId && resident.userId !== studentUser.id) {
      throw new Error(`Demo resident ${email} is already linked to another user`);
    }
    if (!resident.userId) {
      await prisma.resident.update({
        where: { id: resident.id },
        data: { userId: studentUser.id },
      });
    }
  }

  let building = await prisma.building.findFirst({
    where: { tenantId, branchId, name: 'Demo Residence' },
  });
  if (!building) {
    building = await prisma.building.create({
      data: { tenantId, branchId, name: 'Demo Residence' },
    });
  }
  let floor = await prisma.floor.findFirst({
    where: { tenantId, buildingId: building.id, level: 0 },
  });
  if (!floor) {
    floor = await prisma.floor.create({
      data: { tenantId, buildingId: building.id, level: 0, name: 'Ground Floor' },
    });
  }

  const rooms: Room[] = [];
  for (const code of ['DEMO-101', 'DEMO-102']) {
    let room = await prisma.room.findUnique({
      where: { tenantId_code: { tenantId, code } },
    });
    if (!room) {
      room = await prisma.room.create({
        data: { tenantId, branchId, floorId: floor.id, code, bedCapacity: 2 },
      });
    }
    rooms.push(room);
  }
  const beds: Bed[] = [];
  for (const [room, codes] of [
    [rooms[0], ['A', 'B']],
    [rooms[1], ['A', 'B']],
  ] as const) {
    for (const code of codes) {
      let bed = await prisma.bed.findUnique({
        where: { tenantId_roomId_code: { tenantId, roomId: room.id, code } },
      });
      if (!bed) {
        bed = await prisma.bed.create({
          data: {
            tenantId,
            branchId,
            roomId: room.id,
            code,
            status: BedStatus.AVAILABLE,
          },
        });
      }
      beds.push(bed);
    }
  }

  const admissions: Admission[] = [];
  for (const [resident, status, note] of [
    [primaryResident, AdmissionStatus.CHECKED_IN, 'TEST DATA: checked-in resident'],
    [pendingResident, AdmissionStatus.PENDING, 'TEST DATA: pending admission'],
    [approvedResident, AdmissionStatus.APPROVED, 'TEST DATA: approved admission'],
    [rejectedResident, AdmissionStatus.REJECTED, 'TEST DATA: rejected admission'],
    [checkedOutResident, AdmissionStatus.CHECKED_OUT, 'TEST DATA: checked-out resident'],
    [cancelledResident, AdmissionStatus.CANCELLED, 'TEST DATA: cancelled admission'],
  ] as const) {
    let admission = await prisma.admission.findFirst({
      where: { tenantId, residentId: resident.id, notes: note, deletedAt: null },
    });
    if (!admission) {
      const decided = status !== AdmissionStatus.PENDING;
      const now = new Date();
      admission = await prisma.admission.create({
        data: {
          tenantId,
          branchId,
          residentId: resident.id,
          status,
          notes: note,
          requestedCheckInAt: now,
          ...(decided && { decidedByUserId: warden.id, decidedAt: now }),
          ...((status === AdmissionStatus.CHECKED_IN || status === AdmissionStatus.CHECKED_OUT) && {
            checkedInAt: now,
          }),
          ...(status === AdmissionStatus.CHECKED_OUT && { checkedOutAt: now }),
          ...(status === AdmissionStatus.REJECTED && {
            rejectionReason: 'Demo rejection for manual workflow testing',
          }),
        },
      });
    }
    admissions.push(admission);
  }

  const [checkedInAdmission] = admissions;
  const allocation = await prisma.bedAllocation.findFirst({
    where: { tenantId, admissionId: checkedInAdmission.id, status: AllocationStatus.CHECKED_IN },
  });
  if (!allocation) {
    const occupiedBed = beds[0];
    await prisma.bedAllocation.create({
      data: {
        tenantId,
        branchId,
        admissionId: checkedInAdmission.id,
        residentId: primaryResident.id,
        bedId: occupiedBed.id,
        status: AllocationStatus.CHECKED_IN,
        checkedInAt: checkedInAdmission.checkedInAt ?? new Date(),
      },
    });
    await prisma.bed.update({
      where: { id: occupiedBed.id },
      data: { status: BedStatus.OCCUPIED },
    });
  }
  const reservedAllocation = await prisma.bedAllocation.findFirst({
    where: { tenantId, admissionId: admissions[2].id, status: AllocationStatus.RESERVED },
  });
  if (!reservedAllocation) {
    await prisma.bedAllocation.create({
      data: {
        tenantId,
        branchId,
        admissionId: admissions[2].id,
        residentId: approvedResident.id,
        bedId: beds[1].id,
        status: AllocationStatus.RESERVED,
      },
    });
    await prisma.bed.update({
      where: { id: beds[1].id },
      data: { status: BedStatus.RESERVED },
    });
  }
  const endedAllocation = await prisma.bedAllocation.findFirst({
    where: { tenantId, admissionId: admissions[4].id, status: AllocationStatus.ENDED },
  });
  if (!endedAllocation) {
    const checkedInAt = admissions[4].checkedInAt ?? new Date();
    await prisma.bedAllocation.create({
      data: {
        tenantId,
        branchId,
        admissionId: admissions[4].id,
        residentId: checkedOutResident.id,
        bedId: beds[2].id,
        status: AllocationStatus.ENDED,
        checkedInAt,
        endedAt: admissions[4].checkedOutAt ?? new Date(),
      },
    });
  }

  const invoiceFor = async (
    residentId: string,
    invoiceNumber: string,
    description: string,
  ) => {
    let invoice = await prisma.invoice.findFirst({
      where: { tenantId, invoiceNumber, deletedAt: null },
    });
    if (!invoice) {
      invoice = await prisma.invoice.create({
        data: {
          id: randomUUID(),
          tenantId,
          branchId,
          residentId,
          invoiceNumber,
          currency: 'PKR',
          createdByUserId: accountant.id,
          dueAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
          notes: 'Development test invoice',
          lines: {
            create: [
              {
                tenantId,
                branchId,
                description,
                quantity: 1,
                unitAmountMinor: 2500000,
                lineAmountMinor: 2500000,
              },
            ],
          },
        },
      });
    }
    return invoice;
  };

  const invoices = await Promise.all([
    invoiceFor(primaryResident.id, 'DEMO-INV-001', 'Monthly accommodation'),
    invoiceFor(approvedResident.id, 'DEMO-INV-002', 'Admission and accommodation'),
  ]);
  let overdueInvoice = await prisma.invoice.findFirst({
    where: { tenantId, invoiceNumber: 'DEMO-INV-003', deletedAt: null },
  });
  if (!overdueInvoice) {
    overdueInvoice = await prisma.invoice.create({
      data: {
        id: randomUUID(),
        tenantId,
        branchId,
        residentId: pendingResident.id,
        invoiceNumber: 'DEMO-INV-003',
        currency: 'PKR',
        createdByUserId: accountant.id,
        dueAt: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000),
        notes: 'Development test overdue invoice with multiple lines',
        lines: {
          create: [
            {
              tenantId,
              branchId,
              description: 'Monthly accommodation',
              quantity: 1,
              unitAmountMinor: 2000000,
              lineAmountMinor: 2000000,
            },
            {
              tenantId,
              branchId,
              description: 'Mess charges',
              quantity: 1,
              unitAmountMinor: 500000,
              lineAmountMinor: 500000,
            },
          ],
        },
      },
    });
  }
  const paymentRecords = [
    {
      invoice: invoices[0],
      reference: 'DEMO-PAY-PENDING',
      status: PaymentStatus.PENDING,
    },
    {
      invoice: invoices[1],
      reference: 'DEMO-PAY-VERIFIED',
      status: PaymentStatus.VERIFIED,
    },
    {
      invoice: overdueInvoice,
      reference: 'DEMO-PAY-REJECTED',
      status: PaymentStatus.REJECTED,
    },
  ];
  for (const payment of paymentRecords) {
    const existing = await prisma.payment.findFirst({
      where: { tenantId, branchId, reference: payment.reference },
    });
    if (!existing) {
      await prisma.payment.create({
        data: {
          tenantId,
          branchId,
          invoiceId: payment.invoice.id,
          amountMinor: 1000000,
          method: PaymentMethod.BANK_TRANSFER,
          status: payment.status,
          reference: payment.reference,
          proofNotes: 'Synthetic development test payment',
          recordedByUserId: residentUser.id,
          ...(payment.status === PaymentStatus.VERIFIED && {
            verifiedByUserId: accountant.id,
            verifiedAt: new Date(),
          }),
          ...(payment.status === PaymentStatus.REJECTED && {
            verifiedByUserId: accountant.id,
            verifiedAt: new Date(),
            rejectionReason: 'Demo rejected payment for manual workflow testing',
          }),
        },
      });
    }
  }

  const refundSubmissionKey = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
  const existingRefund = await prisma.refund.findFirst({
    where: {
      tenantId,
      branchId,
      invoiceId: invoices[1].id,
      recordedByUserId: accountant.id,
      submissionKey: refundSubmissionKey,
    },
  });
  if (!existingRefund) {
    await prisma.refund.create({
      data: {
        tenantId,
        branchId,
        invoiceId: invoices[1].id,
        amountMinor: 200000,
        method: PaymentMethod.BANK_TRANSFER,
        reference: 'DEMO-REFUND-001',
        notes: 'Synthetic development test refund',
        submissionKey: refundSubmissionKey,
        recordedByUserId: accountant.id,
      },
    });
  }

  const complaints = [
    {
      title: 'Demo: Room light needs repair',
      description: 'The light in the demo room is not working.',
      status: ComplaintStatus.OPEN,
      priority: ComplaintPriority.NORMAL,
    },
    {
      title: 'Demo: Water tap maintenance',
      description: 'Please inspect the shared washroom tap.',
      status: ComplaintStatus.IN_PROGRESS,
      priority: ComplaintPriority.HIGH,
    },
    {
      title: 'Demo: Resolved water issue',
      description: 'A sample resolved complaint for status and history testing.',
      status: ComplaintStatus.RESOLVED,
      priority: ComplaintPriority.NORMAL,
    },
    {
      title: 'Demo: Closed noise report',
      description: 'A sample closed complaint for status and history testing.',
      status: ComplaintStatus.CLOSED,
      priority: ComplaintPriority.LOW,
    },
  ];
  for (const complaint of complaints) {
    const existing = await prisma.complaint.findFirst({
      where: { tenantId, branchId, title: complaint.title },
    });
    if (!existing) {
      await prisma.complaint.create({
        data: {
          tenantId,
          branchId,
          ...complaint,
          submittedByUserId: residentUser.id,
          assignedToUserId: maintenance.id,
          ...(complaint.status === ComplaintStatus.RESOLVED && { resolvedAt: new Date() }),
        },
      });
    }
  }

  const notices = [
    {
      title: 'Demo: Welcome to the hostel',
      body: 'Welcome! Contact reception if you need assistance.',
      status: NoticeStatus.PUBLISHED,
    },
    {
      title: 'Demo: Scheduled maintenance',
      body: 'A maintenance inspection is planned for the common areas.',
      status: NoticeStatus.DRAFT,
    },
  ];
  for (const notice of notices) {
    const existing = await prisma.notice.findFirst({
      where: { tenantId, branchId, title: notice.title },
    });
    if (!existing) {
      await prisma.notice.create({
        data: {
          tenantId,
          branchId,
          ...notice,
          createdByUserId: warden.id,
          ...(notice.status === NoticeStatus.PUBLISHED && { publishedAt: new Date() }),
        },
      });
    }
  }

  const weekStart = new Date();
  weekStart.setUTCHours(0, 0, 0, 0);
  weekStart.setUTCDate(weekStart.getUTCDate() - ((weekStart.getUTCDay() + 6) % 7));
  const menu = await prisma.messMenu.upsert({
    where: { tenantId_branchId_weekStart: { tenantId, branchId, weekStart } },
    update: {},
    create: { tenantId, branchId, weekStart, createdByUserId: messStaff.id },
  });
  const meals = [
    [MessMealType.BREAKFAST, 'Paratha, eggs, and tea'],
    [MessMealType.LUNCH, 'Chicken curry, rice, and salad'],
    [MessMealType.DINNER, 'Lentils, roti, and seasonal vegetables'],
  ] as const;
  for (let dayOfWeek = 1; dayOfWeek <= 7; dayOfWeek += 1) {
    for (const [meal, description] of meals) {
      await prisma.messMenuEntry.upsert({
        where: { menuId_dayOfWeek_meal: { menuId: menu.id, dayOfWeek, meal } },
        update: {},
        create: { tenantId, branchId, menuId: menu.id, dayOfWeek, meal, description },
      });
    }
  }

  const visits = [
    { visitorName: 'Demo Pending Visitor', purpose: 'Family visit', status: VisitorVisitStatus.PENDING },
    { visitorName: 'Demo Approved Visitor', purpose: 'Family visit', status: VisitorVisitStatus.APPROVED },
    { visitorName: 'Demo Rejected Visitor', purpose: 'Resident visit', status: VisitorVisitStatus.REJECTED },
    { visitorName: 'Demo Checked-in Visitor', purpose: 'Resident visit', status: VisitorVisitStatus.CHECKED_IN },
    { visitorName: 'Demo Checked-out Visitor', purpose: 'Family visit', status: VisitorVisitStatus.CHECKED_OUT },
  ];
  for (const visit of visits) {
    const existing = await prisma.visitorVisit.findFirst({
      where: { tenantId, branchId, visitorName: visit.visitorName, purpose: visit.purpose },
    });
    if (!existing) {
      const approved =
        visit.status === VisitorVisitStatus.APPROVED ||
        visit.status === VisitorVisitStatus.CHECKED_IN ||
        visit.status === VisitorVisitStatus.CHECKED_OUT;
      const checkedIn =
        visit.status === VisitorVisitStatus.CHECKED_IN ||
        visit.status === VisitorVisitStatus.CHECKED_OUT;
      await prisma.visitorVisit.create({
        data: {
          tenantId,
          branchId,
          hostResidentId: primaryResident.id,
          visitorName: visit.visitorName,
          visitorPhone: '03000000000',
          purpose: visit.purpose,
          status: visit.status,
          createdByUserId: security.id,
          ...(approved && {
            approvedByUserId: warden.id,
            approvedAt: new Date(),
          }),
          ...(checkedIn && {
            checkedInByUserId: security.id,
            checkedInAt: new Date(),
          }),
          ...(visit.status === VisitorVisitStatus.CHECKED_OUT && {
            checkedOutByUserId: security.id,
            checkedOutAt: new Date(),
          }),
        },
      });
    }
  }

  console.log(`  ✓ Operational test data seeded for ${slug}`);
}

async function main() {
  console.log('HMS Seed — Phase 1');
  await ensurePermissions();

  const roles1: Record<string, string> = {};
  const roles2: Record<string, string> = {};

  const sunrise = await createTenantWithData('sunrise-hostel', 'Sunrise Hostel', roles1);
  const greenview = await createTenantWithData('greenview-hostel', 'Greenview Hostel', roles2);
  await seedOperationalData('sunrise-hostel', sunrise.tenant.id, sunrise.branch1.id);
  await seedOperationalData('greenview-hostel', greenview.tenant.id, greenview.branch1.id);

  console.log('\n✅ Seed complete.');
  console.log('Demo login: owner@sunrise-hostel.demo / Demo1234!');
  console.log('Tenant slug for login: sunrise-hostel or greenview-hostel');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
