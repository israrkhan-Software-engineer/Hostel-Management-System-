import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { BranchStatus, TenantStatus } from '@prisma/client';
import { Public } from '../../common/decorators/public.decorator';
import { PrismaService } from '../../common/prisma/prisma.service';

@ApiTags('public-hostels')
@Public()
@Controller({ path: 'public/hostels', version: '1' })
export class PublicHostelsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get(':slug')
  async getHostel(@Param('slug') slug: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug },
      select: { id: true, name: true, status: true, deletedAt: true },
    });
    if (!tenant || tenant.deletedAt || tenant.status !== TenantStatus.ACTIVE) {
      throw new NotFoundException('Hostel not found');
    }

    const branches = await this.prisma.branch.findMany({
      where: {
        tenantId: tenant.id,
        status: BranchStatus.ACTIVE,
        deletedAt: null,
      },
      select: { name: true, address: true, phone: true, mapLink: true },
      orderBy: { name: 'asc' },
    });

    return { name: tenant.name, branches };
  }
}
