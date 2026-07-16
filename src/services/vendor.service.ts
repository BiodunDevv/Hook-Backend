import type { MongoRepository as Repository } from '@lib/mongo-repository';
import { OrderStatus, ProductStatus, UserRole, VendorTier } from '@lib/constants';
import { Product } from '@models/products/product.model';
import { Order } from '@models/orders/order.model';
import { OrderItem } from '@models/orders/order-item.model';
import { Settlement } from '@models/settlements/settlement.model';
import { User } from '@models/users/user.model';
import { Vendor } from '@models/vendors/vendor.model';
import { HttpError } from '@utils/http';

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

export class VendorService {
  constructor(
    private readonly users: Repository<User>,
    private readonly vendors: Repository<Vendor>,
    private readonly products: Repository<Product>,
    private readonly orders: Repository<Order>,
    private readonly orderItems: Repository<OrderItem>,
    private readonly settlements: Repository<Settlement>,
  ) {}

  async register(ownerId: string, body: Partial<Vendor>) {
    const existing = await this.vendors.findOne({ where: { ownerId } });
    if (existing) return existing;
    const vendor = await this.vendors.save(this.vendors.create({
      ownerId,
      businessName: body.businessName || 'Hook Vendor',
      businessEmail: body.businessEmail,
      businessPhone: body.businessPhone,
      businessAddress: body.businessAddress,
      description: body.description,
      tier: VendorTier.TIER_3,
      isApproved: false,
    }));
    await this.users.update(ownerId, { role: UserRole.VENDOR });
    return vendor;
  }

  async profile(ownerId: string) {
    const vendor = await this.vendors.findOne({ where: { ownerId }, relations: { products: true } });
    if (!vendor) throw new HttpError(404, 'Vendor profile not found');
    return vendor;
  }

  async updateProfile(ownerId: string, body: Partial<Vendor>) {
    const vendor = await this.profile(ownerId);
    Object.assign(vendor, body);
    return this.vendors.save(vendor);
  }

  async createProduct(ownerId: string, body: Partial<Product>) {
    const vendor = await this.profile(ownerId);
    const baseSlug = slugify(body.title || 'product');
    const product = this.products.create({
      ...body,
      vendorId: vendor.id,
      slug: `${baseSlug}-${Date.now().toString().slice(-5)}`,
      status: ProductStatus.PENDING_APPROVAL,
      hookId: `HK-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    });
    return this.products.save(product);
  }

  async listProducts(ownerId: string) {
    const vendor = await this.profile(ownerId);
    return this.products.find({ where: { vendorId: vendor.id }, relations: { category: true }, order: { createdAt: 'DESC' } });
  }

  async updateProduct(ownerId: string, id: string, body: Partial<Product>) {
    const vendor = await this.profile(ownerId);
    const product = await this.products.findOne({ where: { id, vendorId: vendor.id } });
    if (!product) throw new HttpError(404, 'Product not found');
    Object.assign(product, body, { status: ProductStatus.PENDING_APPROVAL });
    return this.products.save(product);
  }

  async ordersForVendor(ownerId: string) {
    const vendor = await this.profile(ownerId);
    const items = await this.orderItems.find({ where: { vendorId: vendor.id } });
    const orderIds = [...new Set(items.map((item) => item.orderId))];
    const orders = await Promise.all(orderIds.map((orderId) => this.orders.findOne({ where: { id: orderId }, relations: { user: true } })));
    return orders.filter((order): order is Order => Boolean(order && order.status !== OrderStatus.AWAITING_PAYMENT))
      .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async settlementsForVendor(ownerId: string) {
    const vendor = await this.profile(ownerId);
    const data = await this.settlements.find({ where: { vendorId: vendor.id }, order: { createdAt: 'DESC' } });
    return {
      data,
      summary: {
        total: data.reduce((sum, item) => sum + item.netAmount, 0),
        pending: data.filter((item) => item.status === 'pending_escrow').reduce((sum, item) => sum + item.netAmount, 0),
        paid: data.filter((item) => item.status === 'paid').reduce((sum, item) => sum + item.netAmount, 0),
      },
    };
  }

  async updateBank(ownerId: string, bankDetails: Vendor['bankDetails']) {
    const vendor = await this.profile(ownerId);
    vendor.bankDetails = bankDetails;
    return this.vendors.save(vendor);
  }
}
