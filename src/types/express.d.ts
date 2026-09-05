import { AccountType, ScopeType, UserRole } from '@lib/constants';

declare global {
  namespace Express {
    interface User {
      sub: string;
      email: string;
      role: UserRole;
      accountType?: AccountType;
      publicId?: string;
      roleKeys?: string[];
      scopeType?: ScopeType;
      assignedStateIds?: string[];
      assignedHubIds?: string[];
      sid?: string;
      permissions: string[];
    }

    interface Request {
      user?: User;
      requestId?: string;
      platformContext?: {
        stateId?: string;
        hubId?: string;
      };
    }
  }
}

export {};
