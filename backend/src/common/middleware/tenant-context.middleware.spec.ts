import { BadRequestException, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { lastValueFrom, of } from 'rxjs';
import { TenantContextInterceptor } from './tenant-context.middleware';
import { PrismaService } from '../prisma/prisma.service';

describe('TenantContextInterceptor', () => {
  it('rejects malformed percent-encoding in public hostel slugs', async () => {
    const context = {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => ({
          originalUrl: '/api/v1/public/hostels/%E0%A4%A',
          body: {},
        }),
      }),
    } as unknown as ExecutionContext;
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(false),
    };
    const interceptor = new TenantContextInterceptor(
      {} as PrismaService,
      reflector as unknown as Reflector,
    );

    await expect(lastValueFrom(interceptor.intercept(context, { handle: () => of(null) })))
      .rejects.toThrow(BadRequestException);
  });
});
