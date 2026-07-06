import { Request, Response } from 'express';
import { UserRole } from '@lib/constants';
import { hashPassword } from '@lib/security';
import { HttpError, sendCreated, sendSuccess } from '@utils/http';
import { adminRepos, actor, getPagination, paginated, routeParam } from './admin.helpers';

function safeStaff(user: any) {
  const { password, refreshToken, ...safe } = user;
  return safe;
}

const STAFF_ROLES: UserRole[] = [UserRole.SUPPORT, UserRole.ADMIN, UserRole.SUPER_ADMIN];

export class AdminStaffController {
  list = async (req: Request, res: Response) => {
    const { page, limit, skip } = getPagination(req.query);
    const role = typeof req.query.role === 'string' ? req.query.role : undefined;
    const search = typeof req.query.search === 'string' ? req.query.search.toLowerCase() : undefined;

    const all = await adminRepos.users().find({ order: { createdAt: 'DESC' } });

    let filtered = (all as any[]).filter((u) => STAFF_ROLES.includes(u.role));
    if (role && STAFF_ROLES.includes(role as UserRole)) {
      filtered = filtered.filter((u) => u.role === role);
    }
    if (search) {
      filtered = filtered.filter((u) =>
        [u.email, u.firstName, u.lastName].some((v) =>
          String(v || '').toLowerCase().includes(search),
        ),
      );
    }

    const data = filtered.slice(skip, skip + limit).map(safeStaff);
    sendSuccess(res, paginated(data, filtered.length, page, limit));
  };

  detail = async (req: Request, res: Response) => {
    const user = await adminRepos.users().findOne({ where: { id: routeParam(req.params.id) } });
    if (!user || !STAFF_ROLES.includes((user as any).role)) throw new HttpError(404, 'Staff member not found');
    sendSuccess(res, safeStaff(user));
  };

  create = async (req: Request, res: Response) => {
    const users = adminRepos.users();
    const existing = await users.findOne({ where: { email: req.body.email } });
    if (existing) throw new HttpError(400, 'Email already in use');

    const user = await users.save(
      users.create({
        email: req.body.email,
        password: await hashPassword(req.body.password),
        firstName: req.body.firstName || '',
        lastName: req.body.lastName || '',
        role: req.body.role,
        permissions: req.body.permissions || [],
        isActive: true,
        isEmailVerified: true,
      }),
    );

    const auditLogs = adminRepos.auditLogs();
    await auditLogs.save(
      auditLogs.create({
        action: 'staff.create',
        resourceType: 'user',
        resourceId: (user as any).id,
        details: `Created ${req.body.role} account for ${req.body.email}`,
        status: 'success',
        ...actor(req),
      }),
    );

    sendCreated(res, safeStaff(user));
  };

  update = async (req: Request, res: Response) => {
    const users = adminRepos.users();
    const user = await users.findOne({ where: { id: routeParam(req.params.id) } });
    if (!user || !STAFF_ROLES.includes((user as any).role)) throw new HttpError(404, 'Staff member not found');

    Object.assign(user, {
      firstName: req.body.firstName ?? (user as any).firstName,
      lastName: req.body.lastName ?? (user as any).lastName,
      phone: req.body.phone ?? (user as any).phone,
    });
    await users.save(user);
    sendSuccess(res, safeStaff(user));
  };

  updatePermissions = async (req: Request, res: Response) => {
    const users = adminRepos.users();
    const user = await users.findOne({ where: { id: routeParam(req.params.id) } });
    if (!user || !STAFF_ROLES.includes((user as any).role)) throw new HttpError(404, 'Staff member not found');

    if ((user as any).role === UserRole.SUPER_ADMIN) {
      throw new HttpError(400, 'Super admin permissions cannot be restricted');
    }

    (user as any).permissions = req.body.permissions;
    await users.save(user);

    const auditLogs = adminRepos.auditLogs();
    await auditLogs.save(
      auditLogs.create({
        action: 'staff.permissions_update',
        resourceType: 'user',
        resourceId: (user as any).id,
        details: `Updated permissions: [${req.body.permissions.join(', ')}]`,
        status: 'success',
        ...actor(req),
      }),
    );

    sendSuccess(res, { id: (user as any).id, permissions: (user as any).permissions });
  };

  toggle = async (req: Request, res: Response) => {
    const users = adminRepos.users();
    const user = await users.findOne({ where: { id: routeParam(req.params.id) } });
    if (!user || !STAFF_ROLES.includes((user as any).role)) throw new HttpError(404, 'Staff member not found');

    if ((user as any).id === req.user!.sub) {
      throw new HttpError(400, 'You cannot deactivate your own account');
    }

    (user as any).isActive = !(user as any).isActive;
    await users.save(user);
    sendSuccess(res, { id: (user as any).id, isActive: (user as any).isActive });
  };

  remove = async (req: Request, res: Response) => {
    const users = adminRepos.users();
    const user = await users.findOne({ where: { id: routeParam(req.params.id) } });
    if (!user || !STAFF_ROLES.includes((user as any).role)) throw new HttpError(404, 'Staff member not found');

    if ((user as any).id === req.user!.sub) {
      throw new HttpError(400, 'You cannot delete your own account');
    }
    if ((user as any).role === UserRole.SUPER_ADMIN) {
      throw new HttpError(400, 'Super admin accounts cannot be deleted via this endpoint');
    }

    (user as any).deletedAt = new Date();
    await users.save(user);

    const auditLogs = adminRepos.auditLogs();
    await auditLogs.save(
      auditLogs.create({
        action: 'staff.delete',
        resourceType: 'user',
        resourceId: (user as any).id,
        details: `Soft-deleted staff member ${(user as any).email}`,
        status: 'success',
        ...actor(req),
      }),
    );

    sendSuccess(res, { id: (user as any).id, deleted: true });
  };
}
