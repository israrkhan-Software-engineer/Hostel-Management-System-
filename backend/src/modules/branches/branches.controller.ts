import { Body, ConflictException, Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { BranchStatus } from '@prisma/client';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { UsersService } from '../users/users.service';
import { CreateBranchDto } from '../users/tenant-management.dto';

@ApiTags('branches')
@ApiBearerAuth()
@Controller({ path: 'branches', version: '1' })
export class BranchesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermission('branches', 'view')
  async list(@CurrentUser() user: RequestUser) {
    const [branchScopes, canAccessAllBranches] = await Promise.all([
      this.users.getBranchScopes(user.userId, user.tenantId),
      this.users.canAccessAllBranches(user.userId, user.tenantId),
    ]);
    const visibleBranchIds = canAccessAllBranches
      ? undefined
      : branchScopes;

    return this.prisma.branch.findMany({
      where: {
        tenantId: user.tenantId,
        status: BranchStatus.ACTIVE,
        deletedAt: null,
        ...(visibleBranchIds ? { id: { in: visibleBranchIds } } : {}),
      },
      select: { id: true, name: true, code: true },
      orderBy: { name: 'asc' },
    });
  }

  @Post()
  @RequirePermission('branches', 'create')
  async create(@CurrentUser() user: RequestUser, @Body() dto: CreateBranchDto) {
    try {
      const branch = await this.prisma.$transaction(async (tx) => {
        const [subscription] = await tx.$queryRaw<Array<{ id: string; branch_limit: number }>>`
          SELECT s.id, p.branch_limit
          FROM tenant_subscriptions s
          JOIN subscription_plans p ON p.id = s.plan_id
          WHERE s.tenant_id = ${user.tenantId}::uuid
            AND s.status IN ('TRIAL', 'ACTIVE')
            AND s.period_ends_at > NOW()
          ORDER BY s.created_at DESC, s.id DESC
          LIMIT 1
          FOR UPDATE OF s
        `;
        if (!subscription) {
          throw new ConflictException('An active subscription is required to add branches');
        }
        const branchCount = await tx.branch.count({
          where: { tenantId: user.tenantId, deletedAt: null },
        });
        if (branchCount >= subscription.branch_limit) {
          throw new ConflictException(
            `This plan allows ${subscription.branch_limit} branches. Upgrade the plan to add more.`,
          );
        }
        return tx.branch.create({
          data: {
            tenantId: user.tenantId,
            name: dto.name.trim(),
            code: dto.code.trim().toUpperCase(),
            address: dto.address?.trim() || null,
          },
        });
      });
      await this.audit.log({
        tenantId: user.tenantId,
        actorUserId: user.userId,
        action: 'branch.create',
        module: 'branches',
        entityType: 'branch',
        entityId: branch.id,
        outcome: 'success',
      });
      return branch;
    } catch (error) {
      if (
        typeof error === 'object'
        && error !== null
        && 'code' in error
        && error.code === 'P2002'
      ) {
        throw new ConflictException('A branch with this code already exists');
      }
      throw error;
    }
  }
}
