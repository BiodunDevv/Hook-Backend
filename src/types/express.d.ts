import { UserRole } from '@lib/constants';

declare global {
  namespace Express {
    interface User {
      sub: string;
      email: string;
      role: UserRole;
      permissions: string[];
    }

    interface Request {
      user?: User;
      guestId?: string;
    }
  }
}

export {};
