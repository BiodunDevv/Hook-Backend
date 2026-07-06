import { Request, Response } from 'express';
import { UserRole } from '@lib/constants';
import { hashPassword } from '@lib/security';
import { HttpError, sendCreated, sendSuccess } from '@utils/http';
import { adminRepos, getPagination, paginated, routeParam } from './admin.helpers';

export class AdminVendorsController {
  list = async (req: Request, res: Response) => {
    const { page, limit, skip } = getPagination(req.query);
    const approved = req.query.approved === 'true' ? true : req.query.approved === 'false' ? false : undefined;
    const search = typeof req.query.search === 'string' ? req.query.search.toLowerCase() : undefined;
    const tier = typeof req.query.tier === 'string' ? req.query.tier : undefined;
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const where: Record<string, unknown> = {};
    if (approved !== undefined) where.isApproved = approved;
    if (tier) where.tier = tier;
    if (status === 'active') Object.assign(where, { isActive: true, isApproved: true });
    if (status === 'pending') where.isApproved = false;
    if (status === 'inactive') where.isActive = false;
    const all = await adminRepos.vendors().find({ where, relations: { owner: true }, order: { createdAt: 'DESC' } });
    const filtered = search
      ? all.filter((vendor: any) => [vendor.businessName, vendor.businessEmail, vendor.owner?.email].some((value) => String(value || '').toLowerCase().includes(search)))
      : all;
    const data = filtered.slice(skip, skip + limit);
    const vendorIds = data.map((vendor) => vendor.id);
    const [itemMetrics, productMetrics] = vendorIds.length
      ? await Promise.all([
          adminRepos.orderItems().aggregate<{ vendorId: string; gmv: number; orders: string[] }>([
            { $match: { vendorId: { $in: vendorIds } } },
            { $group: { _id: '$vendorId', gmv: { $sum: '$totalPrice' }, orders: { $addToSet: '$orderId' } } },
            { $project: { _id: 0, vendorId: '$_id', gmv: 1, orders: 1 } },
          ]),
          adminRepos.products().aggregate<{ vendorId: string; products: number }>([
            { $match: { vendorId: { $in: vendorIds } } },
            { $group: { _id: '$vendorId', products: { $sum: 1 } } },
            { $project: { _id: 0, vendorId: '$_id', products: 1 } },
          ]),
        ])
      : [[], []];
    const itemMetricMap = new Map(itemMetrics.map((metric: any) => [metric.vendorId, metric]));
    const productMetricMap = new Map(productMetrics.map((metric: any) => [metric.vendorId, metric]));
    const enriched = data.map((vendor: any) => {
      const itemMetric = itemMetricMap.get(vendor.id);
      const productMetric = productMetricMap.get(vendor.id);
      return {
        ...vendor,
        metrics: {
          gmv: Number(itemMetric?.gmv || 0),
          orders: Number(itemMetric?.orders?.length || 0),
          products: Number(productMetric?.products || 0),
        },
      };
    });
    const stats = await this.statsData();
    sendSuccess(res, { ...paginated(enriched, filtered.length, page, limit), stats });
  };

  stats = async (_req: Request, res: Response) => {
    sendSuccess(res, await this.statsData());
  };

  detail = async (req: Request, res: Response) => {
    const vendor = await adminRepos.vendors().findOne({
      where: { id: routeParam(req.params.id) },
      relations: { owner: true, products: true, settlements: true },
    });
    if (!vendor) throw new HttpError(404, 'Vendor not found');
    const products = await adminRepos.products().find({ where: { vendorId: vendor.id } });
    const [itemTotals] = await adminRepos.orderItems().aggregate<{ gmv: number; orders: string[] }>([
      { $match: { vendorId: vendor.id } },
      { $group: { _id: null, gmv: { $sum: '$totalPrice' }, orders: { $addToSet: '$orderId' } } },
    ]);
    sendSuccess(res, {
      ...vendor,
      metrics: {
        gmv: Number(itemTotals?.gmv || 0),
        orders: Number(itemTotals?.orders?.length || 0),
        products: products.length,
      },
    });
  };

