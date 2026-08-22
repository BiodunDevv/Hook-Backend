import { createHash, createHmac, randomInt, randomUUID, timingSafeEqual } from 'crypto';
import {
  CommerceChannel,
  CommerceOrderStatus,
  CommercePaymentStatus,
  FulfilmentTaskStatus,
  HubPackageStatus,
  RunnerPackageStatus,
  ShipmentStatus,
} from '@lib/constants';
import { CommerceOutboxEvent } from '@models/commerce/commerce.model';
import { FulfilmentTask, RunnerPackage, HubPackage, Consolidation, Shipment, FulfilmentException, PartnerCustody, ReturnRequest, FulfilmentRefund, LogisticsWebhookEvent, type LogisticsProviderKey } from '@models/fulfilment/fulfilment.model';
import { Order } from '@models/orders/order.model';
import { OrderItem } from '@models/orders/order-item.model';
import { OrderFulfilmentGroup } from '@models/orders/order-fulfilment-group.model';
import { Payment } from '@models/payments/payment.model';
import { Market, DispatchHub } from '@models/platform/network.model';
import { HookPartner, MarketAssociateMarketAssignment, MarketAssociateProfile } from '@models/platform/operations-accounts.model';
import { User } from '@models/users/user.model';
import { PlatformAuditLog } from '@models/platform/audit-log.model';
import { nextPublicId } from '@services/public-id.service';
import { PaymentService } from '@services/payment.service';
import { createCommerceNotification } from '@services/commerce-notification.service';
import { isLogisticsSimulationEnabled, logisticsProvider, logisticsReadiness } from '@services/logistics/logistics-provider';
import { publishRealtime } from '@services/realtime.service';
import { EmailService } from '@emails/email.service';
import { HttpError } from '@utils/http';

type Actor = { accountId: string; publicId?: string; stateIds?: string[]; hubIds?: string[]; accountType?: string };
type EvidenceInput = Array<{ type: string; url?: string; assetId?: string; note?: string }>;

const TASK_TRANSITIONS: Record<string, FulfilmentTaskStatus[]> = {
  accept: [FulfilmentTaskStatus.ALERTED, FulfilmentTaskStatus.UNASSIGNED],
  start_sourcing: [FulfilmentTaskStatus.ACCEPTED],
  secure: [FulfilmentTaskStatus.SOURCING],
  begin_packing: [FulfilmentTaskStatus.PRODUCT_SECURED],
  pack: [FulfilmentTaskStatus.PACKING],
};

function identifier(identifier: string) {
  return /^[a-f\d]{24}$/i.test(identifier)
    ? { $or: [{ _id: identifier }, { publicId: identifier }] }
    : { publicId: identifier };
}

function digest(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function hint(value: string) {
  return value.slice(-4).padStart(4, '*');
}

function evidence(items: EvidenceInput = []) {
  return items.map((item) => ({ ...item, capturedAt: new Date() }));
}

function safeCustody(record: Record<string, any> | null | undefined) {
  if (!record) return record;
  const publicRecord = { ...record };
  delete publicRecord.collectionCodeHash;
  return publicRecord;
}

function isDuplicateKey(error: unknown) {
  return Boolean(error && typeof error === 'object' && (error as any).code === 11000);
}

function logisticsSignature(provider: string, payload: Record<string, unknown>, signature: string) {
  const secret = process.env[`LOGISTICS_${provider.toUpperCase()}_WEBHOOK_SECRET`];
  if (!secret || !signature) return false;
  const expected = createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex');
  const provided = signature.replace(/^sha256=/i, '').trim();
  if (!/^[a-f\d]{64}$/i.test(provided)) return false;
  return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(provided, 'hex'));
}

async function audit(action: string, entityType: string, entityId: string | undefined, actorId: string, after?: unknown, reason?: string, stateId?: string, hubId?: string) {
  await PlatformAuditLog.create({
    publicId: await nextPublicId('audit'), actorType: 'system', actorId, action, entityType, entityId,
    after: after as Record<string, unknown> | undefined, reason, stateId, hubId, requestId: `fulfilment:${randomUUID()}`,
  });
}

async function taskByIdentifier(value: string) {
  const task = await FulfilmentTask.findOne(identifier(value)).lean({ virtuals: true });
  if (!task) throw new HttpError(404, 'Fulfilment task not found', undefined, 'NOT_FOUND');
  return task as any;
}

async function orderByIdentifier(value: string) {
  const order = await Order.findOne(identifier(value)).lean({ virtuals: true });
  if (!order) throw new HttpError(404, 'Order not found', undefined, 'NOT_FOUND');
  return order as any;
}

async function marketAssociateContext(accountId: string) {
  const marketAssociate = await MarketAssociateProfile.findOne({ accountId, status: 'active' }).lean({ virtuals: true });
  if (!marketAssociate) throw new HttpError(403, 'Active Market Associate profile required', undefined, 'ACCESS_DENIED');
  return marketAssociate as any;
}

async function assertStaffScope(actor: Actor, stateId?: string, hubId?: string) {
  if (actor.accountType !== 'staff') throw new HttpError(403, 'Operations account required', undefined, 'ACCESS_DENIED');
  if (stateId && actor.stateIds?.length && !actor.stateIds.includes(stateId)) throw new HttpError(403, 'The requested State is outside your scope', undefined, 'SCOPE_DENIED');
  if (hubId && actor.hubIds?.length && !actor.hubIds.includes(hubId)) throw new HttpError(403, 'The requested Hub is outside your scope', undefined, 'SCOPE_DENIED');
}

export class FulfilmentService {
  private readonly payments = new PaymentService();
  private readonly email = new EmailService();

  private async publishOrderUpdate(orderId: string, stateId?: string, hubId?: string) {
    const order = await Order.findById(orderId)
      .select('publicId version userId sourceStateId')
      .lean() as any;
    if (!order) return;
    const scopeStateId = stateId || order.sourceStateId;
    const targets = {
      ...(order.userId ? { accountId: String(order.userId) } : {}),
      admin: true,
      ...(scopeStateId ? { stateId: String(scopeStateId) } : {}),
      ...(hubId ? { hubId: String(hubId) } : {}),
    };
    const event = {
      entityId: order.publicId || String(order._id),
      version: Number(order.version || 1),
      ...(scopeStateId || hubId ? { scope: { ...(scopeStateId ? { stateId: String(scopeStateId) } : {}), ...(hubId ? { hubId: String(hubId) } : {}) } } : {}),
    };
    publishRealtime({ type: 'order.updated', ...event }, targets);
    publishRealtime({ type: 'admin.operations.updated', ...event }, targets);
  }

