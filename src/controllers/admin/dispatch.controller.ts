import { Request, Response } from 'express';
import { LogisticsStatus, UserRole } from '@lib/constants';
import { hashPassword } from '@lib/security';
import { mongoIn } from '@lib/mongo-repository';
import { normalizeStateCode, resolveActiveOperationalState } from '@services/operational-state.service';
import { HttpError, sendCreated, sendSuccess } from '@utils/http';
import { adminRepos, getPagination, paginated, routeParam } from './admin.helpers';

export class AdminDispatchController {
  active = async (_req: Request, res: Response) => {
    sendSuccess(res, await adminRepos.logistics().find({
      where: {
        status: mongoIn([
          LogisticsStatus.ASSIGNED,
          LogisticsStatus.DRIVER_ACKNOWLEDGED,
          LogisticsStatus.AT_PICKUP,
          LogisticsStatus.ITEM_PACKED,
          LogisticsStatus.QR_TAGGED,
          LogisticsStatus.IN_TRANSIT,
        ]),
      },
      relations: { order: true, driver: true },
      order: { updatedAt: 'DESC' },
      take: 8,
    }));
  };

  list = async (req: Request, res: Response) => {
    const { page, limit, skip } = getPagination(req.query);
    const where: Record<string, unknown> = {};
    if (typeof req.query.status === 'string') where.status = req.query.status;
    if (typeof req.query.driverId === 'string') where.driverId = req.query.driverId;
    const [data, total] = await adminRepos.logistics().findAndCount({
      where,
      relations: { order: true, driver: true },
      order: { createdAt: 'DESC' },
      skip,
      take: limit,
    });
    sendSuccess(res, paginated(data, total, page, limit));
  };

  drivers = async (req: Request, res: Response) => {
    const search = typeof req.query.search === 'string' ? req.query.search.toLowerCase() : undefined;
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const stateCode = normalizeStateCode(req.query.stateCode);
    const where: Record<string, unknown> = { role: UserRole.EV_DRIVER };
    if (status === 'active') where.isActive = true;
    if (status === 'inactive') where.isActive = false;
    if (stateCode) where.operationalStateCode = stateCode;
    const allDrivers = await adminRepos.users().find({ where, order: { createdAt: 'DESC' } });
    const drivers = search
      ? allDrivers.filter((driver: any) => [driver.email, driver.firstName, driver.lastName].some((value) => String(value || '').toLowerCase().includes(search)))
      : allDrivers;
    const stats = await this.driverStatsData();
    sendSuccess(res, { data: drivers.map(this.safeUser), total: drivers.length, stats });
  };

  driverStats = async (_req: Request, res: Response) => {
    sendSuccess(res, await this.driverStatsData());
  };

  driverDetail = async (req: Request, res: Response) => {
    const driver = await adminRepos.users().findOne({ where: { id: routeParam(req.params.id), role: UserRole.EV_DRIVER } });
    if (!driver) throw new HttpError(404, 'Driver not found');
    const jobs = await adminRepos.logistics().find({
      where: { driverId: driver.id },
      relations: { order: true },
      order: { createdAt: 'DESC' },
      take: 25,
    });
    sendSuccess(res, { ...this.safeUser(driver), jobs });
  };

  createDriver = async (req: Request, res: Response) => {
    const users = adminRepos.users();
    const existing = await users.findOne({ where: { email: req.body.email } });
    if (existing) throw new HttpError(400, 'Email already in use');
    const state = req.body.stateCode ? await resolveActiveOperationalState(req.body.stateCode) : undefined;
    const driver = await users.save(users.create({
      email: req.body.email,
      phone: req.body.phone,
      password: await hashPassword(req.body.password || '123456'),
      firstName: req.body.firstName,
      lastName: req.body.lastName,
      role: UserRole.EV_DRIVER,
      operationalStateCode: state?.stateCode,
      operationalStateName: state?.stateName,
      isActive: req.body.isActive,
      isEmailVerified: true,
    }));
    sendCreated(res, this.safeUser(driver));
  };

  toggleDriver = async (req: Request, res: Response) => {
    const users = adminRepos.users();
    const driver = await users.findOne({ where: { id: routeParam(req.params.id), role: UserRole.EV_DRIVER } });
    if (!driver) throw new HttpError(404, 'Driver not found');
    driver.isActive = !driver.isActive;
    await users.save(driver);
    sendSuccess(res, { id: driver.id, isActive: driver.isActive });
  };

  private safeUser(user: any) {
    const { password, refreshToken, ...safe } = user;
    return safe;
  }

  private async driverStatsData() {
    const users = adminRepos.users();
    const logistics = adminRepos.logistics();
    const [total, active, inactive, onDelivery] = await Promise.all([
      users.count({ where: { role: UserRole.EV_DRIVER } }),
      users.count({ where: { role: UserRole.EV_DRIVER, isActive: true } }),
      users.count({ where: { role: UserRole.EV_DRIVER, isActive: false } }),
      logistics.count({ where: { status: LogisticsStatus.IN_TRANSIT } }),
    ]);
    return { total, active, inactive, onDelivery };
  };
}
