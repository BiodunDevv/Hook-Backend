import { Request, Response } from 'express';
import { ILike } from 'typeorm';
import { UserRole } from '@lib/constants';
import { hashPassword } from '@lib/security';
import { HttpError, sendCreated, sendSuccess } from '@utils/http';
import { adminRepos, getPagination, paginated, routeParam } from './admin.helpers';

function safeUser(user: any) {
  const { password, refreshToken, ...safe } = user;
  return safe;
}

export class AdminUsersController {
  list = async (req: Request, res: Response) => {
    const { page, limit, skip } = getPagination(req.query);
    const role = typeof req.query.role === 'string' ? req.query.role : undefined;
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;
    const qb = adminRepos.users().createQueryBuilder('u').orderBy('u.createdAt', 'DESC');
    if (role) qb.andWhere('u.role = :role', { role });
    if (search) qb.andWhere('(u.email ILIKE :search OR u.firstName ILIKE :search OR u.lastName ILIKE :search)', { search: `%${search}%` });
    const [data, total] = await qb.skip(skip).take(limit).getManyAndCount();
    sendSuccess(res, paginated(data.map(safeUser), total, page, limit));
  };

  customers = async (req: Request, res: Response) => {
    req.query.role = UserRole.SHOPPER;
    return this.list(req, res);
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
