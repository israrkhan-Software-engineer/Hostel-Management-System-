import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { Tenant, TenantStatus } from '@prisma/client';

@Injectable()
export class TenantsService {
  constructor(private prisma: PrismaService) {}

  /** Resolve a tenant by slug — used at login to identify which hostel the user belongs to */
  async findBySlug(slug: string): Promise<Tenant> {
    const tenant = await this.prisma.tenant.findUnique({ where: { slug } });
    if (!tenant || tenant.deletedAt) {
      throw new NotFoundException('Tenant not found');
    }
    return tenant;
  }

  async findById(id: string): Promise<Tenant> {
    const tenant = await this.prisma.tenant.findUnique({ where: { id } });
    if (!tenant || tenant.deletedAt) {
      throw new NotFoundException('Tenant not found');
    }
    return tenant;
  }

  /** Only ACTIVE tenants can authenticate (SUSPENDED = read-only, CLOSED = denied) */
  isActive(tenant: Tenant): boolean {
    return tenant.status === TenantStatus.ACTIVE;
  }

  isSuspended(tenant: Tenant): boolean {
    return tenant.status === TenantStatus.SUSPENDED;
  }
}