  create = async (req: Request, res: Response) => {
    const users = adminRepos.users();
    const vendors = adminRepos.vendors();
    let owner = await users.findOne({ where: { email: req.body.ownerEmail } });
    if (!owner) {
      owner = await users.save(users.create({
        email: req.body.ownerEmail,
        phone: req.body.ownerPhone,
        password: await hashPassword(req.body.password || '123456'),
        firstName: req.body.ownerFirstName || 'Vendor',
        lastName: req.body.ownerLastName || 'Owner',
        role: UserRole.VENDOR,
        isActive: true,
        isEmailVerified: true,
      }));
    } else {
      owner.role = UserRole.VENDOR;
      owner.isActive = true;
      await users.save(owner);
    }
    if (!owner) throw new HttpError(500, 'Vendor owner could not be created');
    const existing = await vendors.findOne({ where: { ownerId: owner.id } });
    if (existing) throw new HttpError(400, 'This owner already has a vendor profile');
    const vendor = await vendors.save(vendors.create({
      ownerId: owner.id,
      businessName: req.body.businessName,
      businessEmail: req.body.businessEmail,
      businessPhone: req.body.businessPhone,
      businessAddress: req.body.businessAddress,
      description: req.body.description,
      tier: req.body.tier,
      commissionPercentage: req.body.commissionPercentage,
      isApproved: req.body.isApproved,
      approvedAt: req.body.isApproved ? new Date() : undefined,
      isActive: req.body.isActive,
    }));
    sendCreated(res, await vendors.findOne({ where: { id: vendor.id }, relations: { owner: true } }));
  };

  update = async (req: Request, res: Response) => {
    const vendors = adminRepos.vendors();
    const vendor = await vendors.findOne({ where: { id: routeParam(req.params.id) } });
    if (!vendor) throw new HttpError(404, 'Vendor not found');
    Object.assign(vendor, req.body);
    if (req.body.isApproved === true && !vendor.approvedAt) vendor.approvedAt = new Date();
    await vendors.save(vendor);
    sendSuccess(res, await vendors.findOne({ where: { id: vendor.id }, relations: { owner: true } }));
  };

  approve = async (req: Request, res: Response) => {
    const vendors = adminRepos.vendors();
    const vendor = await vendors.findOne({ where: { id: routeParam(req.params.id) } });
    if (!vendor) throw new HttpError(404, 'Vendor not found');
    vendor.isApproved = true;
    vendor.approvedAt = new Date();
    await vendors.save(vendor);
    sendSuccess(res, vendor);
  };

  reject = async (req: Request, res: Response) => {
    const vendors = adminRepos.vendors();
    const vendor = await vendors.findOne({ where: { id: routeParam(req.params.id) } });
    if (!vendor) throw new HttpError(404, 'Vendor not found');
    vendor.isApproved = false;
    await vendors.save(vendor);
    sendSuccess(res, { id: vendor.id, businessName: vendor.businessName, isApproved: false, reason: req.body.reason });
  };

  tier = async (req: Request, res: Response) => {
    const vendors = adminRepos.vendors();
    const vendor = await vendors.findOne({ where: { id: routeParam(req.params.id) } });
    if (!vendor) throw new HttpError(404, 'Vendor not found');
    vendor.tier = req.body.tier || vendor.tier;
    vendor.commissionPercentage = req.body.commissionPercentage ?? vendor.commissionPercentage;
    await vendors.save(vendor);
    sendSuccess(res, vendor);
  };

  toggle = async (req: Request, res: Response) => {
    const vendors = adminRepos.vendors();
    const vendor = await vendors.findOne({ where: { id: routeParam(req.params.id) } });
    if (!vendor) throw new HttpError(404, 'Vendor not found');
    vendor.isActive = !vendor.isActive;
    await vendors.save(vendor);
    sendSuccess(res, { id: vendor.id, isActive: vendor.isActive });
  };

  private async statsData() {
    const vendors = adminRepos.vendors();
    const orderItems = adminRepos.orderItems();
    const [total, active, pending, tierOne, gmv] = await Promise.all([
      vendors.count(),
      vendors.count({ where: { isActive: true, isApproved: true } }),
      vendors.count({ where: { isApproved: false } }),
      vendors.count({ where: { tier: 'tier_1' as any } }),
      orderItems.aggregate<{ total: number }>([
        { $group: { _id: null, total: { $sum: '$totalPrice' } } },
      ]),
    ]);
    return { total, active, pending, tierOne, gmv: Number(gmv?.[0]?.total || 0) };
  }
}
