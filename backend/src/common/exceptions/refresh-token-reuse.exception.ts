import { UnauthorizedException } from '@nestjs/common';

export class RefreshTokenReuseException extends UnauthorizedException {
  constructor(
    readonly tenantId: string,
    readonly userId: string,
  ) {
    super('Token reuse detected — all sessions revoked');
  }
}
