import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UsersService } from '../../modules/users/users.service';
import { BRANCH_SCOPED_KEY } from '../decorators/branch-scoped.decorator';
import { PrismaService } from '../prisma/prisma.service';

/**
 * L3 Branch scope guard — verifies the requested branchId (from params/query/body)
 * is in the authenticated user's assigned branch scope.
 *
 * Hostel owners and system admins without an explicit scope may access all
 * tenant branches; regular staff are restricted to assigned branches.
 * (SRS V2 §3, §5 / SECURITY §5.1 L3)
 *
 * Only applied to routes decorated with @BranchScoped().
 */
@Injectable()
export class BranchScopeGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private users: UsersService,
    private prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<boolean>(BRANCH_SCOPED_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;

    const req = context.switchToHttp().getRequest<{
      user?: { userId: string; tenantId: string };
      params?: Record<string, string>;
      query?: Record<string, string>;
      body?: Record<string, string>;
    }>();

    if (!req.user) return false;

    // Extract branchId from params, query or body (in that order of precedence)
    const branchId =
      req.params?.['branchId'] ??
      req.query?.['branchId'] ??
      req.body?.['branchId'];

    if (!branchId) return true; // No branch filter — let the service handle it

    const user = req.user;
    return this.prisma.runWithTenantContext(user.tenantId, async () => {
      const assignedBranches = await this.users.getBranchScopes(user.userId, user.tenantId);

      if (
        assignedBranches.length === 0 &&
        await this.users.canAccessAllBranches(user.userId, user.tenantId)
      ) {
        return true;
      }

      if (!assignedBranches.includes(branchId)) {
        throw new ForbiddenException('Access to this branch is not permitted');
      }

      return true;
    });
  }
}