  async consumeApprovedOrder(event: any) {
    const order = await orderByIdentifier(event.aggregateId);
    if (order.commerceStatus !== CommerceOrderStatus.APPROVED_FOR_FULFILMENT && order.commerceStatus !== 'IN_FULFILMENT') return { skipped: true, reason: 'order_not_approved' };
    const items = await OrderItem.find({ orderId: order._id.toString(), resolutionState: { $ne: 'RESOLVED' } }).lean({ virtuals: true }) as any[];
    if (!items.length) return { skipped: true, reason: 'no_active_items' };

    const groups = new Map<string, any[]>();
    for (const item of items) {
      const key = `${item.marketId || 'unassigned'}:${item.stateId || order.sourceStateId || 'unassigned'}`;
      groups.set(key, [...(groups.get(key) || []), item]);
    }

    let blocked = false;
    for (const group of groups.values()) {
      const marketId = group[0].marketId;
      const stateId = group[0].stateId || order.sourceStateId;
      const assignment = marketId ? await MarketAssociateMarketAssignment.findOne({ marketId, stateId, status: 'active', isPrimary: true, activeFrom: { $lte: new Date() }, $or: [{ activeTo: { $exists: false } }, { activeTo: null }, { activeTo: { $gt: new Date() } }] }).sort({ priority: 1 }).lean({ virtuals: true }) : null;
      const market = marketId ? await Market.findOne(identifier(marketId)).lean({ virtuals: true }) : null;
      const hubId = (assignment as any)?.preferredHubId || (market as any)?.hubId;
      const hub = hubId ? await DispatchHub.findOne(identifier(hubId)).lean({ virtuals: true }) : null;
      const groupBlocked = !assignment || !hub || (hub as any).status !== 'active';
      if (groupBlocked) blocked = true;

      const idempotencyKey = `order:${order._id.toString()}:market:${marketId || 'unassigned'}`;
      const task = await FulfilmentTask.findOneAndUpdate(
        { idempotencyKey },
        {
          $setOnInsert: {
            publicId: await nextPublicId('fulfilment'), orderId: order._id.toString(), sourceStateId: stateId,
            marketId: marketId || 'UNASSIGNED', hubId: hub ? (hub as any).publicId || hub._id.toString() : undefined,
            marketAssociateId: assignment?.marketAssociateId, orderItemIds: group.map((item) => item._id.toString()),
            status: groupBlocked ? FulfilmentTaskStatus.BLOCKED : FulfilmentTaskStatus.ALERTED, version: 1, idempotencyKey,
            alertedAt: groupBlocked ? undefined : new Date(), acceptanceDueAt: new Date(Date.now() + 15 * 60 * 1000),
            sourcingDueAt: new Date(Date.now() + 4 * 60 * 60 * 1000), hubHandoverDueAt: new Date(Date.now() + 6 * 60 * 60 * 1000),
            resolutionDueAt: new Date(Date.now() + 24 * 60 * 60 * 1000), evidence: [], assignmentHistory: [],
          },
        },
        { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
      ).lean({ virtuals: true });
      await OrderItem.updateMany({ _id: { $in: group.map((item) => item._id) } }, { $set: { fulfilmentTaskId: (task as any)._id.toString(), fulfilmentStatus: 'PENDING' } });
      if (!groupBlocked && assignment?.marketAssociateId && (task as any).status === FulfilmentTaskStatus.ALERTED) {
        const marketAssociateProfile = await MarketAssociateProfile.findById(assignment.marketAssociateId).select('accountId').lean();
        if (marketAssociateProfile?.accountId)
          await createCommerceNotification({
            eventKey: `fulfilment:${(task as any).publicId}:alerted`,
            userId: marketAssociateProfile.accountId,
            title: "New order to fulfil",
            body: `A new order needs pickup from ${market?.name || "your assigned Market"}. Accept within 15 minutes.`,
            type: "order_assigned",
            data: { taskId: (task as any).publicId, orderId: order.publicId, marketId },
          }).catch(() => undefined);
      }
      if (groupBlocked) {
        await FulfilmentException.findOneAndUpdate(
          { idempotencyKey: `assignment:${idempotencyKey}` },
          { $setOnInsert: { publicId: await nextPublicId('exception'), orderId: order._id.toString(), taskId: (task as any)._id.toString(), sourceStateId: stateId, type: !assignment ? 'ASSIGNMENT_MISSING' : 'HUB_MISSING', severity: 'HIGH', status: 'OPEN', summary: !assignment ? 'No active Market Associate assignment for Market' : 'No compatible Dispatch Hub configured', details: { marketId, stateId }, idempotencyKey: `assignment:${idempotencyKey}` } },
          { upsert: true, returnDocument: 'after' },
        );
      }
    }
    await Order.updateOne({ _id: order._id }, { $set: { commerceStatus: CommerceOrderStatus.IN_FULFILMENT, status: 'confirmed', fulfilmentSummary: { taskCount: groups.size, blocked }, customerProgress: [{ key: 'fulfilment', label: blocked ? 'Operations review required' : 'Market Associate sourcing started', at: new Date() }] }, $push: { timeline: { status: 'IN_FULFILMENT', actor: 'SYSTEM', at: new Date(), blocked } } });
    await this.publishOrderUpdate(order._id.toString(), order.sourceStateId);
    await audit('fulfilment.tasks.created', 'order', order._id.toString(), 'SYSTEM', { taskCount: groups.size, blocked }, undefined, order.sourceStateId);
    return { taskCount: groups.size, blocked };
  }

  async processOutboxBatch(limit = 5) {
    const results: unknown[] = [];
    for (let index = 0; index < limit; index += 1) {
      const lockToken = randomUUID();
      const event = await CommerceOutboxEvent.findOneAndUpdate(
        { eventType: 'ORDER_APPROVED_FOR_FULFILMENT', $or: [{ status: 'pending', availableAt: { $lte: new Date() } }, { status: 'processing', lockedUntil: { $lt: new Date() } }] },
        { $set: { status: 'processing', lockToken, lockedUntil: new Date(Date.now() + 60_000) }, $inc: { attempts: 1 } },
        { sort: { availableAt: 1, createdAt: 1 }, returnDocument: 'after' },
      ).lean({ virtuals: true });
      if (!event) break;
      try {
        results.push(await this.consumeApprovedOrder(event));
        await CommerceOutboxEvent.updateOne({ _id: (event as any)._id, lockToken }, { $set: { status: 'published', processedAt: new Date(), lockedUntil: undefined, lockToken: undefined }, $unset: { lastError: 1 } });
      } catch (error) {
        const attempts = Number((event as any).attempts || 1);
        await CommerceOutboxEvent.updateOne({ _id: (event as any)._id, lockToken }, { $set: { status: attempts >= 5 ? 'dead_letter' : 'pending', availableAt: new Date(Date.now() + Math.min(30 * 60_000, 1000 * 2 ** attempts)), lastError: error instanceof Error ? error.message.slice(0, 900) : 'Outbox processing failed' }, $unset: { lockedUntil: 1, lockToken: 1 } });
      }
    }
    return results;
  }

  async marketAssociateTasks(accountId: string, query: Record<string, unknown>) {
    const marketAssociate = await marketAssociateContext(accountId);
    const filter: Record<string, unknown> = { marketAssociateId: (marketAssociate as any)._id.toString() };
    if (query.status) filter.status = query.status;
    const data = await FulfilmentTask.find(filter).sort({ acceptanceDueAt: 1, createdAt: -1 }).limit(Math.min(Number(query.limit || 50), 100)).lean({ virtuals: true });
    return { data, total: data.length };
  }

  async adminTaskDetail(actor: Actor, taskIdentifier: string) {
    const task = await taskByIdentifier(taskIdentifier);
    await assertStaffScope(actor, task.sourceStateId, task.hubId);
    const [order, items] = await Promise.all([
      Order.findById(task.orderId)
        .select('publicId commerceStatus status sourceStateId customerProgress')
        .lean({ virtuals: true }),
      OrderItem.find({ _id: { $in: task.orderItemIds } })
        .select('publicId productSnapshot quantity variantSnapshot fulfilmentStatus')
        .lean({ virtuals: true }),
    ]);
    return { task, order, items };
  }

  async assignmentMarketAssociates(actor: Actor, query: Record<string, unknown>) {
    await assertStaffScope(actor, query.stateId as string | undefined);
    const stateId = query.stateId ? String(query.stateId) : undefined;
    const filter: Record<string, unknown> = { status: 'active' };
    if (stateId) filter.stateIds = stateId;
    else if (actor.stateIds?.length) filter.stateIds = { $in: actor.stateIds };
    const profiles = await MarketAssociateProfile.find(filter)
      .select('publicId accountId stateIds hubIds availability status')
      .sort({ createdAt: 1 })
      .limit(200)
      .lean({ virtuals: true }) as any[];
    const accounts = await User.find({ _id: { $in: profiles.map((profile) => profile.accountId) } })
      .select('firstName lastName email phone')
      .lean() as any[];
    const accountById = new Map(accounts.map((account) => [String(account._id), account]));
    return { data: profiles.map((profile) => ({
      publicId: profile.publicId,
      id: profile.publicId,
      availability: profile.availability,
      stateIds: profile.stateIds,
      hubIds: profile.hubIds,
      ...(accountById.get(String(profile.accountId)) || {}),
    })) };
  }

  async assignmentHubs(actor: Actor, query: Record<string, unknown>) {
    await assertStaffScope(actor, query.stateId as string | undefined);
    const filter: Record<string, unknown> = { status: 'active' };
    if (query.stateId) filter.stateId = String(query.stateId);
    else if (actor.stateIds?.length) filter.stateId = { $in: actor.stateIds };
    if (actor.hubIds?.length) filter.publicId = { $in: actor.hubIds };
    const data = await DispatchHub.find(filter)
      .select('publicId name stateId cityId status')
      .sort({ name: 1 })
      .limit(200)
      .lean({ virtuals: true });
    return { data };
  }

  async reassignTask(actor: Actor, taskIdentifier: string, body: Record<string, any>) {
    const task = await taskByIdentifier(taskIdentifier);
    await assertStaffScope(actor, task.sourceStateId, task.hubId);
    if (!body.reason || String(body.reason).trim().length < 3) {
      throw new HttpError(400, 'A reassignment reason is required', undefined, 'VALIDATION_ERROR');
    }
    if ([FulfilmentTaskStatus.COMPLETED, FulfilmentTaskStatus.CANCELLED, FulfilmentTaskStatus.HUB_RECEIVED, FulfilmentTaskStatus.QC_PASSED].includes(task.status)) {
      throw new HttpError(409, 'This fulfilment task can no longer be reassigned', undefined, 'INVALID_STATE_TRANSITION');
    }

    const marketAssociateQuery = /^[a-f\d]{24}$/i.test(String(body.marketAssociateId))
      ? { $or: [{ _id: body.marketAssociateId }, { publicId: body.marketAssociateId }] }
      : { publicId: String(body.marketAssociateId) };
    const marketAssociate = await MarketAssociateProfile.findOne({ ...marketAssociateQuery, status: 'active', stateIds: task.sourceStateId }).lean({ virtuals: true }) as any;
    if (!marketAssociate) throw new HttpError(409, 'The selected Market Associate is not active in this State', undefined, 'SCOPE_DENIED');

    const assignment = await MarketAssociateMarketAssignment.findOne({
      marketAssociateId: marketAssociate._id.toString(),
      marketId: task.marketId,
      stateId: task.sourceStateId,
      status: 'active',
      isPrimary: true,
      activeFrom: { $lte: new Date() },
      $or: [{ activeTo: { $exists: false } }, { activeTo: null }, { activeTo: { $gt: new Date() } }],
    }).lean({ virtuals: true });
    if (!assignment) throw new HttpError(409, 'The selected Market Associate is not assigned to this Market', undefined, 'RUNNER_MARKET_ASSIGNMENT_REQUIRED');

    const hubQuery = /^[a-f\d]{24}$/i.test(String(body.hubId))
      ? { $or: [{ _id: body.hubId }, { publicId: body.hubId }] }
      : { publicId: String(body.hubId) };
    const hub = await DispatchHub.findOne({ ...hubQuery, stateId: task.sourceStateId, status: 'active' }).lean({ virtuals: true }) as any;
    if (!hub) throw new HttpError(409, 'The selected Hub is not active in this State', undefined, 'SCOPE_DENIED');
    await assertStaffScope(actor, task.sourceStateId, hub.publicId || hub._id.toString());

    const now = new Date();
    const updated = await FulfilmentTask.findOneAndUpdate(
      { _id: task._id, version: body.version ?? task.version },
      {
        $set: {
          marketAssociateId: marketAssociate._id.toString(),
          hubId: hub.publicId || hub._id.toString(),
          status: FulfilmentTaskStatus.ALERTED,
          alertedAt: now,
          version: task.version + 1,
        },
        $push: {
          assignmentHistory: {
            action: 'REASSIGNED',
            fromMarketAssociateId: task.marketAssociateId,
            toMarketAssociateId: marketAssociate.publicId || marketAssociate._id.toString(),
            fromHubId: task.hubId,
            toHubId: hub.publicId || hub._id.toString(),
            reason: String(body.reason).trim(),
            actorId: actor.accountId,
            at: now,
          },
        },
      },
      { returnDocument: 'after' },
    ).lean({ virtuals: true });
    if (!updated) throw new HttpError(409, 'This task changed. Refresh and try again.', undefined, 'STALE_VERSION');
    await audit('fulfilment.task.reassigned', 'fulfilment_task', task.publicId || task._id.toString(), actor.accountId, { marketAssociateId: marketAssociate.publicId || marketAssociate._id.toString(), hubId: hub.publicId || hub._id.toString() }, String(body.reason).trim(), task.sourceStateId, hub._id.toString());
    await this.publishOrderUpdate(task.orderId, task.sourceStateId, hub.publicId || hub._id.toString());
    return updated;
  }

  async resolveException(actor: Actor, exceptionIdentifier: string, body: Record<string, any>) {
    const exception = await FulfilmentException.findOne(identifier(exceptionIdentifier)).lean({ virtuals: true }) as any;
    if (!exception) throw new HttpError(404, 'Fulfilment exception not found', undefined, 'NOT_FOUND');
    await assertStaffScope(actor, exception.sourceStateId, exception.hubId);
    const nextStatus = String(body.status || '').toUpperCase();
    if (!['IN_PROGRESS', 'RESOLVED', 'DISMISSED'].includes(nextStatus)) {
      throw new HttpError(400, 'Choose an in-progress, resolved, or dismissed status', undefined, 'VALIDATION_ERROR');
    }
    const reason = String(body.reason || '').trim();
    if (reason.length < 3) throw new HttpError(400, 'A resolution reason is required', undefined, 'VALIDATION_ERROR');
    if (exception.status === nextStatus && exception.resolutionNote === reason) return exception;
    const updated = await FulfilmentException.findOneAndUpdate(
      { _id: exception._id, status: { $in: ['OPEN', 'IN_PROGRESS'] } },
      { $set: { status: nextStatus, resolvedBy: actor.accountId, resolutionNote: reason } },
      { returnDocument: 'after' },
    ).lean({ virtuals: true });
    if (!updated) {
      const current = await FulfilmentException.findById(exception._id).lean({ virtuals: true });
      if (current && current.status === nextStatus) return current;
      throw new HttpError(409, 'This exception changed. Refresh and try again.', undefined, 'STALE_VERSION');
    }
    await audit(
      `fulfilment.exception.${nextStatus.toLowerCase()}`,
      'fulfilment_exception',
      exception.publicId || exception._id.toString(),
      actor.accountId,
      { status: nextStatus, resolutionNote: reason },
      reason,
      exception.sourceStateId,
      exception.hubId,
    );
    return updated;
  }

  async processOperationalDeadlines() {
    const now = new Date();
    const overdueTasks = await FulfilmentTask.find({
      status: {
        $in: [
          FulfilmentTaskStatus.UNASSIGNED,
          FulfilmentTaskStatus.ALERTED,
          FulfilmentTaskStatus.ACCEPTED,
          FulfilmentTaskStatus.SOURCING,
          FulfilmentTaskStatus.PRODUCT_SECURED,
          FulfilmentTaskStatus.PACKING,
          FulfilmentTaskStatus.READY_FOR_HUB,
          FulfilmentTaskStatus.HUB_RECEIVED,
        ],
      },
      $or: [
        { status: { $in: [FulfilmentTaskStatus.UNASSIGNED, FulfilmentTaskStatus.ALERTED] }, acceptanceDueAt: { $lte: now } },
        { status: { $in: [FulfilmentTaskStatus.ACCEPTED, FulfilmentTaskStatus.SOURCING, FulfilmentTaskStatus.PRODUCT_SECURED] }, sourcingDueAt: { $lte: now } },
        { status: { $in: [FulfilmentTaskStatus.PACKING, FulfilmentTaskStatus.READY_FOR_HUB, FulfilmentTaskStatus.HUB_RECEIVED] }, hubHandoverDueAt: { $lte: now } },
        { resolutionDueAt: { $lte: now } },
      ],
    }).limit(100).lean({ virtuals: true }) as any[];

    let taskExceptions = 0;
    for (const task of overdueTasks) {
      const deadlineType = [FulfilmentTaskStatus.UNASSIGNED, FulfilmentTaskStatus.ALERTED].includes(task.status)
        ? 'ACCEPTANCE'
        : [FulfilmentTaskStatus.ACCEPTED, FulfilmentTaskStatus.SOURCING, FulfilmentTaskStatus.PRODUCT_SECURED].includes(task.status)
          ? 'SOURCING'
          : [FulfilmentTaskStatus.PACKING, FulfilmentTaskStatus.READY_FOR_HUB, FulfilmentTaskStatus.HUB_RECEIVED].includes(task.status)
            ? 'HUB_HANDOVER'
            : 'RESOLUTION';
      const idempotencyKey = `sla:${task.publicId || task._id}:${deadlineType}`;
      if (await FulfilmentException.exists({ idempotencyKey })) continue;
      try {
        await FulfilmentException.create({
          publicId: await nextPublicId('exception'),
          orderId: task.orderId,
          taskId: task._id.toString(),
          sourceStateId: task.sourceStateId,
          hubId: task.hubId,
          type: 'SLA_BREACH',
          severity: deadlineType === 'RESOLUTION' ? 'CRITICAL' : 'HIGH',
          status: 'OPEN',
          summary: `${deadlineType.toLowerCase().replace('_', ' ')} SLA breached`,
          details: { taskId: task.publicId || task._id.toString(), taskStatus: task.status, deadlineType },
          dueAt: now,
          openedBy: 'SYSTEM',
          idempotencyKey,
        });
        taskExceptions += 1;
      } catch (error) {
        if (!isDuplicateKey(error)) throw error;
      }
    }

    const overdueCustody = await PartnerCustody.find({ status: { $in: ['AWAITING_RECEIPT', 'IN_CUSTODY'] }, expiresAt: { $lte: now } }).limit(100).lean({ virtuals: true }) as any[];
    let custodyExceptions = 0;
    for (const custody of overdueCustody) {
      const updated = await PartnerCustody.findOneAndUpdate(
        { _id: custody._id, status: { $in: ['AWAITING_RECEIPT', 'IN_CUSTODY'] } },
        { $set: { status: 'OVERDUE' }, $push: { history: { action: 'CUSTODY_OVERDUE', actorId: 'SYSTEM', at: now } } },
        { returnDocument: 'after' },
      ).lean({ virtuals: true });
      if (!updated) continue;
      const idempotencyKey = `custody-overdue:${custody.publicId || custody._id}`;
      if (await FulfilmentException.exists({ idempotencyKey })) continue;
      try {
        await FulfilmentException.create({
          publicId: await nextPublicId('exception'), orderId: custody.orderId, shipmentId: custody.shipmentId,
          type: 'CUSTODY_OVERDUE', severity: 'HIGH', status: 'OPEN', summary: 'Partner custody window expired',
          details: { custodyId: custody.publicId || custody._id.toString(), partnerId: custody.partnerId }, openedBy: 'SYSTEM', dueAt: now, idempotencyKey,
        });
        custodyExceptions += 1;
      } catch (error) {
        if (!isDuplicateKey(error)) throw error;
      }
    }
    return { taskExceptions, custodyExceptions };
  }

  async marketAssociateTask(accountId: string, taskIdentifier: string) {
    const marketAssociate = await marketAssociateContext(accountId);
    const task = await taskByIdentifier(taskIdentifier);
    if (task.marketAssociateId !== (marketAssociate as any)._id.toString()) throw new HttpError(404, 'Fulfilment task not found', undefined, 'NOT_FOUND');
    const [items, market, hub, pack] = await Promise.all([
      OrderItem.find({ _id: { $in: task.orderItemIds } }).lean({ virtuals: true }),
      Market.findOne(identifier(task.marketId)).lean({ virtuals: true }),
      task.hubId ? DispatchHub.findOne(identifier(task.hubId)).lean({ virtuals: true }) : null,
      RunnerPackage.findOne({ taskId: task._id }).select('-scanCredentialHash').lean({ virtuals: true }),
    ]);
    return { ...task, items, market, hub, package: pack };
  }

  async verifyItem(accountId: string, taskIdentifier: string, orderItemId: string, body: Record<string, any>) {
    const marketAssociate = await marketAssociateContext(accountId);
    const task = await taskByIdentifier(taskIdentifier);
    if (task.marketAssociateId !== (marketAssociate as any)._id.toString()) throw new HttpError(404, 'Fulfilment task not found', undefined, 'NOT_FOUND');
    if (!task.orderItemIds.map(String).includes(String(orderItemId))) throw new HttpError(404, 'Order item not found on this task', undefined, 'NOT_FOUND');
    if (![FulfilmentTaskStatus.PRODUCT_SECURED, FulfilmentTaskStatus.PACKING].includes(task.status)) {
      throw new HttpError(409, 'Items can only be verified after sourcing is secured and before packing is complete', { current: task.status }, 'INVALID_STATE_TRANSITION');
    }
    if (!body.photoUrl) throw new HttpError(400, 'A photo of the picked-up item is required', undefined, 'VALIDATION_ERROR');
    const checks = {
      productMatches: Boolean(body.checks?.productMatches),
      sizeMatches: Boolean(body.checks?.sizeMatches),
      colorMatches: Boolean(body.checks?.colorMatches),
      quantityMatches: Boolean(body.checks?.quantityMatches),
    };
    const matched = Object.values(checks).every(Boolean);
    const entry = {
      orderItemId: String(orderItemId),
      photoUrl: String(body.photoUrl),
      photoAssetId: body.photoAssetId ? String(body.photoAssetId) : undefined,
      checks,
      matched,
      verifiedAt: new Date(),
      verifiedBy: accountId,
    };
    let updated = await FulfilmentTask.findOneAndUpdate(
      { _id: task._id, 'itemVerifications.orderItemId': { $ne: String(orderItemId) } },
      { $push: { itemVerifications: entry } },
      { returnDocument: 'after' },
    ).lean({ virtuals: true });
    if (!updated) {
      updated = await FulfilmentTask.findOneAndUpdate(
        { _id: task._id, 'itemVerifications.orderItemId': String(orderItemId) },
        { $set: { 'itemVerifications.$.photoUrl': entry.photoUrl, 'itemVerifications.$.photoAssetId': entry.photoAssetId, 'itemVerifications.$.checks': entry.checks, 'itemVerifications.$.matched': entry.matched, 'itemVerifications.$.verifiedAt': entry.verifiedAt, 'itemVerifications.$.verifiedBy': entry.verifiedBy } },
        { returnDocument: 'after' },
      ).lean({ virtuals: true });
    }
    if (!updated) throw new HttpError(404, 'Fulfilment task not found', undefined, 'NOT_FOUND');
    await OrderItem.updateOne({ _id: orderItemId }, { $set: { fulfilmentStatus: matched ? 'SECURED' : 'EXCEPTION' } });
    await audit('fulfilment.marketassociate.item_verified', 'fulfilment_task', task._id.toString(), accountId, { orderItemId, matched }, undefined, task.sourceStateId, task.hubId);
    await this.publishOrderUpdate(task.orderId, task.sourceStateId, task.hubId);
    const verifications = (updated as any).itemVerifications || [];
    const verifiedCount = task.orderItemIds.filter((id: string) => verifications.some((v: any) => String(v.orderItemId) === String(id) && v.matched)).length;
    return { taskId: (updated as any).publicId || (updated as any)._id.toString(), orderItemId, matched, verifiedCount, totalCount: task.orderItemIds.length };
  }

  async marketAssociateTransition(accountId: string, taskIdentifier: string, action: string, version: number, body: Record<string, any> = {}) {
    const marketAssociate = await marketAssociateContext(accountId);
    const task = await taskByIdentifier(taskIdentifier);
    if (task.marketAssociateId !== (marketAssociate as any)._id.toString()) throw new HttpError(404, 'Fulfilment task not found', undefined, 'NOT_FOUND');
    if (action === 'pack' && task.status === FulfilmentTaskStatus.READY_FOR_HUB) {
      const existingPackage = await RunnerPackage.findOne({ taskId: task._id }).select('-scanCredentialHash').lean({ virtuals: true });
      if (existingPackage) return { ...task, package: existingPackage };
    }
    const allowed = TASK_TRANSITIONS[action] || [];
    if (!allowed.includes(task.status)) throw new HttpError(409, `Cannot ${action.replaceAll('_', ' ')} from the current task state`, { current: task.status }, 'INVALID_STATE_TRANSITION');
    const now = new Date();
    const set: Record<string, unknown> = { version: task.version + 1 };
    if (action === 'accept') { set.status = FulfilmentTaskStatus.ACCEPTED; set.acceptedAt = now; }
    if (action === 'start_sourcing') { set.status = FulfilmentTaskStatus.SOURCING; set.sourcingStartedAt = now; }
    if (action === 'secure') { if (!Number.isSafeInteger(body.actualCostMinor) || body.actualCostMinor < 0) throw new HttpError(400, 'Actual sourcing cost is required', undefined, 'VALIDATION_ERROR'); set.status = FulfilmentTaskStatus.PRODUCT_SECURED; set.productSecuredAt = now; set.actualCostMinor = body.actualCostMinor; set.evidence = evidence(body.evidence); }
    if (action === 'begin_packing') { set.status = FulfilmentTaskStatus.PACKING; set.packingStartedAt = now; }
    if (action === 'pack') {
      const verifiedIds = new Set((task.itemVerifications || []).filter((v: any) => v.matched).map((v: any) => String(v.orderItemId)));
      const missingItemIds = task.orderItemIds.filter((id: string) => !verifiedIds.has(String(id)));
      if (missingItemIds.length) throw new HttpError(409, `${missingItemIds.length} item(s) still need photo verification before packing`, { missingItemIds }, 'ITEMS_NOT_VERIFIED');
      set.status = FulfilmentTaskStatus.READY_FOR_HUB; set.packedAt = now; set.hubArrivedAt = body.arrivedAt ? new Date(body.arrivedAt) : undefined;
      const existingPackage = await RunnerPackage.findOne({ taskId: task._id }).select('-scanCredentialHash').lean({ virtuals: true });
      const rawCredential = existingPackage ? undefined : String(randomInt(100000, 999999));
      const created = existingPackage || await RunnerPackage.findOneAndUpdate({ taskId: task._id }, { $setOnInsert: { publicId: await nextPublicId('runnerPackage'), orderId: task.orderId, taskId: task._id.toString(), marketAssociateId: task.marketAssociateId, hubId: task.hubId, status: RunnerPackageStatus.READY_FOR_HUB, scanCredentialHash: digest(rawCredential as string), scanCredentialHint: hint(rawCredential as string), itemIds: task.orderItemIds, packedAt: now, evidence: evidence(body.evidence), version: 1 } }, { upsert: true, returnDocument: 'after' }).select('-scanCredentialHash').lean({ virtuals: true });
      const packSet = { ...set };
      delete packSet.version;
      const updatedTask = await FulfilmentTask.findOneAndUpdate({ _id: task._id, version }, { $set: { ...packSet, status: FulfilmentTaskStatus.READY_FOR_HUB, packedAt: now }, $inc: { version: 1 } }, { returnDocument: 'after' }).lean({ virtuals: true });
      if (!updatedTask) throw new HttpError(409, 'This task changed. Refresh and try again.', undefined, 'STALE_VERSION');
      await OrderItem.updateMany({ _id: { $in: task.orderItemIds } }, { $set: { fulfilmentStatus: 'PACKED', runnerPackageId: (created as any)._id.toString() } });
      await audit('fulfilment.marketassociate.package_created', 'runner_package', (created as any).id, accountId, { publicId: (created as any).publicId }, undefined, task.sourceStateId, task.hubId);
      await this.publishOrderUpdate(task.orderId, task.sourceStateId, task.hubId);
      return { ...(updatedTask as any), package: { ...(created as any), ...(rawCredential ? { scanCredential: rawCredential } : {}) } };
    }
    const updated = await FulfilmentTask.findOneAndUpdate({ _id: task._id, version }, { $set: set }, { returnDocument: 'after' }).lean({ virtuals: true });
    if (!updated) throw new HttpError(409, 'This task changed. Refresh and try again.', undefined, 'STALE_VERSION');
    await audit(`fulfilment.marketassociate.${action}`, 'fulfilment_task', task._id.toString(), accountId, { status: (updated as any).status }, undefined, task.sourceStateId, task.hubId);
    await this.publishOrderUpdate(task.orderId, task.sourceStateId, task.hubId);
    return updated;
  }

  async marketAssociateIssue(accountId: string, taskIdentifier: string, body: Record<string, any>) {
    const marketAssociate = await marketAssociateContext(accountId); const task = await taskByIdentifier(taskIdentifier);
    if (task.marketAssociateId !== (marketAssociate as any)._id.toString()) throw new HttpError(404, 'Fulfilment task not found', undefined, 'NOT_FOUND');
    const idempotencyKey = String(body.idempotencyKey || `marketassociate-issue:${task._id}:${task.version}:${body.type || 'ITEM_UNAVAILABLE'}`);
    const existing = await FulfilmentException.findOne({ idempotencyKey }).lean({ virtuals: true });
    if (existing) return existing;
    const exception = await FulfilmentException.create({ publicId: await nextPublicId('exception'), orderId: task.orderId, taskId: task._id.toString(), sourceStateId: task.sourceStateId, hubId: task.hubId, type: body.type || 'ITEM_UNAVAILABLE', severity: body.severity || 'HIGH', status: 'OPEN', summary: String(body.summary || 'Market Associate reported a fulfilment issue'), details: { evidence: body.evidence || [], ...(body.orderItemId ? { orderItemId: String(body.orderItemId) } : {}) }, openedBy: accountId, idempotencyKey });
    const taskUpdate = await FulfilmentTask.updateOne({ _id: task._id, version: task.version }, { $set: { status: FulfilmentTaskStatus.BLOCKED, issue: { exceptionId: exception.publicId } }, $inc: { version: 1 } });
    if (!taskUpdate.modifiedCount) throw new HttpError(409, 'This fulfilment task changed. Refresh and try again.', undefined, 'STALE_VERSION');
    await this.publishOrderUpdate(task.orderId, task.sourceStateId, task.hubId);
    return exception.toJSON();
  }

  async hubDashboard(actor: Actor, query: Record<string, unknown>) {
    await assertStaffScope(actor, query.stateId as string | undefined, query.hubId as string | undefined);
    const filter: Record<string, unknown> = { status: { $in: [HubPackageStatus.RECEIVED, HubPackageStatus.QC_PENDING, HubPackageStatus.QC_PASSED] } };
    if (query.hubId) filter.hubId = query.hubId;
    if (actor.hubIds?.length) filter.hubId = { $in: actor.hubIds };
    const stateIds = query.stateId ? [String(query.stateId)] : (actor.stateIds || []).map(String);
    const inboundFilter: Record<string, unknown> = { status: RunnerPackageStatus.READY_FOR_HUB };
    if (query.hubId) inboundFilter.hubId = query.hubId;
    if (actor.hubIds?.length) inboundFilter.hubId = { $in: actor.hubIds };
    if (stateIds.length) {
      const tasks = await FulfilmentTask.find({ sourceStateId: { $in: stateIds } }).select('_id').lean();
      filter.taskId = { $in: tasks.map((task) => task._id.toString()) };
      inboundFilter.taskId = { $in: tasks.map((task) => task._id.toString()) };
    }
    const exceptionFilter: Record<string, unknown> = { status: { $in: ['OPEN', 'IN_PROGRESS'] } };
    if (query.hubId) exceptionFilter.hubId = query.hubId;
    if (query.stateId) exceptionFilter.sourceStateId = query.stateId;
    if (actor.hubIds?.length) exceptionFilter.hubId = { $in: actor.hubIds };
    if (actor.stateIds?.length) exceptionFilter.sourceStateId = { $in: actor.stateIds };
    const consolidationFilter: Record<string, unknown> = { status: { $in: ['DRAFT', 'SEALED'] } };
    if (query.hubId) consolidationFilter.hubId = query.hubId;
    if (actor.hubIds?.length) consolidationFilter.hubId = { $in: actor.hubIds };
    if (query.stateId) consolidationFilter.sourceStateId = query.stateId;
    if (actor.stateIds?.length) consolidationFilter.sourceStateId = { $in: actor.stateIds };
    const [inbound, packages, exceptions, consolidations] = await Promise.all([
      RunnerPackage.find(inboundFilter).sort({ createdAt: 1 }).limit(100).lean({ virtuals: true }),
      HubPackage.find(filter).sort({ createdAt: 1 }).limit(100).lean({ virtuals: true }),
      FulfilmentException.find(exceptionFilter).limit(50).lean({ virtuals: true }),
      Consolidation.find(consolidationFilter).sort({ createdAt: -1 }).limit(100).lean({ virtuals: true }),
    ]);
    const taskIds = [...new Set(packages.map((pack: any) => String(pack.taskId)))];
    const tasksWithVerifications = taskIds.length
      ? await FulfilmentTask.find({ _id: { $in: taskIds } }).select('itemVerifications').lean()
      : [];
    const verificationsByTask = new Map(tasksWithVerifications.map((t: any) => [String(t._id), t.itemVerifications || []]));
    const allItemIds = [...new Set(packages.flatMap((pack: any) => pack.itemIds.map(String)))];
    const items = allItemIds.length
      ? await OrderItem.find({ _id: { $in: allItemIds } }).select('productTitle productImage productSnapshot').lean()
      : [];
    const itemById = new Map(items.map((item: any) => [String(item._id), item]));
    const packagesWithItems = packages.map((pack: any) => ({
      ...pack,
      items: pack.itemIds.map((id: string) => {
        const verification = (verificationsByTask.get(String(pack.taskId)) || []).find((v: any) => String(v.orderItemId) === String(id));
        const item = itemById.get(String(id));
        return {
          orderItemId: id,
          productTitle: item?.productTitle,
          orderedPhotoUrl: item?.productImage || (item?.productSnapshot as any)?.images?.[0],
          pickedUpPhotoUrl: verification?.photoUrl,
          checks: verification?.checks,
          matched: verification?.matched ?? false,
        };
      }),
    }));
    return { inbound, packages: packagesWithItems, exceptions, consolidations };
  }

  async consolidations(actor: Actor, query: Record<string, unknown>) {
    await assertStaffScope(actor, query.stateId as string | undefined, query.hubId as string | undefined);
    const filter: Record<string, unknown> = {};
    if (query.status) filter.status = query.status;
    if (query.stateId) filter.sourceStateId = query.stateId;
    if (query.hubId) filter.hubId = query.hubId;
    if (actor.stateIds?.length) filter.sourceStateId = { $in: actor.stateIds };
    if (actor.hubIds?.length) filter.hubId = { $in: actor.hubIds };
    return Consolidation.find(filter).sort({ createdAt: -1 }).limit(Math.min(Number(query.limit || 100), 200)).lean({ virtuals: true });
  }

  async receivePackage(actor: Actor, packageIdentifier: string, body: Record<string, any>) {
    await assertStaffScope(actor, body.stateId, body.hubId);
    const runnerPackage = await RunnerPackage.findOne(identifier(packageIdentifier)).select('+scanCredentialHash').lean({ virtuals: true }) as any;
    if (!runnerPackage) throw new HttpError(404, 'Market Associate package not found', undefined, 'NOT_FOUND');
    const task = await FulfilmentTask.findById(runnerPackage.taskId).select('sourceStateId hubId').lean() as any;
    if (!task) throw new HttpError(404, 'Market Associate package not found', undefined, 'NOT_FOUND');
    await assertStaffScope(actor, task.sourceStateId, runnerPackage.hubId);
    if (body.stateId && String(body.stateId) !== String(task.sourceStateId)) throw new HttpError(403, 'Package is outside the requested State', undefined, 'SCOPE_DENIED');
    const existing = body.idempotencyKey ? await HubPackage.findOne({ receiveIdempotencyKey: body.idempotencyKey }).lean({ virtuals: true }) : null;
    if (existing) {
      if (String((existing as any).runnerPackageId) !== runnerPackage._id.toString()) throw new HttpError(409, 'This receive idempotency key belongs to another package', undefined, 'IDEMPOTENCY_CONFLICT');
      return existing;
    }
    if (runnerPackage.status !== RunnerPackageStatus.READY_FOR_HUB) throw new HttpError(409, 'Package is not ready for Hub receiving', undefined, 'INVALID_STATE_TRANSITION');
    if (body.hubId && body.hubId !== runnerPackage.hubId) throw new HttpError(403, 'Package is assigned to another Hub', undefined, 'SCOPE_DENIED');
    if (!body.scanCredential || digest(String(body.scanCredential)) !== runnerPackage.scanCredentialHash) throw new HttpError(403, 'Invalid package scan credential', undefined, 'ACCESS_DENIED');
    const received = await HubPackage.create({ publicId: await nextPublicId('hubPackage'), orderId: runnerPackage.orderId, taskId: runnerPackage.taskId, runnerPackageId: runnerPackage._id.toString(), hubId: runnerPackage.hubId, marketAssociateId: runnerPackage.marketAssociateId, status: HubPackageStatus.QC_PENDING, itemIds: runnerPackage.itemIds, receivedAt: new Date(), receivedBy: actor.accountId, qualityChecks: [], custodyHistory: [{ action: 'RECEIVED', actorId: actor.accountId, at: new Date() }], evidence: evidence(body.evidence), version: 1, receiveIdempotencyKey: body.idempotencyKey });
    await RunnerPackage.updateOne({ _id: runnerPackage._id }, { $set: { status: RunnerPackageStatus.HUB_RECEIVED, handedOverAt: new Date() } });
    await FulfilmentTask.updateOne({ _id: runnerPackage.taskId }, { $set: { status: FulfilmentTaskStatus.HUB_RECEIVED, hubReceivedAt: new Date() }, $inc: { version: 1 } });
    await OrderItem.updateMany({ _id: { $in: runnerPackage.itemIds } }, { $set: { fulfilmentStatus: 'RECEIVED', hubPackageId: received.id } });
    await audit('fulfilment.hub.package_received', 'hub_package', received.id, actor.accountId, { publicId: received.publicId }, undefined, body.stateId, runnerPackage.hubId);
    await this.publishOrderUpdate(runnerPackage.orderId, task.sourceStateId, runnerPackage.hubId);
    return received.toJSON();
  }

  async qualityCheck(actor: Actor, packageIdentifier: string, body: Record<string, any>) {
    const pack = await HubPackage.findOne(identifier(packageIdentifier)).lean({ virtuals: true }) as any;
    if (!pack) throw new HttpError(404, 'Hub package not found', undefined, 'NOT_FOUND');
    const task = await FulfilmentTask.findById(pack.taskId).select('sourceStateId').lean() as any;
    if (!task) throw new HttpError(404, 'Hub package not found', undefined, 'NOT_FOUND');
    await assertStaffScope(actor, task.sourceStateId, pack.hubId);
    if (![HubPackageStatus.QC_PENDING, HubPackageStatus.RECEIVED].includes(pack.status)) throw new HttpError(409, 'This package is no longer awaiting quality check', undefined, 'INVALID_STATE_TRANSITION');
    const passed = body.passed === true;
    const checks: Array<Record<string, unknown>> = body.checks || [];
    if (passed) {
      const confirmedIds = new Set(checks.filter((c: any) => c.confirmed === true).map((c: any) => String(c.orderItemId)));
      const missingItemIds = pack.itemIds.filter((id: string) => !confirmedIds.has(String(id)));
      if (missingItemIds.length) throw new HttpError(409, `${missingItemIds.length} item(s) still need Hub confirmation before QC can pass`, { missingItemIds }, 'ITEMS_NOT_CONFIRMED');
    }
    const updated = await HubPackage.findOneAndUpdate({ _id: pack._id, version: body.version ?? pack.version }, { $set: { status: passed ? HubPackageStatus.QC_PASSED : HubPackageStatus.QC_FAILED, qualityChecks: checks, qcPassedAt: passed ? new Date() : undefined, qcPassedBy: passed ? actor.accountId : undefined }, $push: { custodyHistory: { action: passed ? 'QC_PASSED' : 'QC_FAILED', actorId: actor.accountId, at: new Date(), checks } }, $inc: { version: 1 } }, { returnDocument: 'after' }).lean({ virtuals: true });
    if (!updated) throw new HttpError(409, 'This package changed. Refresh and try again.', undefined, 'STALE_VERSION');
    await OrderItem.updateMany({ _id: { $in: pack.itemIds } }, { $set: { fulfilmentStatus: passed ? 'QC_PASSED' : 'EXCEPTION' } });
    if (passed) await FulfilmentTask.updateOne({ _id: pack.taskId }, { $set: { status: FulfilmentTaskStatus.QC_PASSED }, $inc: { version: 1 } });
    else await FulfilmentException.create({ publicId: await nextPublicId('exception'), orderId: pack.orderId, taskId: pack.taskId, hubId: pack.hubId, type: 'QC_FAILED', severity: 'HIGH', status: 'OPEN', summary: 'Hub quality check failed', details: { checks }, openedBy: actor.accountId, idempotencyKey: `qc:${pack._id}:${pack.version}` });
    await this.publishOrderUpdate(pack.orderId, task.sourceStateId, pack.hubId);
    if (passed) await this.notifyHubQcPassed(pack);
    return updated;
  }

  private async notifyHubQcPassed(pack: any) {
    const order = await Order.findById(pack.orderId).select('publicId userId initiatingPartnerId channel totalMinor').lean() as any;
    if (!order) return;
    if (order.userId) {
      await createCommerceNotification({
        eventKey: `order:${order.publicId}:item-verified:${pack.publicId}`,
        userId: order.userId,
        title: 'Your items passed quality check',
        body: 'Hook Hub staff confirmed your items match your order and are ready for the next step.',
        type: 'hub_qc_passed',
        data: { orderId: order.publicId, hubPackageId: pack.publicId },
      }).catch(() => undefined);
      const customer = await User.findById(order.userId).select('email firstName').lean() as any;
      if (customer?.email) {
        await this.email.sendOrderStatusUpdate({
          to: customer.email,
          name: customer.firstName,
          orderCode: order.publicId,
          status: 'Items verified at Hub',
          amount: Number(order.totalMinor || 0) / 100,
        }).catch(() => undefined);
      }
    }
    if (pack.marketAssociateId) {
      const marketAssociateProfile = await MarketAssociateProfile.findById(pack.marketAssociateId).select('accountId').lean() as any;
      if (marketAssociateProfile?.accountId) {
        await createCommerceNotification({
          eventKey: `runner-package:${pack.publicId}:qc-passed`,
          userId: marketAssociateProfile.accountId,
          title: 'Package passed Hub QC',
          body: 'The items you sourced passed quality check at the Hub.',
          type: 'hub_qc_passed',
          data: { orderId: order.publicId, hubPackageId: pack.publicId },
        }).catch(() => undefined);
      }
    }
    if (order.channel === CommerceChannel.PARTNER_ASSISTED && order.initiatingPartnerId) {
      const partner = await HookPartner.findOne({ publicId: order.initiatingPartnerId }).select('accountId').lean() as any;
      if (partner?.accountId) {
        await createCommerceNotification({
          eventKey: `order:${order.publicId}:partner:item-verified:${pack.publicId}`,
          userId: partner.accountId,
          title: "Your customer's order passed Hub QC",
          body: 'The items for your customer\'s order were confirmed at the Hub and are progressing.',
          type: 'hub_qc_passed',
          data: { orderId: order.publicId, hubPackageId: pack.publicId },
        }).catch(() => undefined);
      }
    }
  }

  async consolidate(actor: Actor, orderIdentifier: string, body: Record<string, any>) {
    const order = await orderByIdentifier(orderIdentifier);
    const packages = await HubPackage.find({ orderId: order._id.toString(), hubId: body.hubId, status: HubPackageStatus.QC_PASSED }).lean({ virtuals: true });
    const tasks = await FulfilmentTask.find({ _id: { $in: packages.map((item: any) => item.taskId) } }).select('sourceStateId').lean();
    const sourceStates = [...new Set(tasks.map((task: any) => String(task.sourceStateId)))];
    if (sourceStates.length !== 1) throw new HttpError(409, 'Packages must belong to one source State', undefined, 'STATE_SCOPE_DENIED');
    const sourceStateId = sourceStates[0];
    await assertStaffScope(actor, sourceStateId, body.hubId);
    const group = await OrderFulfilmentGroup.findOne({ orderId: order._id.toString(), sourceStateId }).lean();
    const items = await OrderItem.find({ orderId: order._id.toString(), ...(group ? { fulfilmentGroupId: group.publicId } : { stateId: sourceStateId }), resolutionState: { $ne: 'RESOLVED' } }).lean({ virtuals: true }) as any[];
    const packageItems = new Set(packages.flatMap((item: any) => item.itemIds.map(String)));
    if (!items.length || items.some((item) => !packageItems.has(item._id.toString()))) throw new HttpError(409, 'Every active order item must pass Hub quality check before consolidation', undefined, 'ORDER_NOT_COMPLETE');
    const packageHubIds = [...new Set(packages.map((item: any) => String(item.hubId)))];
    if (packageHubIds.length !== 1 || (body.hubId && String(body.hubId) !== packageHubIds[0])) throw new HttpError(409, 'All packages must be at the same Dispatch Hub before consolidation', undefined, 'HUB_MISMATCH');
    await assertStaffScope(actor, sourceStateId, packageHubIds[0]);
    const existing = await Consolidation.findOne({ orderId: order._id.toString(), sourceStateId }).lean({ virtuals: true });
    if (existing) return existing;
    let consolidation;
    try {
      consolidation = await Consolidation.create({ publicId: await nextPublicId('consolidation'), orderId: order._id.toString(), fulfilmentGroupId: group?.publicId, sourceStateId, hubId: packageHubIds[0], hubPackageIds: packages.map((item: any) => item._id.toString()), status: 'DRAFT', evidence: [], version: 1 });
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
      const concurrent = await Consolidation.findOne({ orderId: order._id.toString(), sourceStateId }).lean({ virtuals: true });
      if (concurrent) return concurrent;
      throw error;
    }
    await HubPackage.updateMany({ _id: { $in: packages.map((item: any) => item._id) } }, { $set: { status: HubPackageStatus.CONSOLIDATED }, $push: { custodyHistory: { action: 'CONSOLIDATION_STARTED', actorId: actor.accountId, at: new Date() } } });
    await Order.updateOne({ _id: order._id }, { $set: { commerceStatus: CommerceOrderStatus.READY_FOR_CONSOLIDATION, customerProgress: [{ key: 'hub', label: 'Order received and checked', at: new Date() }] }, $push: { timeline: { status: 'READY_FOR_CONSOLIDATION', actor: actor.accountId, at: new Date() } } });
    await this.publishOrderUpdate(order._id.toString(), sourceStateId, packageHubIds[0]);
    return consolidation.toJSON();
  }

  async sealConsolidation(actor: Actor, identifierValue: string, body: Record<string, any>) {
    const consolidation = await Consolidation.findOne(identifier(identifierValue)).lean({ virtuals: true }) as any;
    if (!consolidation) throw new HttpError(404, 'Consolidation not found', undefined, 'NOT_FOUND');
    await assertStaffScope(actor, consolidation.sourceStateId, consolidation.hubId);
    if (consolidation.status !== 'DRAFT') throw new HttpError(409, 'Consolidation is not open for sealing', undefined, 'INVALID_STATE_TRANSITION');
    const updated = await Consolidation.findOneAndUpdate({ _id: consolidation._id, version: body.version ?? consolidation.version }, { $set: { status: 'SEALED', weightGrams: body.weightGrams, dimensions: body.dimensions, sealReference: String(body.sealReference || `HK-${randomInt(100000, 999999)}`), sealedAt: new Date(), sealedBy: actor.accountId }, $inc: { version: 1 } }, { returnDocument: 'after' }).lean({ virtuals: true });
    if (!updated) throw new HttpError(409, 'Consolidation changed. Refresh and try again.', undefined, 'STALE_VERSION');
    await Order.updateOne({ _id: consolidation.orderId }, { $set: { commerceStatus: CommerceOrderStatus.READY_FOR_DISPATCH, customerProgress: [{ key: 'consolidated', label: 'Order packed for dispatch', at: new Date() }] }, $push: { timeline: { status: 'READY_FOR_DISPATCH', actor: actor.accountId, at: new Date() } } });
    await this.publishOrderUpdate(consolidation.orderId, consolidation.sourceStateId, consolidation.hubId);
    return updated;
  }

  async createManualShipment(actor: Actor, orderIdentifier: string, body: Record<string, any>) {
    const order = await orderByIdentifier(orderIdentifier); await assertStaffScope(actor, order.sourceStateId, body.hubId);
    const provider = String(body.provider || 'manual') as LogisticsProviderKey;
    if (provider === 'simulated' && !isLogisticsSimulationEnabled()) throw new HttpError(503, 'Logistics simulation is available only in a non-production environment when explicitly enabled', undefined, 'PROVIDER_NOT_READY');
    if (!['manual', 'other', 'simulated'].includes(provider)) throw new HttpError(409, 'GIG and Fez adapters are disabled until provider credentials and contracts are verified', undefined, 'PROVIDER_NOT_READY');
    const consolidation = await Consolidation.findOne({ orderId: order._id.toString(), hubId: body.hubId, status: 'SEALED' }).lean({ virtuals: true }) as any;
    if (!consolidation) throw new HttpError(409, 'Seal the complete consolidation before booking shipment', undefined, 'ORDER_NOT_COMPLETE');
    await assertStaffScope(actor, order.sourceStateId, consolidation.hubId);
    if (body.hubId && String(body.hubId) !== String(consolidation.hubId)) throw new HttpError(409, 'Shipment Hub must match the sealed consolidation', undefined, 'HUB_MISMATCH');
    const existing = await Shipment.findOne({ orderId: order._id.toString(), sourceStateId: consolidation.sourceStateId }).lean({ virtuals: true });
    if (existing) {
      if (body.idempotencyKey && existing.bookingIdempotencyKey && body.idempotencyKey !== existing.bookingIdempotencyKey) throw new HttpError(409, 'This Order already has a shipment booking', undefined, 'IDEMPOTENCY_CONFLICT');
      return existing;
    }
    const simulationBooking = provider === 'simulated'
      ? await logisticsProvider('simulated').book({ orderId: order.publicId, providerCostMinor: body.providerCostMinor, providerQuoteMinor: body.providerQuoteMinor })
      : undefined;
    let shipment;
    try {
      shipment = await Shipment.create({ publicId: await nextPublicId('shipment'), orderId: order._id.toString(), fulfilmentGroupId: consolidation.fulfilmentGroupId, sourceStateId: consolidation.sourceStateId, hubId: consolidation.hubId, consolidationId: consolidation._id.toString(), provider, serviceName: body.serviceName || (provider === 'simulated' ? 'Hook Logistics Simulator' : undefined), externalReference: body.externalReference || simulationBooking?.externalReference, status: ShipmentStatus.BOOKED_WITH_PROVIDER, deliveryAddressSnapshot: order.addressSnapshot || order.deliveryAddress, estimatedDeliveryAt: body.estimatedDeliveryAt ? new Date(body.estimatedDeliveryAt) : simulationBooking?.estimatedDeliveryAt ? new Date(String(simulationBooking.estimatedDeliveryAt)) : undefined, bookedAt: new Date(), providerCostMinor: body.providerCostMinor, providerQuoteMinor: body.providerQuoteMinor, trackingNumber: body.trackingNumber || simulationBooking?.trackingNumber, trackingEvents: [{ status: 'BOOKED_WITH_PROVIDER', at: new Date(), actorId: actor.accountId, mode: provider === 'simulated' ? 'simulation' : undefined }], evidence: evidence(body.evidence), releaseStatus: order.commercePaymentMethod === 'PAY_AT_HANDOVER' ? 'AWAITING_HANDOVER_PAYMENT' : 'NOT_REQUIRED', bookingIdempotencyKey: body.idempotencyKey, version: 1 });
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
      const concurrent = await Shipment.findOne({ orderId: order._id.toString(), sourceStateId: consolidation.sourceStateId }).lean({ virtuals: true });
      if (concurrent) return concurrent;
      throw error;
    }
    await Order.updateOne({ _id: order._id }, { $set: { commerceStatus: CommerceOrderStatus.READY_FOR_DISPATCH, customerProgress: [{ key: 'shipment', label: 'Shipment booked and awaiting pickup', at: new Date() }] }, $push: { timeline: { status: 'BOOKED_WITH_PROVIDER', actor: actor.accountId, at: new Date() } } });
    await this.publishOrderUpdate(order._id.toString(), order.sourceStateId, consolidation.hubId);
    return shipment.toJSON();
  }

  async updateShipment(actor: Actor, identifierValue: string, body: Record<string, any>) {
    const shipment = await Shipment.findOne(identifier(identifierValue)).lean({ virtuals: true }) as any;
    if (!shipment) throw new HttpError(404, 'Shipment not found', undefined, 'NOT_FOUND'); await assertStaffScope(actor, shipment.sourceStateId, shipment.hubId);
    const order = await Order.findById(shipment.orderId).select('commercePaymentMethod publicId version userId sourceStateId totalMinor').lean() as any;
    const next = String(body.status) as ShipmentStatus;
    if (!Object.values(ShipmentStatus).includes(next)) throw new HttpError(400, 'Invalid shipment status', undefined, 'VALIDATION_ERROR');
    const allowed: Record<string, string[]> = { BOOKED_WITH_PROVIDER: ['AWAITING_PICKUP', 'CANCELLED'], AWAITING_PICKUP: ['PICKED_UP', 'CANCELLED'], PICKED_UP: ['IN_TRANSIT', 'DELIVERY_FAILED'], IN_TRANSIT: ['OUT_FOR_DELIVERY', 'DELIVERY_FAILED', 'RETURN_IN_TRANSIT'], OUT_FOR_DELIVERY: ['DELIVERED', 'DELIVERY_FAILED', 'AWAITING_HANDOVER_PAYMENT'], AWAITING_HANDOVER_PAYMENT: ['RELEASE_APPROVED'], RELEASE_APPROVED: ['DELIVERED'], DELIVERY_FAILED: ['RETURN_IN_TRANSIT'], RETURN_IN_TRANSIT: ['RETURNED_TO_HOOK'] };
    if (shipment.status !== next && !allowed[shipment.status]?.includes(next)) throw new HttpError(409, 'Invalid shipment status transition', { current: shipment.status, next }, 'INVALID_STATE_TRANSITION');
    if (next === ShipmentStatus.AWAITING_HANDOVER_PAYMENT && order?.commercePaymentMethod !== 'PAY_AT_HANDOVER') throw new HttpError(409, 'Only Pay-at-Handover shipments can require handover payment', undefined, 'PAYMENT_METHOD_NOT_ALLOWED');
    if (next === ShipmentStatus.RELEASE_APPROVED && order?.commercePaymentMethod !== 'PAY_AT_HANDOVER') throw new HttpError(409, 'Only Pay-at-Handover shipments can be released through handover payment', undefined, 'PAYMENT_METHOD_NOT_ALLOWED');
    if (next === ShipmentStatus.DELIVERED && shipment.releaseStatus === 'AWAITING_HANDOVER_PAYMENT') throw new HttpError(409, 'Verified Pay-at-Handover payment is required before release', undefined, 'PAYMENT_REQUIRED');
    const updated = await Shipment.findOneAndUpdate({ _id: shipment._id, version: body.version ?? shipment.version }, { $set: { status: next, releaseStatus: next === ShipmentStatus.RELEASE_APPROVED ? 'RELEASE_APPROVED' : shipment.releaseStatus, pickedUpAt: next === ShipmentStatus.PICKED_UP ? new Date() : shipment.pickedUpAt, deliveredAt: next === ShipmentStatus.DELIVERED ? new Date() : shipment.deliveredAt, failedAt: next === ShipmentStatus.DELIVERY_FAILED ? new Date() : shipment.failedAt }, $push: { trackingEvents: { status: next, at: new Date(), actorId: actor.accountId, note: body.note } }, $inc: { version: 1 } }, { returnDocument: 'after' }).lean({ virtuals: true });
    if (!updated) throw new HttpError(409, 'Shipment changed. Refresh and try again.', undefined, 'STALE_VERSION');
    if (shipment.fulfilmentGroupId) {
      const groupStatus = next === ShipmentStatus.DELIVERED ? 'DELIVERED'
        : [ShipmentStatus.PICKED_UP, ShipmentStatus.IN_TRANSIT, ShipmentStatus.OUT_FOR_DELIVERY].includes(next) ? 'IN_TRANSIT'
          : next === ShipmentStatus.RETURN_IN_TRANSIT ? 'ON_HOLD' : undefined;
      if (groupStatus) await OrderFulfilmentGroup.updateOne({ publicId: shipment.fulfilmentGroupId }, { $set: { status: groupStatus, shipmentId: shipment.publicId } });
    }
    const allShipments = await Shipment.find({ orderId: shipment.orderId }).select('status').lean();
    const deliveredCount = allShipments.filter((entry) => entry.status === ShipmentStatus.DELIVERED).length;
    const movingCount = allShipments.filter((entry) => [ShipmentStatus.PICKED_UP, ShipmentStatus.IN_TRANSIT, ShipmentStatus.OUT_FOR_DELIVERY].includes(entry.status)).length;
    const orderStatus = next === ShipmentStatus.RETURN_IN_TRANSIT ? CommerceOrderStatus.RETURN_IN_PROGRESS
      : deliveredCount === allShipments.length ? CommerceOrderStatus.DELIVERED
        : deliveredCount > 0 ? CommerceOrderStatus.PARTIALLY_DELIVERED
          : movingCount > 0 && allShipments.length > 1 ? CommerceOrderStatus.PARTIALLY_IN_TRANSIT
            : movingCount > 0 ? CommerceOrderStatus.IN_TRANSIT : undefined;
    if (orderStatus) await Order.updateOne({ _id: shipment.orderId }, { $set: { commerceStatus: orderStatus, deliveredAt: orderStatus === CommerceOrderStatus.DELIVERED ? new Date() : undefined }, $push: { timeline: { status: next, actor: actor.accountId, at: new Date() } } });
    await this.publishOrderUpdate(shipment.orderId, shipment.sourceStateId, shipment.hubId);
    if (orderStatus === CommerceOrderStatus.DELIVERED && order?.userId) {
      await createCommerceNotification({
        eventKey: `order:${order.publicId}:delivered`,
        userId: order.userId,
        title: "Order delivered",
        body: "Your Hook Order has been delivered. Thanks for shopping with Hook.",
        type: "order_delivered",
        data: { orderId: order.publicId },
      }).catch(() => undefined);
      const customer = await User.findById(order.userId).select('email firstName').lean() as any;
      if (customer?.email) {
        await this.email.sendOrderStatusUpdate({
          to: customer.email,
          name: customer.firstName,
          orderCode: order.publicId,
          status: 'Delivered',
          amount: Number(order.totalMinor || 0) / 100,
        }).catch(() => undefined);
      }
    }
    return updated;
  }

  async partnerCustody(actor: Actor, orderIdentifier: string) {
    const partner = await HookPartner.findOne({ accountId: actor.accountId, status: 'active' }).lean({ virtuals: true }) as any; if (!partner) throw new HttpError(403, 'Active Hook Partner required', undefined, 'ACCESS_DENIED');
    const order = await Order.findOne({ ...identifier(orderIdentifier), initiatingPartnerId: partner.publicId }).lean({ virtuals: true }) as any; if (!order) throw new HttpError(404, 'Order not found', undefined, 'NOT_FOUND');
    if (order.deliveryMethod !== 'PARTNER_PICKUP') throw new HttpError(409, 'Partner custody is only available for Partner pickup Orders', undefined, 'DELIVERY_METHOD_NOT_ALLOWED');
    const shipment = await Shipment.findOne({ orderId: order._id.toString() }).lean({ virtuals: true }) as any; if (!shipment) throw new HttpError(409, 'Shipment is not ready for Partner custody', undefined, 'INVALID_STATE_TRANSITION');
    const existing = await PartnerCustody.findOne({ orderId: order._id.toString() }).lean({ virtuals: true }) as any; if (existing) return safeCustody(existing);
    const code = String(randomInt(100000, 999999));
    const custody = await PartnerCustody.create({ publicId: await nextPublicId('partnerCustody'), orderId: order._id.toString(), shipmentId: shipment._id.toString(), partnerId: partner.publicId, status: 'AWAITING_RECEIPT', collectionCodeHash: digest(code), collectionCodeHint: hint(code), codeAttempts: 0, codeSentAt: new Date(), expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), customerEmailSnapshot: String((order.customerSnapshot as any)?.email || order.guestEmail || ''), idempotencyKey: `custody:${order._id}`, history: [{ action: 'CODE_CREATED', actorId: actor.accountId, at: new Date() }] });
    return { ...safeCustody(custody.toJSON()) as any, collectionCode: code };
  }

