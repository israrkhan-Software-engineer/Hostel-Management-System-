import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PlatformAdminController } from './platform-admin.controller';
import { PlatformAdminGuard } from './platform-admin.guard';
import { PlatformAdminService } from './platform-admin.service';
import { PlatformAuthService } from './platform-auth.service';
import { SaasService } from './saas.service';

@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: () => ({}),
    }),
  ],
  controllers: [PlatformAdminController],
  providers: [PlatformAdminService, PlatformAuthService, PlatformAdminGuard, SaasService],
})
export class PlatformAdminModule {}