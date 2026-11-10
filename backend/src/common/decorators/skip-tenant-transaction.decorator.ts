import { SetMetadata } from '@nestjs/common';

export const SKIP_TENANT_TRANSACTION = 'skipTenantTransaction';

export const SkipTenantTransaction = () => SetMetadata(SKIP_TENANT_TRANSACTION, true);
