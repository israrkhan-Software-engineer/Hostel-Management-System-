import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { BranchStatus } from '@prisma/client';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../common/prisma/prisma.service';
import { UsersService } from '../users/users.service';

@ApiTags('branches')
@ApiBearerAuth()
@Controller({ path: 'branches', version: '1' })
export class BranchesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
  ) {}

  @Get()
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
}
