import { Request, Response } from 'express';
import { UserRole } from '@lib/constants';
import { hashPassword } from '@lib/security';
import { HttpError, sendCreated, sendSuccess } from '@utils/http';
import { adminRepos, getPagination, paginated, routeParam } from './admin.helpers';

const STAFF_ROLES = [UserRole.SUPPORT, UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.FIELD_AGENT, UserRole.EV_DRIVER];

function safeUser(user: any) {
  const safe = { ...user };
  delete safe.password;
  delete safe.refreshToken;
  return { ...safe, id: safe.publicId || safe.id };
}

export class AdminUsersController {
  list = async (req: Request, res: Response) => {
    const { page, limit, skip } = getPagination(req.query);
    const role = typeof req.query.role === 'string' ? req.query.role : undefined;
    const search = typeof req.query.search === 'string' ? req.query.search.toLowerCase() : undefined;
    const where: Record<string, unknown> = {};
    if (role) where.role = role;
    const all = await adminRepos.users().find({ where, order: { createdAt: 'DESC' } });
    // Exclude staff roles unless a specific role filter was requested
    const nonStaff = role ? all : all.filter((user: any) => !STAFF_ROLES.includes(user.role));
    const filtered = search
      ? nonStaff.filter((user: any) => [user.email, user.firstName, user.lastName].some((value) => String(value || '').toLowerCase().includes(search)))
      : nonStaff;
    const data = filtered.slice(skip, skip + limit);
    sendSuccess(res, paginated(data.map(safeUser), filtered.length, page, limit));
  };

  customers = async (req: Request, res: Response) => {
    const { page, limit, skip } = getPagination(req.query);
    const search = typeof req.query.search === 'string' ? req.query.search.toLowerCase() : undefined;
    // Strictly shopper role only — never returns any staff accounts
    const all = await adminRepos.users().find({
      where: { role: UserRole.SHOPPER },
      order: { createdAt: 'DESC' },
    });
    const filtered = search
      ? all.filter((user: any) => [user.email, user.firstName, user.lastName].some((value) => String(value || '').toLowerCase().includes(search)))
      : all;
    const data = filtered.slice(skip, skip + limit);
    sendSuccess(res, paginated(data.map(safeUser), filtered.length, page, limit));
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
