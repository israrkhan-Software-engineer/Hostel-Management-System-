import { SetMetadata } from '@nestjs/common';

export const SKIP_PERMISSION_CHECK_KEY = 'skipPermissionCheck';

export const SkipPermissionCheck = () => SetMetadata(SKIP_PERMISSION_CHECK_KEY, true);
