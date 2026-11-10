import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { PrismaModule } from './common/prisma/prisma.module';
import { HealthModule } from './modules/health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { TenantsModule } from './modules/tenants/tenants.module';
import { UsersModule } from './modules/users/users.module';
import { RolesModule } from './modules/roles/roles.module';
import { AuditModule } from './modules/audit/audit.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { TenantGuard } from './common/guards/tenant.guard';
import { PermissionGuard } from './common/guards/permission.guard';
import { BranchScopeGuard } from './common/guards/branch-scope.guard';
import appConfig from './common/config/app.config';
import { ResidentsModule } from './modules/residents/residents.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { BranchesModule } from './modules/branches/branches.module';
import { PublicHostelsModule } from './modules/public-hostels/public-hostels.module';
import { FinanceModule } from './modules/finance/finance.module';
import { Phase4Module } from './modules/phase4/phase4.module';
import { VisitorsModule } from './modules/visitors/visitors.module';
import { Phase6Module } from './modules/phase6/phase6.module';
import { TenantContextInterceptor } from './common/middleware/tenant-context.middleware';
import { PlatformAdminModule } from './modules/platform-admin/platform-admin.module';
import { HostelServicesModule } from './modules/hostel-services/hostel-services.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { TenantManagementModule } from './modules/users/tenant-management.module';

const apiRateLimitPerMinute = Number(process.env.API_RATE_LIMIT_PER_MINUTE ?? '10000');
if (!Number.isSafeInteger(apiRateLimitPerMinute) || apiRateLimitPerMinute < 1) {
  throw new Error('API_RATE_LIMIT_PER_MINUTE must be a positive integer.');
}

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig],
      envFilePath: ['.env.local', '.env'],
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: apiRateLimitPerMinute }]),
    PrismaModule,
    HealthModule,
    AuthModule,
    TenantsModule,
    UsersModule,
    RolesModule,
    AuditModule,
    ResidentsModule,
    InventoryModule,
    BranchesModule,
    PublicHostelsModule,
    FinanceModule,
    Phase4Module,
    VisitorsModule,
    Phase6Module,
    PlatformAdminModule,
    HostelServicesModule,
    NotificationsModule,
    TenantManagementModule,
  ],
  providers: [
    // Global guard chain: L1 Auth → L2 Tenant → L4 Permission
    // L3 (BranchScope) is applied per-route with @BranchScoped()
    // SRS V2 NFR-001, FR-112 / SECURITY §5.1
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: TenantGuard },
    { provide: APP_GUARD, useClass: BranchScopeGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_INTERCEPTOR, useClass: TenantContextInterceptor },
  ],
})
export class AppModule {}
