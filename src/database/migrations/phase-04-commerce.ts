import dotenv from "dotenv";
import mongoose from "mongoose";
import { connectDatabase, disconnectDatabase } from "@config/data-source";
import { Cart } from "@models/cart/cart.model";
import { CartItem } from "@models/cart/cart-item.model";
import { Order } from "@models/orders/order.model";
import { OrderItem } from "@models/orders/order-item.model";
import { Payment } from "@models/payments/payment.model";
import {
  CheckoutPreview,
  CommerceOutboxEvent,
  CommercePolicyVersion,
  CommerceSettings,
  CustomerAddress,
  IntegrationException,
  PaymentWebhookEvent,
  PodCallRecord,
  PodOverride,
} from "@models/commerce/commerce.model";
import { nextPublicId } from "@services/public-id.service";

dotenv.config({ quiet: true });
type Mode = "analyze" | "dry-run" | "execute" | "verify" | "rollback";
const VERSION = 4;
const mode = (process.argv
  .find((arg) => arg.startsWith("--mode="))
  ?.split("=")[1] || "dry-run") as Mode;
if (!["analyze", "dry-run", "execute", "verify", "rollback"].includes(mode))
  throw new Error(`Unsupported migration mode: ${mode}`);

async function counts() {
  return {
    database: mongoose.connection.db?.databaseName,
    carts: await Cart.countDocuments(),
    pendingCarts: await Cart.countDocuments({
      commerceMigrationVersion: { $ne: VERSION },
    } as any),
    orders: await Order.countDocuments(),
    pendingOrders: await Order.countDocuments({
      commerceMigrationVersion: { $ne: VERSION },
    } as any),
    payments: await Payment.countDocuments(),
    pendingPayments: await Payment.countDocuments({
      commerceMigrationVersion: { $ne: VERSION },
    } as any),
    compatibility:
      "Historical Booth, Vendor, gift, OPay, major-unit, and order-code fields are retained read-only.",
  };
}

async function ensureCollections() {
  for (const model of [
    CustomerAddress,
    CheckoutPreview,
    CommerceSettings,
    CommercePolicyVersion,
    PaymentWebhookEvent,
    CommerceOutboxEvent,
    IntegrationException,
    PodCallRecord,
    PodOverride,
  ]) {
    await model.createCollection().catch((error: any) => {
      if (error?.codeName !== "NamespaceExists") throw error;
    });
    await model.createIndexes();
  }
  await Promise.all([
    Cart.createIndexes(),
    CartItem.createIndexes(),
    Order.createIndexes(),
    OrderItem.createIndexes(),
    Payment.createIndexes(),
  ]);
}