  async partnerCustodyList(actor: Actor, query: Record<string, unknown>) {
    const partner = await HookPartner.findOne({ accountId: actor.accountId, status: 'active' }).lean({ virtuals: true }) as any;
    if (!partner) throw new HttpError(403, 'Active Hook Partner required', undefined, 'ACCESS_DENIED');
    const filter: Record<string, unknown> = { partnerId: partner.publicId };
    if (typeof query.status === 'string' && query.status) filter.status = query.status;
    return PartnerCustody.find(filter)
      .select('-collectionCodeHash -history')
      .sort({ expiresAt: 1, createdAt: -1 })
      .limit(Math.min(Number(query.limit || 100), 200))
      .lean({ virtuals: true });
  }

  async receiveCustody(actor: Actor, identifierValue: string, idempotencyKey?: string) { return this.mutateCustody(actor, identifierValue, 'receive', undefined, idempotencyKey); }
  async releaseCustody(actor: Actor, identifierValue: string, code: string, idempotencyKey?: string) { return this.mutateCustody(actor, identifierValue, 'release', code, idempotencyKey); }

  private async mutateCustody(actor: Actor, identifierValue: string, action: 'receive' | 'release', code?: string, idempotencyKey?: string) {
    const partner = await HookPartner.findOne({ accountId: actor.accountId, status: 'active' }).lean({ virtuals: true }) as any; if (!partner) throw new HttpError(403, 'Active Hook Partner required', undefined, 'ACCESS_DENIED');
    const custody = await PartnerCustody.findOne({ ...identifier(identifierValue), partnerId: partner.publicId }).select('+collectionCodeHash').lean({ virtuals: true }) as any; if (!custody) throw new HttpError(404, 'Partner custody record not found', undefined, 'NOT_FOUND');
    if (idempotencyKey) {
      const replay = custody.history?.find((item: any) => item.idempotencyKey === idempotencyKey && item.action === (action === 'receive' ? 'RECEIVED' : 'RELEASED'));
      if (replay) return safeCustody(custody);
    }
    if (new Date(custody.expiresAt) < new Date() && custody.status !== 'RELEASED') { await PartnerCustody.updateOne({ _id: custody._id }, { $set: { status: 'OVERDUE' } }); throw new HttpError(409, 'Partner custody window has expired', undefined, 'CUSTODY_EXPIRED'); }
    if (action === 'receive') {
      if (custody.status !== 'AWAITING_RECEIPT') throw new HttpError(409, 'Package is not awaiting receipt', undefined, 'INVALID_STATE_TRANSITION');
      const received = await PartnerCustody.findOneAndUpdate({ _id: custody._id, status: 'AWAITING_RECEIPT' }, { $set: { status: 'IN_CUSTODY', receivedAt: new Date() }, $push: { history: { action: 'RECEIVED', actorId: actor.accountId, at: new Date(), ...(idempotencyKey ? { idempotencyKey } : {}) } } }, { returnDocument: 'after' }).lean({ virtuals: true });
      if (!received) throw new HttpError(409, 'Custody state changed. Refresh and try again.', undefined, 'STALE_VERSION');
      await this.publishOrderUpdate(custody.orderId);
      return safeCustody(received as any);
    }
    if (custody.status !== 'IN_CUSTODY') throw new HttpError(409, 'Package is not available for collection', undefined, 'INVALID_STATE_TRANSITION');
    if (custody.codeAttempts >= 5) throw new HttpError(429, 'Too many collection attempts', undefined, 'RATE_LIMITED');
    if (!code || digest(code) !== custody.collectionCodeHash) { await PartnerCustody.updateOne({ _id: custody._id }, { $inc: { codeAttempts: 1 } }); throw new HttpError(400, 'Invalid collection code', undefined, 'VALIDATION_ERROR'); }
    const payment = await Payment.findOne({ orderId: custody.orderId }).select('commerceStatus').lean() as any;
    if (!payment || payment.commerceStatus !== CommercePaymentStatus.CONFIRMED) throw new HttpError(409, 'Confirmed payment is required before collection', undefined, 'PAYMENT_REQUIRED');
    const result = await PartnerCustody.findOneAndUpdate({ _id: custody._id, status: 'IN_CUSTODY' }, { $set: { status: 'RELEASED', releasedAt: new Date() }, $push: { history: { action: 'RELEASED', actorId: actor.accountId, at: new Date(), ...(idempotencyKey ? { idempotencyKey } : {}) } } }, { returnDocument: 'after' }).lean({ virtuals: true });
    if (!result) throw new HttpError(409, 'Custody state changed. Refresh and try again.', undefined, 'STALE_VERSION');
    await Order.updateOne({ _id: custody.orderId }, { $set: { commerceStatus: CommerceOrderStatus.COLLECTED, fulfilmentCompletedAt: new Date() }, $push: { timeline: { status: 'COLLECTED', actor: actor.accountId, at: new Date() } } });
    await this.publishOrderUpdate(custody.orderId);
    return safeCustody(result as any);
  }

