import { Request, Response } from "express";
import { DELIVERY_SLA_HOURS, OrderStatus, PaymentStatus } from "@lib/constants";
import { auditAdminAction } from "@lib/audit";
import { EmailService } from "@emails/email.service";
import { getEmailSettings } from "@services/email-settings.service";
import { HttpError, sendCreated, sendSuccess } from "@utils/http";
import {
  adminRepos,
  getPagination,
  paginated,
  routeParam,
} from "./admin.helpers";
import { publicOrder } from "@lib/public-resource";
import { Order } from "@models/orders/order.model";
import { isValidObjectId } from "mongoose";
import { OrderItem } from "@models/orders/order-item.model";
import { Logistics } from "@models/logistics/logistics.model";
import { User } from "@models/users/user.model";
import { adminOrderStatsCache } from "@lib/ttl-cache";
import { OrderFulfilmentGroup } from "@models/orders/order-fulfilment-group.model";
import { Payment } from "@models/payments/payment.model";

export class AdminOrdersController {
  private readonly email = new EmailService();

  private async enrichOrder(order: any) {
    if (!order) return order;
    const [items, payments, fulfilmentGroups, logistics, escrowLedger] = await Promise.all([
      adminRepos
        .orderItems()
        .find({ where: { orderId: order.id }, relations: { product: true } }),
      Payment.find({ orderId: order.id }).lean({ virtuals: true }),
      OrderFulfilmentGroup.find({ orderId: order.id }).sort({ createdAt: 1 }).lean({ virtuals: true }),
      adminRepos.logistics().findOne({ where: { orderId: order.id } }),
      adminRepos
        .escrowLedger()
        .find({ where: { orderId: order.id }, order: { createdAt: "ASC" } }),
    ]);
    return { ...order, items, payment: payments[0], payments, fulfilmentGroups, logistics, escrowLedger };
  }

  list = async (req: Request, res: Response) => {
    const { page, limit, skip } = getPagination(req.query);
    const search =
      typeof req.query.search === "string"
        ? req.query.search.toLowerCase()
        : undefined;
    const where: Record<string, any> = {};
    if (typeof req.query.status === "string") {
      if (req.query.status === "active") {
        where.status = {
          $nin: [
            OrderStatus.DELIVERED,
            OrderStatus.CANCELLED,
            OrderStatus.RETURNED,
            OrderStatus.REFUNDED,
          ],
        };
      } else {
        where.status = req.query.status;
      }
    }
    if (typeof req.query.paymentStatus === "string")
      where.paymentStatus = req.query.paymentStatus;
    if (typeof req.query.paymentMode === "string")
      where.paymentMode = req.query.paymentMode;
    if (typeof req.query.orderType === "string")
      where.orderType = req.query.orderType;
    const scope = req.user?.scopeType === "global"
      ? {}
      : { $or: [
          { sourceStateId: { $in: req.user?.assignedStateIds || [] } },
          { sourceStateIds: { $in: req.user?.assignedStateIds || [] } },
        ] };
    Object.assign(where, scope);
    const expression = search
      ? new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")
      : undefined;
    const searchUsers = expression
      ? await User.find({
          $or: [{ email: expression }, { firstName: expression }, { lastName: expression }],
        }).select("publicId firstName lastName email").limit(50).lean({ virtuals: true })
      : [];
    if (search) {
      where.$or = [
        { orderCode: expression },
        ...((searchUsers as any[]).length
          ? [{ userId: { $in: (searchUsers as any[]).flatMap((user) => [String(user._id), user.publicId].filter(Boolean)) } }]
          : []),
      ];
    }
    const orderFields = "publicId orderCode userId subtotal deliveryFee discount total status paymentStatus paymentMode orderType createdAt updatedAt commerceStatus commercePaymentStatus sourceStateId sourceStateIds fulfilmentGroupIds deliveryAddress deliverySubsidy";
    const [orders, total, stats] = await Promise.all([
      Order.find(where).select(orderFields).sort({ createdAt: -1 }).skip(skip).limit(limit).lean({ virtuals: true }),
      Order.countDocuments(where),
      this.statsData(),
    ]);
    const orderIds = (orders as any[]).map((order) => String(order._id || order.id));
    const userIds = [...new Set((orders as any[]).map((order) => String(order.userId || "")).filter(Boolean))];
    const userFilters = userIds.flatMap((id) => [
      ...(isValidObjectId(id) ? [{ _id: id }] : []),
      { publicId: id },
    ]);
    const [users, items, logistics] = await Promise.all([
      userFilters.length
        ? User.find({ $or: userFilters }).select("publicId firstName lastName email phone").lean({ virtuals: true })
        : [],
      orderIds.length
        ? OrderItem.find({ orderId: { $in: orderIds } }).select("orderId productId productTitle productImage quantity unitPrice totalPrice selectedVariants").lean({ virtuals: true })
        : [],
      orderIds.length
        ? Logistics.find({ orderId: { $in: orderIds } }).select("orderId estimatedDeliveryAt status trackingNumber provider").lean({ virtuals: true })
        : [],
    ]);
    const userMap = new Map((users as any[]).flatMap((user) => [[String(user._id), user], [String(user.publicId), user]]));
    const itemMap = new Map<string, any[]>();
    (items as any[]).forEach((item) => itemMap.set(String(item.orderId), [...(itemMap.get(String(item.orderId)) || []), item]));
    const logisticsMap = new Map<string, any>();
    (logistics as any[]).forEach((item) => logisticsMap.set(String(item.orderId), item));
    const data = (orders as any[]).map((order) => {
      const { _id, ...safeOrder } = order;
      const key = String(_id || order.id);
      return {
        ...safeOrder,
        user: userMap.get(String(order.userId)),
        items: itemMap.get(key) || [],
        logistics: logisticsMap.get(key),
      };
    });
    sendSuccess(res, {
      ...paginated(data.map(publicOrder), total, page, limit),
      stats,
    });
  };

