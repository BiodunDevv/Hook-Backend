import { Request, Response } from 'express';
import { DELIVERY_SLA_HOURS, OrderStatus, PaymentStatus, VENDOR_COMMISSION_PERCENTAGE } from '@lib/constants';
import { auditAdminAction } from '@lib/audit';
import { EmailService } from '@emails/email.service';
import { HttpError, sendCreated, sendSuccess } from '@utils/http';
import { adminRepos, getPagination, paginated, routeParam } from './admin.helpers';

export class AdminOrdersController {
  private readonly email = new EmailService();

  private async enrichOrder(order: any) {
    if (!order) return order;
    const [items, payment, logistics] = await Promise.all([
      adminRepos.orderItems().find({ where: { orderId: order.id }, relations: { product: true, vendor: true } }),
      adminRepos.payments().findOne({ where: { orderId: order.id } }),
      adminRepos.logistics().findOne({ where: { orderId: order.id }, relations: { driver: true } }),
    ]);
    return { ...order, items, payment, logistics };
  }

  list = async (req: Request, res: Response) => {
    const { page, limit, skip } = getPagination(req.query);
    const search = typeof req.query.search === 'string' ? req.query.search.toLowerCase() : undefined;
    const where: Record<string, unknown> = {};
    if (typeof req.query.status === 'string') {
      if (req.query.status === 'active') {
        where.status = { $nin: [
            OrderStatus.DELIVERED,
            OrderStatus.CANCELLED,
            OrderStatus.RETURNED,
            OrderStatus.REFUNDED,
          ] };
      } else {
        where.status = req.query.status;
      }
    }
    if (typeof req.query.paymentStatus === 'string') where.paymentStatus = req.query.paymentStatus;
    const all = await adminRepos.orders().find({ where, relations: { user: true }, order: { createdAt: 'DESC' } });
    let filtered = all as any[];
    if (typeof req.query.driverId === 'string') {
      const jobs = await adminRepos.logistics().find({ where: { driverId: req.query.driverId } });
      const orderIds = new Set(jobs.map((job) => job.orderId));
      filtered = filtered.filter((order) => orderIds.has(order.id));
    }
    if (search) {
      filtered = filtered.filter((order) => [
        order.orderCode,
        order.guestEmail,
        order.guestName,
        order.user?.email,
        order.user?.firstName,
        order.user?.lastName,
      ].some((value) => String(value || '').toLowerCase().includes(search)));
    }
    const data = await Promise.all(filtered.slice(skip, skip + limit).map((order) => this.enrichOrder(order)));
    const stats = await this.statsData();
    sendSuccess(res, { ...paginated(data, filtered.length, page, limit), stats });
  };

  stats = async (_req: Request, res: Response) => {
    sendSuccess(res, await this.statsData());
  };

  detail = async (req: Request, res: Response) => {
    const order = await adminRepos.orders().findOne({
      where: { id: routeParam(req.params.id) },
      relations: { user: true, items: true, payment: true, logistics: true },
    });
    if (!order) throw new HttpError(404, 'Order not found');
    sendSuccess(res, await this.enrichOrder(order));
  };

  status = async (req: Request, res: Response) => {
    const orders = adminRepos.orders();
    const order = await orders.findOne({ where: { id: routeParam(req.params.id) } });
    if (!order) throw new HttpError(404, 'Order not found');
    order.status = req.body.status || order.status;
    if (order.status === OrderStatus.DELIVERED) order.deliveredAt = new Date();
    await orders.save(order);
    await auditAdminAction(req, 'order.status', 'order', order.id, { status: order.status });
    const customer = order.userId ? await adminRepos.users().findOne({ where: { id: order.userId } }) : undefined;
    const customerEmail = customer?.email || order.guestEmail;
    const customerName = `${customer?.firstName || ''} ${customer?.lastName || ''}`.trim() || order.guestName;
    if (customerEmail) {
      await this.email.sendOrderStatusUpdate({
        to: customerEmail,
        name: customerName,
        orderCode: order.orderCode,
        amount: order.total,
        status: order.status,
      });
    }
    sendSuccess(res, order);
  };