  async createReturn(actor: Actor, orderIdentifier: string, body: Record<string, any>) {
    const order = await orderByIdentifier(orderIdentifier); if (order.userId !== actor.accountId) throw new HttpError(404, 'Order not found', undefined, 'NOT_FOUND');
    const completedStatuses = [CommerceOrderStatus.DELIVERED, CommerceOrderStatus.COLLECTED, CommerceOrderStatus.COMPLETED];
    const completedAt = order.deliveredAt || order.fulfilmentCompletedAt;
    if (!completedStatuses.includes(order.commerceStatus) || !completedAt || Date.now() - new Date(completedAt).getTime() > 24 * 60 * 60 * 1000) throw new HttpError(409, 'Return requests must be reported within 24 hours of delivery or collection', undefined, 'RETURN_WINDOW_CLOSED');
    const itemIds = Array.isArray(body.orderItemIds) ? body.orderItemIds : [];
    const items = await OrderItem.find({ orderId: order._id.toString(), _id: { $in: itemIds } }).lean() as any[];
    if (!items.length || items.some((item) => ['REFUNDED', 'CANCELLED'].includes(String(item.fulfilmentStatus || '').toUpperCase()))) throw new HttpError(400, 'Select at least one eligible delivered item', undefined, 'VALIDATION_ERROR');
    const record = await ReturnRequest.create({ publicId: await nextPublicId('returnRequest'), orderId: order._id.toString(), orderItemIds: items.map((item: any) => item._id.toString()), requestedBy: actor.accountId, reasonType: body.reasonType, reason: body.reason, evidenceAssetIds: body.evidenceAssetIds || [], status: 'REQUESTED', reportedAt: new Date() });
    await Order.updateOne({ _id: order._id }, { $set: { commerceStatus: CommerceOrderStatus.RETURN_IN_PROGRESS }, $push: { timeline: { status: 'RETURN_REQUESTED', actor: actor.accountId, at: new Date() } } });
    await this.publishOrderUpdate(order._id.toString(), order.sourceStateId);
    return record.toJSON();
  }

