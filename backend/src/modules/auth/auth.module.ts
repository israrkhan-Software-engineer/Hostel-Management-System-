import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';
import { TenantsModule } from '../tenants/tenants.module';
import { UsersModule } from '../users/users.module';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const accessExpiry = config.get<string>('app.jwtAccessExpiry', '15m');
        return {
          secret: config.get<string>('app.jwtSecret'),
          signOptions: { expiresIn: durationInSeconds(accessExpiry) },
        };
      },
    }),
    TenantsModule,
    UsersModule,
    AuditModule,
    NotificationsModule,
  ],
  providers: [AuthService, JwtStrategy],
  controllers: [AuthController],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}

function durationInSeconds(duration: string): number {
  const value = Number.parseInt(duration, 10);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error('JWT_ACCESS_EXPIRY must be a positive duration.');
  }
  if (duration.endsWith('d')) return value * 24 * 60 * 60;
  if (duration.endsWith('h')) return value * 60 * 60;
  if (duration.endsWith('m')) return value * 60;
  return value;
}