  stats = async (_req: Request, res: Response) => {
    sendSuccess(res, await this.statsData());
  };

  detail = async (req: Request, res: Response) => {
    const identifier = routeParam(req.params.id);
    const identity = isValidObjectId(identifier)
      ? {
          $or: [
            { _id: identifier },
            { publicId: identifier },
            { orderCode: identifier },
          ],
        }
      : { $or: [{ publicId: identifier }, { orderCode: identifier }] };
    const scope =
      req.user?.scopeType === "global"
        ? {}
        : { $or: [
            { sourceStateId: { $in: req.user?.assignedStateIds || [] } },
            { sourceStateIds: { $in: req.user?.assignedStateIds || [] } },
          ] };
    const order = await Order.findOne({ ...identity, ...scope }).lean({
      virtuals: true,
    });
    if (!order) throw new HttpError(404, "Order not found");
    sendSuccess(res, publicOrder(await this.enrichOrder(order)));
  };

  status = async (req: Request, res: Response) => {
    const orders = adminRepos.orders();
    const order = await orders.findOne({
      where: { id: routeParam(req.params.id) },
    });
    if (!order) throw new HttpError(404, "Order not found");
    const next = req.body.status || order.status;
    const allowed: Record<string, string[]> = {
      pending: ["cancelled"],
      confirmed: ["shipped", "cancelled"],
      shipped: ["delivered"],
      delivered: [],
      cancelled: ["refunded"],
      refunded: [],
    };
    if (
      next !== order.status &&
      !(allowed[order.status] || []).includes(next)
    ) {
      throw new HttpError(
        409,
        `Order cannot move from ${order.status} to ${next}`,
      );
    }
    if (
      next === OrderStatus.DELIVERED &&
      order.paymentMode === "pay_on_delivery" &&
      order.paymentStatus !== PaymentStatus.SUCCESSFUL
    ) {
      throw new HttpError(
        409,
        "Pay on Delivery must be collected before completing delivery",
      );
    }
    order.status = next;
    if (order.status === OrderStatus.DELIVERED) order.deliveredAt = new Date();
    await orders.save(order);
    await auditAdminAction(req, "order.status", "order", order.id, {
      status: order.status,
    });
    const customer = order.userId
      ? await adminRepos.users().findOne({ where: { id: order.userId } })
      : undefined;
    const customerEmail = customer?.email || order.guestEmail;
    const customerName =
      `${customer?.firstName || ""} ${customer?.lastName || ""}`.trim() ||
      order.guestName;
    if (customerEmail) {
      await this.email.sendOrderStatusUpdate({
        to: customerEmail,
        name: customerName,
        orderCode: order.orderCode,
        amount: order.total,
        status: order.status,
      });
    }
    sendSuccess(res, publicOrder(order as any));
  };

  update = async (req: Request, res: Response) => {
    const orders = adminRepos.orders();
    const order = await orders.findOne({
      where: { id: routeParam(req.params.id) },
      relations: { items: true },
    });
    if (!order) throw new HttpError(404, "Order not found");
    const nextSubtotal = Number(order.subtotal || 0);
    const nextDeliveryFee = req.body.deliveryFee ?? order.deliveryFee;
    const nextDiscount = req.body.discount ?? order.discount;
    Object.assign(order, {
      deliveryAddress: req.body.deliveryAddress ?? order.deliveryAddress,
      deliveryFee: nextDeliveryFee,
      discount: nextDiscount,
      total: Math.max(
        0,
        nextSubtotal + Number(nextDeliveryFee || 0) - Number(nextDiscount || 0),
      ),
      deliveryNotes: req.body.deliveryNotes ?? order.deliveryNotes,
      scheduledDeliveryAt:
        req.body.scheduledDeliveryAt ?? order.scheduledDeliveryAt,
      paymentStatus: req.body.paymentStatus ?? order.paymentStatus,
      status: req.body.status ?? order.status,
    });
    if (order.status === OrderStatus.DELIVERED && !order.deliveredAt)
      order.deliveredAt = new Date();
    await orders.save(order);
    await auditAdminAction(req, "order.update", "order", order.id, {
      fields: Object.keys(req.body),
    });
    sendSuccess(
      res,
      publicOrder(
        await this.enrichOrder(
          await orders.findOne({
            where: { id: order.id },
            relations: { user: true },
          }),
        ),
      ),
    );
  };