  async reviewReturn(actor: Actor, identifierValue: string, body: Record<string, any>) {
    const request = await ReturnRequest.findOne(identifier(identifierValue)).lean({ virtuals: true }) as any;
    if (!request) throw new HttpError(404, 'Return request not found', undefined, 'NOT_FOUND');
    const order = await Order.findById(request.orderId).select('sourceStateId').lean() as any;
    if (!order) throw new HttpError(404, 'Return request not found', undefined, 'NOT_FOUND');
    await assertStaffScope(actor, order.sourceStateId);
    if (!['APPROVED', 'REJECTED'].includes(body.decision)) throw new HttpError(400, 'Return decision is required', undefined, 'VALIDATION_ERROR');
    const updated = await ReturnRequest.findOneAndUpdate({ _id: request._id, status: { $in: ['REQUESTED', 'UNDER_REVIEW'] } }, { $set: { status: body.decision, reviewedBy: actor.accountId, decisionNote: body.reason, handoverDueAt: body.decision === 'APPROVED' ? new Date(Date.now() + 5 * 24 * 60 * 60 * 1000) : undefined } }, { returnDocument: 'after' }).lean({ virtuals: true }); if (!updated) throw new HttpError(409, 'Return request has already been decided', undefined, 'INVALID_STATE_TRANSITION');
    await this.publishOrderUpdate(request.orderId, order.sourceStateId);
    return updated;
  }

