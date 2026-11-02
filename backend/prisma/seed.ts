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
  'roles', 'public_content',
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
    { module: 'reports',       actions: ['view'] },
  ],
  'Receptionist': [
    { module: 'residents',     actions: ['view', 'create'] },
    { module: 'admissions',    actions: ['view', 'create'] },
    { module: 'allocations',   actions: ['view', 'assign'] },
    { module: 'complaints',    actions: ['view', 'create'] },
    { module: 'notices',       actions: ['view'] },
    { module: 'mess',          actions: ['view'] },
  ],
  'Accountant': [
    { module: 'residents',     actions: ['view'] },
    { module: 'invoices',      actions: ['view', 'create', 'edit'] },
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
    { module: 'mess',          actions: ['view'] },
    { module: 'notices',       actions: ['view'] },
    { module: 'notifications', actions: ['view'] },
  ],
};

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

  const primaryResident = await prisma.resident.findFirstOrThrow({
    where: { tenantId, branchId, userId: residentUser.id, deletedAt: null },
  });
  const extraResidents: Resident[] = [];
  for (const [firstName, lastName, email] of [
    ['Ayesha', 'Khan', `ayesha.khan@${slug}.demo`],
    ['Bilal', 'Ahmed', `bilal.ahmed@${slug}.demo`],
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
  const [pendingResident, approvedResident] = extraResidents;

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
  ] as const) {
    let admission = await prisma.admission.findFirst({
      where: { tenantId, residentId: resident.id, notes: note, deletedAt: null },
    });
    if (!admission) {
      const decided = status !== AdmissionStatus.PENDING;
      admission = await prisma.admission.create({
        data: {
          tenantId,
          branchId,
          residentId: resident.id,
          status,
          notes: note,
          requestedCheckInAt: new Date(),
          ...(decided && { decidedByUserId: warden.id, decidedAt: new Date() }),
          ...(status === AdmissionStatus.CHECKED_IN && { checkedInAt: new Date() }),
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
        },
      });
    }
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
    { visitorName: 'Demo Checked-in Visitor', purpose: 'Resident visit', status: VisitorVisitStatus.CHECKED_IN },
  ];
  for (const visit of visits) {
    const existing = await prisma.visitorVisit.findFirst({
      where: { tenantId, branchId, visitorName: visit.visitorName, purpose: visit.purpose },
    });
    if (!existing) {
      const approved = visit.status === VisitorVisitStatus.CHECKED_IN;
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
            checkedInByUserId: security.id,
            checkedInAt: new Date(),
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
