import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  HealthCheckResult,
  HealthIndicatorResult,
  MemoryHealthIndicator,
  DiskHealthIndicator,
} from '@nestjs/terminus';
import { ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import IORedis from 'ioredis';
import { PrismaService } from '../../common/prisma/prisma.service';
import { Public } from '../../common/decorators/public.decorator';
import { PaymentProofStorageService } from '../../common/storage/payment-proof-storage.service';

@ApiTags('health')
@Public()
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(
    private health: HealthCheckService,
    private memory: MemoryHealthIndicator,
    private disk: DiskHealthIndicator,
    private prismaService: PrismaService,
    private config: ConfigService,
    private storage: PaymentProofStorageService,
  ) {}

  /** Custom DB check — avoids terminus PrismaHealthIndicator binary dependency */
  private async dbCheck(): Promise<HealthIndicatorResult> {
    try {
      await this.prismaService.$queryRawUnsafe('SELECT 1');
      return { database: { status: 'up' } };
    } catch {
      return { database: { status: 'down' } };
    }
  }

  private async redisCheck(): Promise<HealthIndicatorResult> {
    const redis = new IORedis(this.config.getOrThrow<string>('app.redisUrl'), {
      lazyConnect: true,
      connectTimeout: 2_000,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
    });
    try {
      await redis.connect();
      await redis.ping();
      return { redis: { status: 'up' } };
    } catch {
      return { redis: { status: 'down' } };
    } finally {
      redis.disconnect();
    }
  }

  private async storageCheck(): Promise<HealthIndicatorResult> {
    try {
      await this.storage.checkHealth();
      return { objectStorage: { status: 'up' } };
    } catch {
      return { objectStorage: { status: 'down' } };
    }
  }

  @Get()
  @HealthCheck()
  check(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.dbCheck(),
      () => this.redisCheck(),
      () => this.storageCheck(),
      () => this.memory.checkHeap('memory_heap', 512 * 1024 * 1024),
      () => this.disk.checkStorage('disk', { path: '/', thresholdPercent: 0.9 }),
    ]);
  }

  /** Liveness probe — returns 200 as soon as the process is running */
  @Get('live')
  live(): { status: string; timestamp: string } {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  /** Readiness requires PostgreSQL, authenticated Redis, and the private proof bucket. */
  @Get('ready')
  @HealthCheck()
  ready(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.dbCheck(),
      () => this.redisCheck(),
      () => this.storageCheck(),
    ]);
  }
}
