import { Request, Response } from 'express';
import { AppDataSource } from '@config/data-source';
import { Order } from '@models/orders/order.model';
import { OrderItem } from '@models/orders/order-item.model';
import { Product } from '@models/products/product.model';
import { Settlement } from '@models/settlements/settlement.model';
import { User } from '@models/users/user.model';
import { Vendor } from '@models/vendors/vendor.model';
import { VendorService } from '@services/vendor.service';
import { routeParam } from '@lib/api-utils';
import { HttpError, sendCreated, sendSuccess } from '@utils/http';
import { FulfilmentService } from '@services/fulfilment.service';

export class VendorController {
  private readonly fulfilments = new FulfilmentService();
  private readonly vendors = new VendorService(
    AppDataSource.getRepository(User),
    AppDataSource.getRepository(Vendor),
    AppDataSource.getRepository(Product),
    AppDataSource.getRepository(Order),
    AppDataSource.getRepository(OrderItem),
    AppDataSource.getRepository(Settlement),
  );

  register = async (req: Request, res: Response) => {
    sendCreated(res, await this.vendors.register(req.user!.sub, req.body));
  };

  profile = async (req: Request, res: Response) => {
    sendSuccess(res, await this.vendors.profile(req.user!.sub));
  };

  updateProfile = async (req: Request, res: Response) => {
    sendSuccess(res, await this.vendors.updateProfile(req.user!.sub, req.body));
  };

  products = async (req: Request, res: Response) => {
    sendSuccess(res, await this.vendors.listProducts(req.user!.sub));
  };

  createProduct = async (req: Request, res: Response) => {
    sendCreated(res, await this.vendors.createProduct(req.user!.sub, req.body));
  };

  updateProduct = async (req: Request, res: Response) => {
    sendSuccess(res, await this.vendors.updateProduct(req.user!.sub, routeParam(req.params.id), req.body));
  };

  orders = async (req: Request, res: Response) => {
    sendSuccess(res, await this.vendors.ordersForVendor(req.user!.sub));
  };

  settlements = async (req: Request, res: Response) => {
    sendSuccess(res, await this.vendors.settlementsForVendor(req.user!.sub));
  };

  bankDetails = async (req: Request, res: Response) => {
    sendSuccess(res, await this.vendors.updateBank(req.user!.sub, req.body));
  };

  decideFulfilment = async (req: Request, res: Response) => {
    const vendor = await AppDataSource.getRepository(Vendor).findOne({ where: { ownerId: req.user!.sub } });
    if (!vendor) throw new HttpError(404, 'Vendor profile not found');
    const decision = routeParam(req.params.decision);
    if (!['confirmed', 'rejected'].includes(decision)) throw new HttpError(400, 'Invalid fulfilment decision');
    sendSuccess(res, await this.fulfilments.decide({
      orderId: routeParam(req.params.orderId), vendorId: vendor.id,
      decision: decision as 'confirmed' | 'rejected', actorId: req.user!.sub,
      reason: req.body.reason, idempotencyKey: req.body.idempotencyKey,
    }));
  };
}
