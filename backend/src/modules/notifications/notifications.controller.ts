import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsOptional, IsInt, Min, Max } from 'class-validator';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { NotificationsService } from './notifications.service';

class NotificationListQueryDto {
  @Transform(({ value }) => (value === undefined || value === null || value === '' ? 1 : Number(value)))
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @Transform(({ value }) => (value === undefined || value === null || value === '' ? 25 : Number(value)))
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 25;

  @Transform(({ value }) => value === 'true')
  @IsOptional()
  @IsBoolean()
  unreadOnly?: boolean;
}

class UpdateNotificationPreferenceDto {
  @IsOptional()
  @IsBoolean()
  inApp?: boolean;

  @IsOptional()
  @IsBoolean()
  email?: boolean;

  @IsOptional()
  @IsBoolean()
  sms?: boolean;
}

@ApiTags('notifications')
@ApiBearerAuth()
@Controller({ path: 'notifications', version: '1' })
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @RequirePermission('notifications', 'view')
  list(@CurrentUser() user: RequestUser, @Query() query: NotificationListQueryDto) {
    return this.notifications.list(user.tenantId, user.userId, query.unreadOnly ?? false, query.page, query.pageSize);
  }

  @Post('read-all')
  @RequirePermission('notifications', 'view')
  markAllRead(@CurrentUser() user: RequestUser) {
    return this.notifications.markAllRead(user.tenantId, user.userId);
  }

  @Patch(':notificationId/read')
  @RequirePermission('notifications', 'view')
  markRead(
    @CurrentUser() user: RequestUser,
    @Param('notificationId', ParseUUIDPipe) notificationId: string,
  ) {
    return this.notifications.markRead(user.tenantId, user.userId, notificationId);
  }

  @Get('preferences')
  @RequirePermission('notifications', 'view')
  preferences(@CurrentUser() user: RequestUser) {
    return this.notifications.preferences(user.tenantId, user.userId);
  }

  @Patch('preferences/:category')
  @RequirePermission('notifications', 'view')
  setPreference(
    @CurrentUser() user: RequestUser,
    @Param('category') category: string,
    @Body() dto: UpdateNotificationPreferenceDto,
  ) {
    return this.notifications.setPreference(user.tenantId, user.userId, category, dto);
  }
}