async function execute() {
  if (process.env.PHASE_04_MIGRATION_CONFIRMED !== "true")
    throw new Error(
      "Set PHASE_04_MIGRATION_CONFIRMED=true only after a verified mongodump backup and dry run",
    );
  await ensureCollections();
  for (const cart of await Cart.find({
    commerceMigrationVersion: { $ne: VERSION },
  } as any)) {
    if (!cart.publicId) cart.publicId = await nextPublicId("cart");
    cart.ownerType =
      cart.customerId || cart.userId
        ? "customer"
        : cart.guestSessionId
          ? "guest"
          : cart.partnerId
            ? "partner_assisted"
            : "guest";
    (cart as any).commerceMigrationVersion = VERSION;
    await cart.save();
  }
  for (const item of await CartItem.find({
    commerceMigrationVersion: { $ne: VERSION },
  } as any)) {
    if (!item.publicId) item.publicId = await nextPublicId("cartItem");
    item.unitPriceMinor =
      item.unitPriceMinor ?? Math.round(Number(item.unitPrice || 0) * 100);
    item.totalPriceMinor =
      item.totalPriceMinor ?? Math.round(Number(item.totalPrice || 0) * 100);
    item.currency = item.currency || "NGN";
    (item as any).commerceMigrationVersion = VERSION;
    await item.save();
  }
  for (const order of await Order.find({
    commerceMigrationVersion: { $ne: VERSION },
  } as any)) {
    if (!order.publicId) order.publicId = await nextPublicId("order");
    order.subtotalMinor =
      order.subtotalMinor ?? Math.round(Number(order.subtotal || 0) * 100);
    order.deliveryFeeMinor =
      order.deliveryFeeMinor ??
      Math.round(Number(order.deliveryFee || 0) * 100);
    order.totalMinor =
      order.totalMinor ?? Math.round(Number(order.total || 0) * 100);
    order.currency = order.currency || "NGN";
    (order as any).legacyCommerceSnapshot = {
      orderCode: order.orderCode,
      boothId: order.boothId,
      orderType: order.orderType,
    };
    (order as any).commerceMigrationVersion = VERSION;
    await order.save();
  }
  for (const item of await OrderItem.find({
    commerceMigrationVersion: { $ne: VERSION },
  } as any)) {
    if (!item.publicId) item.publicId = await nextPublicId("orderItem");
    item.unitPriceMinor =
      item.unitPriceMinor ?? Math.round(Number(item.unitPrice || 0) * 100);
    item.totalPriceMinor =
      item.totalPriceMinor ?? Math.round(Number(item.totalPrice || 0) * 100);
    item.currency = item.currency || "NGN";
    (item as any).commerceMigrationVersion = VERSION;
    await item.save();
  }
  for (const payment of await Payment.find({
    commerceMigrationVersion: { $ne: VERSION },
  } as any)) {
    if (!payment.publicId) payment.publicId = await nextPublicId("payment");
    payment.amountMinor =
      payment.amountMinor ?? Math.round(Number(payment.amount || 0) * 100);
    payment.currency = payment.currency || "NGN";
    (payment as any).legacyProvider = payment.gateway;
    (payment as any).commerceMigrationVersion = VERSION;
    await payment.save();
  }
}

async function verify() {
  return {
    cartsMissingIds: await Cart.countDocuments({
      commerceMigrationVersion: VERSION,
      publicId: { $exists: false },
    } as any),
    ordersMissingCanonicalMoney: await Order.countDocuments({
      commerceMigrationVersion: VERSION,
      totalMinor: { $not: { $type: "number" } },
    } as any),
    paymentsMissingCanonicalMoney: await Payment.countDocuments({
      commerceMigrationVersion: VERSION,
      amountMinor: { $not: { $type: "number" } },
    } as any),
    duplicateOrderIds: await Order.aggregate([
      { $match: { publicId: { $exists: true } } },
      { $group: { _id: "$publicId", count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
      { $count: "count" },
    ]).then((rows) => rows[0]?.count || 0),
  };
}

async function rollback() {
  if (process.env.PHASE_04_ROLLBACK_CONFIRMED !== "true")
    throw new Error(
      "Set PHASE_04_ROLLBACK_CONFIRMED=true after reviewing backup and rollback instructions",
    );
  await Promise.all([
    Cart.updateMany({ commerceMigrationVersion: VERSION }, { $unset: { commerceMigrationVersion: 1 } }),
    CartItem.updateMany({ commerceMigrationVersion: VERSION }, { $unset: { commerceMigrationVersion: 1 } }),
    Order.updateMany({ commerceMigrationVersion: VERSION }, { $unset: { commerceMigrationVersion: 1 } }),
    OrderItem.updateMany({ commerceMigrationVersion: VERSION }, { $unset: { commerceMigrationVersion: 1 } }),
    Payment.updateMany({ commerceMigrationVersion: VERSION }, { $unset: { commerceMigrationVersion: 1 } }),
  ]);
}

async function main() {
  await connectDatabase();
  console.log(
    JSON.stringify({ stage: "analysis", mode, ...(await counts()) }, null, 2),
  );
  if (mode === "execute") await execute();
  if (mode === "rollback") await rollback();
  if (["execute", "verify", "rollback"].includes(mode))
    console.log(
      JSON.stringify(
        { stage: "verification", ...(await verify()), ...(await counts()) },
        null,
        2,
      ),
    );
  await disconnectDatabase();
}
main().catch(async (error) => {
  console.error("Phase 4 commerce migration failed");
  console.error(error);
  await disconnectDatabase().catch(() => undefined);
  process.exit(1);
});