  update = async (req: Request, res: Response) => {
    const orders = adminRepos.orders();
    const order = await orders.findOne({ where: { id: routeParam(req.params.id) }, relations: { items: true } });
    if (!order) throw new HttpError(404, 'Order not found');
    const nextSubtotal = Number(order.subtotal || 0);
    const nextDeliveryFee = req.body.deliveryFee ?? order.deliveryFee;
    const nextDiscount = req.body.discount ?? order.discount;
    Object.assign(order, {
      deliveryAddress: req.body.deliveryAddress ?? order.deliveryAddress,
      deliveryFee: nextDeliveryFee,
      discount: nextDiscount,
      total: Math.max(0, nextSubtotal + Number(nextDeliveryFee || 0) - Number(nextDiscount || 0)),
      deliveryNotes: req.body.deliveryNotes ?? order.deliveryNotes,
      scheduledDeliveryAt: req.body.scheduledDeliveryAt ?? order.scheduledDeliveryAt,
      paymentStatus: req.body.paymentStatus ?? order.paymentStatus,
      status: req.body.status ?? order.status,
    });
    if (order.status === OrderStatus.DELIVERED && !order.deliveredAt) order.deliveredAt = new Date();
    await orders.save(order);
    await auditAdminAction(req, 'order.update', 'order', order.id, { fields: Object.keys(req.body) });
    sendSuccess(res, await this.enrichOrder(await orders.findOne({
      where: { id: order.id },
      relations: { user: true },
    })));
  };

  create = async (req: Request, res: Response) => {
    const users = adminRepos.users();
    const orders = adminRepos.orders();
    const orderItems = adminRepos.orderItems();
    const products = adminRepos.products();
    const logistics = adminRepos.logistics();
    const customer = await users.findOne({ where: { id: req.body.userId } });
    if (!customer) throw new HttpError(404, 'Customer not found');

    const lines: Array<{
      product: any;
      quantity: number;
      selectedVariants?: Record<string, unknown>;
      unitPrice: number;
      totalPrice: number;
    }> = [];
    for (const item of req.body.items) {
      const product = await products.findOne({ where: { id: item.productId }, relations: { vendor: true } });
      if (!product) throw new HttpError(404, `Product not found: ${item.productId}`);
      if (product.quantity < item.quantity) throw new HttpError(400, `${product.title} only has ${product.quantity} in stock`);
      const unitPrice = product.discountedPrice || product.sellingPrice;
      lines.push({
        product,
        quantity: item.quantity,
        selectedVariants: item.selectedVariants,
        unitPrice,
        totalPrice: unitPrice * item.quantity,
      });
    }

    const subtotal = lines.reduce((sum, item) => sum + item.totalPrice, 0);
    const deliveryFee = Number(req.body.deliveryFee || 0);
    const discount = Number(req.body.discount || 0);
    const total = Math.max(0, subtotal + deliveryFee - discount);
    const vendorIds = [...new Set(lines.map((item) => item.product.vendorId))];
    const order = await orders.save(orders.create({
      orderCode: `HK-${Date.now().toString().slice(-8)}`,
      userId: customer.id,
      subtotal,
      deliveryFee,
      discount,
      total,
      vendorCount: vendorIds.length,
      status: req.body.status || OrderStatus.PENDING,
      paymentStatus: req.body.paymentStatus || PaymentStatus.UNPAID,
      deliveryAddress: req.body.deliveryAddress,
      deliveryNotes: req.body.deliveryNotes,
      scheduledDeliveryAt: req.body.scheduledDeliveryAt,
    }));

    await Promise.all(lines.map(async (line) => {
      await orderItems.save(orderItems.create({
        orderId: order.id,
        productId: line.product.id,
        productTitle: line.product.title,
        productImage: line.product.images?.[0],
        vendorId: line.product.vendorId,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        totalPrice: line.totalPrice,
        selectedVariants: line.selectedVariants,
        commissionAmount: line.totalPrice * (VENDOR_COMMISSION_PERCENTAGE / 100),
      }));
      await products.update(line.product.id, {
        quantity: Math.max(0, line.product.quantity - line.quantity),
        orderCount: line.product.orderCount + 1,
      });
    }));

    await logistics.save(logistics.create({
      orderId: order.id,
      deliveryLocation: {
        address: `${req.body.deliveryAddress.street}, ${req.body.deliveryAddress.city}, ${req.body.deliveryAddress.state}`,
        coordinates: req.body.deliveryAddress.coordinates || { lat: 0, lng: 0 },
        instructions: req.body.deliveryNotes,
      },
      estimatedDeliveryAt: new Date(Date.now() + DELIVERY_SLA_HOURS * 60 * 60 * 1000),
    }));
    await auditAdminAction(req, 'order.create', 'order', order.id, { orderCode: order.orderCode });
    const itemCount = lines.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
    if (customer.email) {
      await this.email.sendOrderConfirmation({
        to: customer.email,
        name: `${customer.firstName || ''} ${customer.lastName || ''}`.trim(),
        orderCode: order.orderCode,
        amount: order.total,
        itemCount,
      });
    }
    const hookOpsEmail = process.env.HOOK_OPS_EMAIL || process.env.BREVO_FROM_EMAIL;
    if (hookOpsEmail) {
      await this.email.sendHookNewOrder({
        to: hookOpsEmail,
        customerName: customer.email || 'Customer',
        orderCode: order.orderCode,
        amount: order.total,
        itemCount,
      });
    }
    await Promise.all(vendorIds.map(async (vendorId) => {
      const vendor = await adminRepos.vendors().findOne({ where: { id: vendorId } });
      const owner = vendor?.ownerId ? await adminRepos.users().findOne({ where: { id: vendor.ownerId } }) : undefined;
      if (!vendor || !owner?.email) return;
      const vendorLines = lines.filter((line) => line.product.vendorId === vendorId);
      await this.email.sendVendorNewOrder({
        to: owner.email,
        name: `${owner.firstName || ''} ${owner.lastName || ''}`.trim(),
        vendorName: vendor.businessName,
        customerName: customer.email || 'Customer',
        orderCode: order.orderCode,
        amount: vendorLines.reduce((sum, line) => sum + Number(line.totalPrice || 0), 0),
        itemCount: vendorLines.reduce((sum, line) => sum + Number(line.quantity || 0), 0),
      });
    }));

    sendCreated(res, await this.enrichOrder(await orders.findOne({
      where: { id: order.id },
      relations: { user: true },
    })));
  };

