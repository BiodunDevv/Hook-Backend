import { UserRole } from '@lib/constants';

declare global {
  namespace Express {
    interface User {
      sub: string;
      email: string;
      role: UserRole;
    }

    interface Request {
      user?: User;
    }
  }
}

export {};
