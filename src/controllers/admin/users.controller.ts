import { Request, Response } from 'express';
import { AccountType, UserRole } from '@lib/constants';
import { hashPassword } from '@lib/security';
import { HttpError, sendCreated, sendSuccess } from '@utils/http';
import { adminRepos, getPagination, paginated, routeParam } from './admin.helpers';
import { User } from '@models/users/user.model';

const USER_LIST_FIELDS = 'publicId email phone firstName lastName role accountType accountStatus scopeType assignedStateIds assignedHubIds assignedCategoryIds isEmailVerified isPhoneVerified isActive lastLoginAt createdAt updatedAt';

function searchRegex(value: string) {
  return new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
}

function safeUser(user: any) {
  const { _id, ...safe } = user;
  delete safe.password;
  delete safe.refreshToken;
  return { ...safe, id: safe.publicId || safe.id || _id?.toString?.() };
}

export class AdminUsersController {
  list = async (req: Request, res: Response) => {
    const { page, limit, skip } = getPagination(req.query);
    const role = typeof req.query.role === 'string' ? req.query.role : undefined;
    const search = typeof req.query.search === 'string' ? req.query.search.toLowerCase() : undefined;
    const where: Record<string, any> = {};
    if (role) where.role = role;
    if (!role) {
      where.$and = [{
        $or: [
          { accountType: AccountType.CUSTOMER },
          { accountType: { $exists: false }, role: UserRole.SHOPPER },
        ],
      }];
    }
    if (search) {
      const expression = searchRegex(search);
      const searchClause = { $or: [{ email: expression }, { firstName: expression }, { lastName: expression }] };
      if (where.$and) {
        where.$and.push(searchClause);
      } else {
        where.$and = [searchClause];
      }
    }
    const [data, total] = await Promise.all([
      User.find(where).select(USER_LIST_FIELDS).sort({ createdAt: -1 }).skip(skip).limit(limit).lean({ virtuals: true }),
      User.countDocuments(where),
    ]);
    sendSuccess(res, paginated((data as any[]).map(safeUser), total, page, limit));
  };

  customers = async (req: Request, res: Response) => {
    const { page, limit, skip } = getPagination(req.query);
    const search = typeof req.query.search === 'string' ? req.query.search.toLowerCase() : undefined;
    const where: Record<string, any> = {
      $and: [{
        $or: [
          { accountType: AccountType.CUSTOMER },
          { accountType: { $exists: false }, role: UserRole.SHOPPER },
        ],
      }],
    };
    if (search) {
      const expression = searchRegex(search);
      where.$and.push({ $or: [{ email: expression }, { firstName: expression }, { lastName: expression }] });
    }
    const [data, total] = await Promise.all([
      User.find(where).select(USER_LIST_FIELDS).sort({ createdAt: -1 }).skip(skip).limit(limit).lean({ virtuals: true }),
      User.countDocuments(where),
    ]);
    sendSuccess(res, paginated((data as any[]).map(safeUser), total, page, limit));
  };

  detail = async (req: Request, res: Response) => {
    const user = await adminRepos.users().findOne({ where: { id: routeParam(req.params.id) } });
    if (!user) throw new HttpError(404, 'User not found');
    sendSuccess(res, safeUser(user));
  };

  create = async (req: Request, res: Response) => {
    const users = adminRepos.users();
    const existing = await users.findOne({ where: { email: req.body.email } });
    if (existing) throw new HttpError(400, 'Email already in use');
    const user = await users.save(users.create({
      email: req.body.email,
      password: await hashPassword(req.body.password),
      firstName: req.body.firstName || '',
      lastName: req.body.lastName || '',
      role: req.body.role || UserRole.SHOPPER,
      isActive: true,
      isEmailVerified: true,
    }));
    sendCreated(res, safeUser(user));
  };

  toggle = async (req: Request, res: Response) => {
    const users = adminRepos.users();
    const user = await users.findOne({ where: { id: routeParam(req.params.id) } });
    if (!user) throw new HttpError(404, 'User not found');
    user.isActive = !user.isActive;
    await users.save(user);
    sendSuccess(res, { id: user.id, isActive: user.isActive });
  };

  role = async (req: Request, res: Response) => {
    const users = adminRepos.users();
    const user = await users.findOne({ where: { id: routeParam(req.params.id) } });
    if (!user) throw new HttpError(404, 'User not found');
    user.role = req.body.role;
    await users.save(user);
    sendSuccess(res, { id: user.id, email: user.email, role: user.role });
  };
}