  assignDriver = async (req: Request, res: Response) => {
    const order = await adminRepos.orders().findOne({ where: { id: routeParam(req.params.id) }, relations: { logistics: true } });
    if (!order) throw new HttpError(404, 'Order not found');
    const driver = await adminRepos.users().findOne({ where: { id: req.body.driverId } });
    if (!driver) throw new HttpError(404, 'Driver not found');
    const logisticsRepo = adminRepos.logistics();
    const existingLogistics = await logisticsRepo.findOne({ where: { orderId: order.id } });
    const logistics = existingLogistics || logisticsRepo.create({
      orderId: order.id,
      deliveryLocation: {
        address: `${order.deliveryAddress.street}, ${order.deliveryAddress.city}, ${order.deliveryAddress.state}`,
        coordinates: order.deliveryAddress.coordinates || { lat: 0, lng: 0 },
        instructions: order.deliveryNotes,
      },
      estimatedDeliveryAt: new Date(Date.now() + DELIVERY_SLA_HOURS * 60 * 60 * 1000),
    });
    logistics.driverId = driver.id;
    await logisticsRepo.save(logistics);
    await auditAdminAction(req, 'order.assign_driver', 'order', order.id, { driverId: driver.id });
    sendSuccess(res, await logisticsRepo.findOne({ where: { orderId: order.id }, relations: { order: true, driver: true } }));
  };

  private async statsData() {
    const orders = adminRepos.orders();
    const [revenueRow] = await orders.aggregate<{ total: number }>([
      { $group: { _id: null, total: { $sum: '$total' } } },
    ]);
    const [total, pending, inTransit, delivered, cancelled, unpaid] = await Promise.all([
      orders.count(),
      orders.count({ where: { status: OrderStatus.PENDING } }),
      orders.count({ where: { status: OrderStatus.IN_TRANSIT } }),
      orders.count({ where: { status: OrderStatus.DELIVERED } }),
      orders.count({ where: { status: OrderStatus.CANCELLED } }),
      orders.count({ where: { paymentStatus: PaymentStatus.UNPAID } }),
    ]);
    return { total, pending, inTransit, delivered, cancelled, unpaid, revenue: Number(revenueRow?.total || 0) };
  }
}