  async createRefund(actor: Actor, body: Record<string, any>) {
    await assertStaffScope(actor); if (!body.orderId || !Number.isSafeInteger(body.amountMinor) || body.amountMinor < 1 || !body.idempotencyKey) throw new HttpError(400, 'Refund order, amount and idempotency key are required', undefined, 'VALIDATION_ERROR');
    const order = await orderByIdentifier(body.orderId);
    await assertStaffScope(actor, order.sourceStateId);
    const existing = await FulfilmentRefund.findOne({ idempotencyKey: body.idempotencyKey }).lean({ virtuals: true });
    if (existing) {
      if (String((existing as any).orderId) !== String(order._id)) throw new HttpError(409, 'This refund idempotency key belongs to another order', undefined, 'IDEMPOTENCY_CONFLICT');
      return existing;
    }
    if (body.returnRequestId) {
      const returnRequest = await ReturnRequest.findOne(identifier(String(body.returnRequestId))).select('orderId').lean() as any;
      if (!returnRequest || String(returnRequest.orderId) !== String(order._id)) throw new HttpError(400, 'Return request does not belong to this order', undefined, 'VALIDATION_ERROR');
    }
    const payment = await Payment.findOne({ orderId: order._id.toString() }).lean({ virtuals: true }) as any;
    if (!payment || payment.commerceStatus !== CommercePaymentStatus.CONFIRMED) {
      throw new HttpError(409, 'Only captured payments can be refunded', undefined, 'PAYMENT_NOT_CAPTURED');
    }
    const captured = Number(payment.amountMinor || 0);
    const refunded = Number(payment.refundedAmount || 0);
    if (body.amountMinor > captured - refunded) throw new HttpError(409, 'Refund exceeds the captured balance', undefined, 'REFUND_LIMIT_EXCEEDED');
    const result = await FulfilmentRefund.create({ publicId: await nextPublicId('refund'), orderId: order._id.toString(), paymentId: payment._id?.toString(), returnRequestId: body.returnRequestId, amountMinor: body.amountMinor, currency: order.currency || 'NGN', reason: body.reason, status: 'REQUESTED', idempotencyKey: body.idempotencyKey });
    await this.publishOrderUpdate(order._id.toString(), order.sourceStateId);
    return result.toJSON();
  }

