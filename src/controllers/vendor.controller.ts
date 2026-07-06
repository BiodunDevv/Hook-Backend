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
import { sendCreated, sendSuccess } from '@utils/http';

export class VendorController {
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
}
