import { Request, Response } from 'express';
import { HttpError, sendSuccess } from '@utils/http';
import { adminRepos, getPagination, paginated, routeParam } from './admin.helpers';

export class AdminVendorsController {
  list = async (req: Request, res: Response) => {
    const { page, limit, skip } = getPagination(req.query);
    const approved = req.query.approved === 'true' ? true : req.query.approved === 'false' ? false : undefined;
    const where = approved === undefined ? {} : { isApproved: approved };
    const [data, total] = await adminRepos.vendors().findAndCount({
      where,
      relations: { owner: true },
      order: { createdAt: 'DESC' },
      skip,
      take: limit,
    });
    sendSuccess(res, paginated(data, total, page, limit));
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
}