  async processRefund(actor: Actor, identifierValue: string, body: Record<string, any>) {
    await assertStaffScope(actor);
    const refund = await FulfilmentRefund.findOne(identifier(identifierValue)).lean({ virtuals: true }) as any;
    if (!refund) throw new HttpError(404, 'Refund record not found', undefined, 'NOT_FOUND');
    const order = await Order.findById(refund.orderId).select('sourceStateId userId publicId').lean() as any;
    if (!order) throw new HttpError(404, 'Refund record not found', undefined, 'NOT_FOUND');
    await assertStaffScope(actor, order.sourceStateId);
    if (refund.status === 'REFUNDED') return refund;
    if (!['REQUESTED', 'APPROVED', 'FAILED'].includes(refund.status)) {
      throw new HttpError(409, 'Refund is already being processed', undefined, 'INVALID_STATE_TRANSITION');
    }
    if (body.idempotencyKey && body.idempotencyKey !== refund.idempotencyKey) {
      throw new HttpError(409, 'Refund idempotency key does not match the request', undefined, 'IDEMPOTENCY_CONFLICT');
    }
    if (!refund.paymentId) throw new HttpError(409, 'Refund payment record is missing', undefined, 'PAYMENT_RECORD_MISSING');
    await FulfilmentRefund.updateOne({ _id: refund._id }, { $set: { status: 'PROVIDER_PENDING', approvedBy: actor.accountId }, $unset: { failureReason: 1 } });
    try {
      const providerResult = await this.payments.refund(refund.paymentId, refund.amountMinor, refund.idempotencyKey);
      const updated = await FulfilmentRefund.findOneAndUpdate(
        { _id: refund._id, status: 'PROVIDER_PENDING' },
        { $set: { status: 'REFUNDED', providerReference: providerResult.providerReference, processedAt: new Date() } },
        { returnDocument: 'after' },
      ).lean({ virtuals: true });
      const paymentAfter = await Payment.findById(refund.paymentId).select('commerceStatus').lean() as any;
      const fullyRefunded = paymentAfter?.commerceStatus === CommercePaymentStatus.REFUNDED;
      await Order.updateOne(
        { _id: refund.orderId },
        {
          ...(fullyRefunded ? { $set: { commerceStatus: CommerceOrderStatus.REFUNDED } } : {}),
          $push: { timeline: { status: fullyRefunded ? 'REFUNDED' : 'PARTIALLY_REFUNDED', actor: actor.accountId, at: new Date() } },
        },
      );
      await this.publishOrderUpdate(refund.orderId, order.sourceStateId);
      if (order.userId) {
        await createCommerceNotification({
          eventKey: `order:${order.publicId}:refund:${refund.publicId}`,
          userId: order.userId,
          title: fullyRefunded ? "Refund processed" : "Partial refund processed",
          body: `A refund of ${(refund.amountMinor / 100).toLocaleString("en-NG", { style: "currency", currency: refund.currency || "NGN" })} has been processed to your original payment method.`,
          type: "refund_processed",
          data: { orderId: order.publicId, refundId: refund.publicId },
        }).catch(() => undefined);
        const customer = await User.findById(order.userId).select('email firstName').lean() as any;
        if (customer?.email) {
          await this.email.sendRefundIssued({
            to: customer.email,
            name: customer.firstName,
            orderCode: order.publicId,
            amountMinor: refund.amountMinor,
            currency: refund.currency || 'NGN',
            fullyRefunded,
          }).catch(() => undefined);
        }
      }
      await audit('fulfilment.refund.processed', 'refund', refund.publicId, actor.accountId, { providerReference: providerResult.providerReference, amountMinor: refund.amountMinor }, body.reason);
      return updated;
    } catch (error) {
      await FulfilmentRefund.updateOne({ _id: refund._id }, { $set: { status: 'FAILED', failureReason: error instanceof Error ? error.message.slice(0, 500) : 'Provider refund failed' } });
      throw error;
    }
  }