  create = async (req: Request, res: Response) => {
    const users = adminRepos.users();
    const orders = adminRepos.orders();
    const orderItems = adminRepos.orderItems();
    const products = adminRepos.products();
    const logistics = adminRepos.logistics();
    const customer = await users.findOne({ where: { id: req.body.userId } });
    if (!customer) throw new HttpError(404, "Customer not found");

    const lines: Array<{
      product: any;
      quantity: number;
      selectedVariants?: Record<string, unknown>;
      unitPrice: number;
      totalPrice: number;
    }> = [];
    for (const item of req.body.items) {
      const product = await products.findOne({ where: { id: item.productId } });
      if (!product)
        throw new HttpError(404, `Product not found: ${item.productId}`);
      if (product.quantity < item.quantity)
        throw new HttpError(
          400,
          `${product.title} only has ${product.quantity} in stock`,
        );
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
    const legacySourceIds = [
      ...new Set(lines.map((item) => item.product.vendorId).filter(Boolean)),
    ];
    const order = await orders.save(
      orders.create({
        orderCode: `HK-${Date.now().toString().slice(-8)}`,
        userId: customer.id,
        subtotal,
        deliveryFee,
        discount,
        total,
        vendorCount: legacySourceIds.length,
        status: req.body.status || OrderStatus.PENDING,
        paymentStatus: req.body.paymentStatus || PaymentStatus.UNPAID,
        deliveryAddress: req.body.deliveryAddress,
        deliveryNotes: req.body.deliveryNotes,
        scheduledDeliveryAt: req.body.scheduledDeliveryAt,
      }),
    );

    await Promise.all(
      lines.map(async (line) => {
        await orderItems.save(
          orderItems.create({
            orderId: order.id,
            productId: line.product.id,
            productTitle: line.product.title,
            productImage: line.product.images?.[0],
            vendorId: line.product.vendorId,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            totalPrice: line.totalPrice,
            selectedVariants: line.selectedVariants,
            commissionAmount: 0,
          }),
        );
        await products.update(line.product.id, {
          quantity: Math.max(0, line.product.quantity - line.quantity),
          orderCount: line.product.orderCount + 1,
        });
      }),
    );

    await logistics.save(
      logistics.create({
        orderId: order.id,
        deliveryLocation: {
          address: `${req.body.deliveryAddress.street}, ${req.body.deliveryAddress.city}, ${req.body.deliveryAddress.state}`,
          coordinates: req.body.deliveryAddress.coordinates || {
            lat: 0,
            lng: 0,
          },
          instructions: req.body.deliveryNotes,
        },
        estimatedDeliveryAt: new Date(
          Date.now() + DELIVERY_SLA_HOURS * 60 * 60 * 1000,
        ),
      }),
    );
    await auditAdminAction(req, "order.create", "order", order.id, {
      orderCode: order.orderCode,
    });
    const itemCount = lines.reduce(
      (sum, item) => sum + Number(item.quantity || 0),
      0,
    );
    if (customer.email) {
      await this.email.sendOrderConfirmation({
        to: customer.email,
        name: `${customer.firstName || ""} ${customer.lastName || ""}`.trim(),
        orderCode: order.orderCode,
        amount: order.total,
        itemCount,
      });
    }
    const hookOpsEmail = (await getEmailSettings()).hookOpsEmail;
    if (hookOpsEmail) {
      await this.email.sendHookNewOrder({
        to: hookOpsEmail,
        customerName: customer.email || "Customer",
        orderCode: order.orderCode,
        amount: order.total,
        itemCount,
      });
    }
    sendCreated(
      res,
      publicOrder(
        await this.enrichOrder(
          await orders.findOne({
            where: { id: order.id },
            relations: { user: true },
          }),
        ),
      ),
    );
  };

  private async statsData() {
    const cached = adminOrderStatsCache.get('summary');
    if (cached) return cached;
    const orders = adminRepos.orders();
    const [revenueRow] = await orders.aggregate<{ total: number }>([
      { $group: { _id: null, total: { $sum: "$total" } } },
    ]);
    const [total, pending, inTransit, delivered, cancelled, unpaid] =
      await Promise.all([
        orders.count(),
        orders.count({ where: { status: OrderStatus.PENDING } }),
        orders.count({ where: { status: OrderStatus.SHIPPED } }),
        orders.count({ where: { status: OrderStatus.DELIVERED } }),
        orders.count({ where: { status: OrderStatus.CANCELLED } }),
        orders.count({ where: { paymentStatus: PaymentStatus.UNPAID } }),
      ]);
    return adminOrderStatsCache.set('summary', {
      total,
      pending,
      inTransit,
      delivered,
      cancelled,
      unpaid,
      revenue: Number(revenueRow?.total || 0),
    });
  }
}
