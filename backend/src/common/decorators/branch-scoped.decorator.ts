import { SetMetadata } from '@nestjs/common';

export const BRANCH_SCOPED_KEY = 'branchScoped';

/** Mark a route as branch-scoped — triggers BranchScopeGuard */
export const BranchScoped = () => SetMetadata(BRANCH_SCOPED_KEY, true);