  async customerOrderProgress(customerId: string, orderIdentifier: string) {
    const order = await Order.findOne({ ...identifier(orderIdentifier), userId: customerId }).lean({ virtuals: true }) as any;
    if (!order) throw new HttpError(404, 'Order not found', undefined, 'NOT_FOUND');
    const [tasks, packages, shipments, custody, returns, refunds] = await Promise.all([
      FulfilmentTask.find({ orderId: order._id.toString() }).select('publicId status acceptedAt sourcingStartedAt productSecuredAt packedAt hubReceivedAt completedAt').lean({ virtuals: true }),
      HubPackage.find({ orderId: order._id.toString() }).select('publicId status receivedAt qcPassedAt').lean({ virtuals: true }),
      Shipment.find({ orderId: order._id.toString() }).select('publicId fulfilmentGroupId status provider trackingNumber estimatedDeliveryAt pickedUpAt deliveredAt trackingEvents').lean({ virtuals: true }),
      PartnerCustody.findOne({ orderId: order._id.toString() }).select('-collectionCodeHash -history').lean({ virtuals: true }),
      ReturnRequest.find({ orderId: order._id.toString() }).select('-reviewedBy -decisionNote').lean({ virtuals: true }),
      FulfilmentRefund.find({ orderId: order._id.toString() }).select('-idempotencyKey').lean({ virtuals: true }),
    ]);
    return {
      order: { id: order.publicId, status: order.commerceStatus || order.status },
      tasks: tasks.map((task: any) => ({ id: task.publicId, status: task.status, acceptedAt: task.acceptedAt, sourcingStartedAt: task.sourcingStartedAt, productSecuredAt: task.productSecuredAt, packedAt: task.packedAt, hubReceivedAt: task.hubReceivedAt, completedAt: task.completedAt })),
      packages: packages.map((pack: any) => ({ id: pack.publicId, status: pack.status, receivedAt: pack.receivedAt, qcPassedAt: pack.qcPassedAt })),
      shipments: shipments.map((shipment: any) => {
        const dispatched = ['PICKED_UP', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED'].includes(String(shipment.status));
        return { id: shipment.publicId, fulfilmentGroupId: shipment.fulfilmentGroupId, status: shipment.status, estimatedDeliveryAt: shipment.estimatedDeliveryAt, provider: dispatched ? shipment.provider : undefined, trackingNumber: dispatched ? shipment.trackingNumber : undefined, pickedUpAt: dispatched ? shipment.pickedUpAt : undefined, deliveredAt: shipment.deliveredAt, trackingEvents: dispatched ? shipment.trackingEvents : [] };
      }),
      custody: custody ? { status: custody.status, collectionCodeHint: custody.collectionCodeHint, expiresAt: custody.expiresAt, receivedAt: custody.receivedAt, releasedAt: custody.releasedAt } : undefined,
      returns: returns.map((item: any) => ({ id: item.publicId, status: item.status, reasonType: item.reasonType, requestedAt: item.requestedAt, createdAt: item.createdAt })),
      refunds: refunds.map((item: any) => ({ id: item.publicId, status: item.status, amountMinor: item.amountMinor, currency: item.currency, processedAt: item.processedAt })),
    };
  }

  async controlTower(actor: Actor, query: Record<string, unknown>) {
    await assertStaffScope(actor, query.stateId as string | undefined, query.hubId as string | undefined);
    const filter: Record<string, any> = { status: { $nin: [FulfilmentTaskStatus.COMPLETED, FulfilmentTaskStatus.CANCELLED] } };
    const exceptionFilter: Record<string, any> = { status: { $in: ['OPEN', 'IN_PROGRESS'] } };
    const shipmentFilter: Record<string, any> = {};
    if (query.stateId) { filter.sourceStateId = query.stateId; exceptionFilter.sourceStateId = query.stateId; shipmentFilter.sourceStateId = query.stateId; }
    if (query.hubId) { filter.hubId = query.hubId; exceptionFilter.hubId = query.hubId; shipmentFilter.hubId = query.hubId; }
    if (actor.stateIds?.length) { filter.sourceStateId = { $in: actor.stateIds }; exceptionFilter.sourceStateId = { $in: actor.stateIds }; shipmentFilter.sourceStateId = { $in: actor.stateIds }; }
    if (actor.hubIds?.length) { filter.hubId = { $in: actor.hubIds }; exceptionFilter.hubId = { $in: actor.hubIds }; shipmentFilter.hubId = { $in: actor.hubIds }; }
    const orderScope = actor.stateIds?.length
      ? (await Order.distinct('_id', { sourceStateId: { $in: actor.stateIds } })).map(String)
      : null;
    const returnFilter: Record<string, any> = { status: { $in: ['REQUESTED', 'UNDER_REVIEW', 'APPROVED'] } };
    if (orderScope) returnFilter.orderId = { $in: orderScope };
    const [tasks, exceptions, shipments, returns] = await Promise.all([FulfilmentTask.find(filter).sort({ acceptanceDueAt: 1 }).limit(200).lean({ virtuals: true }), FulfilmentException.find(exceptionFilter).sort({ createdAt: -1 }).limit(100).lean({ virtuals: true }), Shipment.find(shipmentFilter).sort({ createdAt: -1 }).limit(100).lean({ virtuals: true }), ReturnRequest.find(returnFilter).sort({ createdAt: -1 }).limit(100).lean({ virtuals: true })]);
    return { tasks, exceptions, shipments, returns, metrics: { openTasks: tasks.length, openExceptions: exceptions.length, activeShipments: shipments.filter((item: any) => ![ShipmentStatus.DELIVERED, ShipmentStatus.CANCELLED, ShipmentStatus.RETURNED_TO_HOOK].includes(item.status)).length, openReturns: returns.length } };
  }

  async exceptions(actor: Actor, query: Record<string, unknown>) {
    const tower = await this.controlTower(actor, query);
    return tower.exceptions;
  }

  async returns(actor: Actor, query: Record<string, unknown>) {
    await assertStaffScope(actor, query.stateId as string | undefined);
    const filter: Record<string, any> = query.status ? { status: query.status } : {};
    if (actor.stateIds?.length || query.stateId) {
      const states = (query.stateId ? [String(query.stateId)] : (actor.stateIds || []).map(String));
      filter.orderId = { $in: (await Order.distinct('_id', { sourceStateId: { $in: states } })).map(String) };
    }
    const records = await ReturnRequest.find(filter).sort({ createdAt: -1 }).limit(Math.min(Number(query.limit || 100), 200)).lean({ virtuals: true });
    return records;
  }

  async refunds(actor: Actor, query: Record<string, unknown>) {
    await assertStaffScope(actor, query.stateId as string | undefined);
    const filter: Record<string, any> = query.status ? { status: query.status } : {};
    if (actor.stateIds?.length || query.stateId) {
      const states = (query.stateId ? [String(query.stateId)] : (actor.stateIds || []).map(String));
      filter.orderId = { $in: (await Order.distinct('_id', { sourceStateId: { $in: states } })).map(String) };
    }
    return FulfilmentRefund.find(filter).sort({ createdAt: -1 }).limit(Math.min(Number(query.limit || 100), 200)).lean({ virtuals: true });
  }

  async shipments(actor: Actor, query: Record<string, unknown>) {
    await assertStaffScope(actor, query.stateId as string | undefined, query.hubId as string | undefined);
    const filter: Record<string, any> = query.status ? { status: query.status } : {};
    if (query.stateId) filter.sourceStateId = query.stateId;
    if (query.hubId) filter.hubId = query.hubId;
    if (actor.stateIds?.length) filter.sourceStateId = { $in: actor.stateIds };
    if (actor.hubIds?.length) filter.hubId = { $in: actor.hubIds };
    return Shipment.find(filter).sort({ createdAt: -1 }).limit(Math.min(Number(query.limit || 100), 200)).lean({ virtuals: true });
  }

  async logisticsReadiness(actor: Actor) {
    await assertStaffScope(actor);
    return { providers: logisticsReadiness() };
  }

  async logisticsWebhook(provider: string, eventId: string, payload: Record<string, unknown>, signature: string) {
    if (!['gig', 'fez', 'manual', 'simulated', 'other'].includes(provider)) throw new HttpError(400, 'Unsupported logistics provider', undefined, 'VALIDATION_ERROR');
    if (!eventId) throw new HttpError(400, 'Provider event id is required', undefined, 'VALIDATION_ERROR');
    if (['gig', 'fez'].includes(provider) && process.env[`LOGISTICS_${provider.toUpperCase()}_ENABLED`] !== 'true') throw new HttpError(503, `${provider.toUpperCase()} logistics integration is not enabled`, undefined, 'PROVIDER_NOT_READY');
    if (provider === 'simulated' && !isLogisticsSimulationEnabled()) throw new HttpError(503, 'Logistics simulation is not enabled', undefined, 'PROVIDER_NOT_READY');
    if (!logisticsSignature(provider, payload, signature)) throw new HttpError(401, 'Invalid logistics webhook signature', undefined, 'WEBHOOK_SIGNATURE_INVALID');
    const payloadHash = digest(JSON.stringify(payload));
    const normalizedProvider = provider as any;
    const existing = await LogisticsWebhookEvent.findOne({ provider: normalizedProvider, providerEventId: eventId }).lean({ virtuals: true });
    if (existing) return { duplicate: true, event: existing };
    const event = await LogisticsWebhookEvent.create({ provider: normalizedProvider, providerEventId: eventId, payloadHash, eventType: String(payload.eventType || payload.status || 'unknown'), shipmentId: payload.shipmentId ? String(payload.shipmentId) : undefined, signatureVerified: true, status: 'RECEIVED', receivedAt: new Date() });
    const shipmentValue = payload.shipmentId ? String(payload.shipmentId) : undefined;
    const shipment = shipmentValue
      ? await Shipment.findOne({ $or: [identifier(shipmentValue), { externalReference: shipmentValue }, { trackingNumber: shipmentValue }] } as any).lean({ virtuals: true }) as any
      : null;
    const statusKey = String(payload.status || payload.eventType || '').toUpperCase().replace(/[ .-]+/g, '_');
    const statusMap: Record<string, ShipmentStatus> = {
      BOOKED: ShipmentStatus.BOOKED_WITH_PROVIDER,
      BOOKED_WITH_PROVIDER: ShipmentStatus.BOOKED_WITH_PROVIDER,
      AWAITING_PICKUP: ShipmentStatus.AWAITING_PICKUP,
      PICKED_UP: ShipmentStatus.PICKED_UP,
      IN_TRANSIT: ShipmentStatus.IN_TRANSIT,
      OUT_FOR_DELIVERY: ShipmentStatus.OUT_FOR_DELIVERY,
      AWAITING_HANDOVER_PAYMENT: ShipmentStatus.AWAITING_HANDOVER_PAYMENT,
      DELIVERED: ShipmentStatus.DELIVERED,
      DELIVERY_FAILED: ShipmentStatus.DELIVERY_FAILED,
      RETURN_IN_TRANSIT: ShipmentStatus.RETURN_IN_TRANSIT,
      RETURNED_TO_HOOK: ShipmentStatus.RETURNED_TO_HOOK,
    };
    const next = statusMap[statusKey];
    if (!shipment || !next) {
      await LogisticsWebhookEvent.updateOne({ _id: event._id }, { $set: { status: 'IGNORED', processedAt: new Date() } });
      return { duplicate: false, event: { ...event.toJSON(), status: 'IGNORED' }, accepted: false };
    }
    const allowed: Record<string, string[]> = { READY_FOR_BOOKING: ['BOOKED_WITH_PROVIDER'], BOOKING_PENDING: ['BOOKED_WITH_PROVIDER'], BOOKED_WITH_PROVIDER: ['AWAITING_PICKUP', 'CANCELLED'], AWAITING_PICKUP: ['PICKED_UP', 'CANCELLED'], PICKED_UP: ['IN_TRANSIT', 'DELIVERY_FAILED'], IN_TRANSIT: ['OUT_FOR_DELIVERY', 'DELIVERY_FAILED', 'RETURN_IN_TRANSIT'], OUT_FOR_DELIVERY: ['DELIVERED', 'DELIVERY_FAILED', 'AWAITING_HANDOVER_PAYMENT'], AWAITING_HANDOVER_PAYMENT: ['RELEASE_APPROVED'], RELEASE_APPROVED: ['DELIVERED'], DELIVERY_FAILED: ['RETURN_IN_TRANSIT'], RETURN_IN_TRANSIT: ['RETURNED_TO_HOOK'] };
    if (shipment.status !== next && !allowed[shipment.status]?.includes(next)) {
      await LogisticsWebhookEvent.updateOne({ _id: event._id }, { $set: { status: 'IGNORED', processedAt: new Date() } });
      return { duplicate: false, event: { ...event.toJSON(), status: 'IGNORED' }, accepted: false };
    }
    const updated = await Shipment.findOneAndUpdate({ _id: shipment._id, version: shipment.version }, { $set: { status: next, trackingNumber: payload.trackingNumber ? String(payload.trackingNumber) : shipment.trackingNumber, pickedUpAt: next === ShipmentStatus.PICKED_UP ? new Date() : shipment.pickedUpAt, deliveredAt: next === ShipmentStatus.DELIVERED ? new Date() : shipment.deliveredAt, failedAt: next === ShipmentStatus.DELIVERY_FAILED ? new Date() : shipment.failedAt }, $push: { trackingEvents: { status: next, at: new Date(), actorId: `WEBHOOK:${provider}`, note: typeof payload.note === 'string' ? payload.note.slice(0, 500) : undefined } }, $inc: { version: 1 } }, { returnDocument: 'after' }).lean({ virtuals: true });
    if (!updated) throw new HttpError(409, 'Shipment changed while processing provider event', undefined, 'STALE_VERSION');
    const orderStatus = next === ShipmentStatus.DELIVERED ? CommerceOrderStatus.DELIVERED : next === ShipmentStatus.RETURN_IN_TRANSIT ? CommerceOrderStatus.RETURN_IN_PROGRESS : [ShipmentStatus.PICKED_UP, ShipmentStatus.IN_TRANSIT, ShipmentStatus.OUT_FOR_DELIVERY].includes(next) ? CommerceOrderStatus.IN_TRANSIT : undefined;
    if (orderStatus) await Order.updateOne({ _id: shipment.orderId }, { $set: { commerceStatus: orderStatus, deliveredAt: next === ShipmentStatus.DELIVERED ? new Date() : undefined }, $push: { timeline: { status: next, actor: `WEBHOOK:${provider}`, at: new Date() } } });
    await this.publishOrderUpdate(shipment.orderId, shipment.sourceStateId, shipment.hubId);
    await LogisticsWebhookEvent.updateOne({ _id: event._id }, { $set: { status: 'PROCESSED', processedAt: new Date(), shipmentId: shipment.publicId || shipment._id.toString() } });
    return { duplicate: false, event: { ...event.toJSON(), status: 'PROCESSED' }, shipment: updated, accepted: true };
  }
}

export const fulfilmentService = new FulfilmentService();
