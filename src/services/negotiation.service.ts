import { createHash } from 'crypto';
import mongoose from 'mongoose';
import { AccountType, NegotiatedQuoteStatus, NegotiationStatus, ProductStatus } from '@lib/constants';
import { NegotiatedQuote, ProductVariant } from '@models/catalog/catalog.model';
import { Negotiation } from '@models/negotiations/negotiation.model';
import { Product } from '@models/products/product.model';
import { User } from '@models/users/user.model';
import { nextPublicId } from './public-id.service';
import { AzureNegotiationService } from './azure-negotiation.service';
import { PricingEngine } from './pricing-engine.service';
import { HttpError } from '@utils/http';

export interface NegotiationIdentity {
  customerId?: string;
  guestSessionId?: string;
}

function identityFilter(identity: NegotiationIdentity) {
  if (identity.customerId) return { customerId: identity.customerId };
  if (identity.guestSessionId) return { guestSessionId: identity.guestSessionId };
  throw new HttpError(401, 'Customer or guest session required', undefined, 'AUTHENTICATION_REQUIRED');
}

function identifier(identifier: string) {
  return /^[a-f\d]{24}$/i.test(identifier)
    ? { $or: [{ _id: identifier }, { publicId: identifier }] }
    : { publicId: identifier };
}

function requestHash(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function present(session: any, response?: Record<string, unknown>) {
  return {
    negotiationId: session.publicId,
    status: session.status,
    offerCount: session.offerCount,
    maximumOffers: session.maximumOffers,
    remainingOffers: Math.max(0, session.maximumOffers - session.offerCount),
    transcript: session.transcript,
    expiresAt: session.expiresAt,
    quoteId: session.quoteId,
    ...response,
  };
}

export class NegotiationService {
  private readonly pricing = new PricingEngine();
  private readonly language = new AzureNegotiationService();

  async start(identity: NegotiationIdentity, input: { productId: string; variantId: string; quantity: number }) {
    const product = await Product.findOne({
      ...identifier(input.productId),
      status: ProductStatus.PUBLISHED,
      'negotiationRules.enabled': true,
      deletedAt: { $exists: false },
    }).lean({ virtuals: true });
    if (!product) throw new HttpError(404, 'Negotiable product not found', undefined, 'NOT_FOUND');
    const variant = await ProductVariant.findOne({
      ...identifier(input.variantId),
      productId: product._id.toString(),
      sourceStateId: product.sourceStateId,
      marketId: product.marketId,
      active: true,
      deletedAt: { $exists: false },
    }).lean({ virtuals: true });
    if (!variant) throw new HttpError(404, 'Product variant not found', undefined, 'NOT_FOUND');
    const rules = product.negotiationRules;
    if (
      !rules?.minimumNegotiablePriceMinor
      || rules.maximumDiscountMinor === undefined
      || !product.sellingPriceMinor
    ) {
      throw new HttpError(409, 'Negotiation is not configured for this product', undefined, 'NEGOTIATION_DISABLED');
    }
    const publicId = await nextPublicId('negotiation');
    const session = await Negotiation.create({
      publicId,
      ...identityFilter(identity),
      channel: 'shopper',
      productId: product._id.toString(),
      variantId: variant._id.toString(),
      quantity: input.quantity,
      currency: product.currency || 'NGN',
      status: NegotiationStatus.ACTIVE,
      offerCount: 0,
      maximumOffers: 3,
      transcript: [],
      rulesSnapshot: {
        sellingPriceMinor: product.sellingPriceMinor,
        minimumNegotiablePriceMinor: rules.minimumNegotiablePriceMinor,
        maximumDiscountMinor: rules.maximumDiscountMinor,
        maximumOffers: 3,
      },
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      version: 1,
    });
    return present(session.toJSON());
  }

  async offer(
    identity: NegotiationIdentity,
    negotiationIdentifier: string,
    offeredPriceMinor: number,
    idempotencyKey: string,
  ) {
    if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 200) {
      throw new HttpError(400, 'A valid Idempotency-Key header is required', undefined, 'VALIDATION_ERROR');
    }
    const session = await Negotiation.findOne({
      ...identifier(negotiationIdentifier),
      ...identityFilter(identity),
    }).lean({ virtuals: true });
    if (!session) throw new HttpError(404, 'Negotiation not found', undefined, 'NOT_FOUND');
    const hash = requestHash({ offeredPriceMinor });
    const prior = session.idempotencyResults?.find((entry) => entry.key === idempotencyKey);
    if (prior) {
      if (prior.requestHash !== hash) {
        throw new HttpError(409, 'This idempotency key was used with another offer', undefined, 'IDEMPOTENCY_CONFLICT');
      }
      return prior.response;
    }
    if (session.status !== NegotiationStatus.ACTIVE) {
      throw new HttpError(409, 'This negotiation is no longer active', undefined, 'INVALID_STATE_TRANSITION');
    }
    if (session.expiresAt && session.expiresAt <= new Date()) {
      await Negotiation.updateOne({ _id: session._id, status: NegotiationStatus.ACTIVE }, { $set: { status: NegotiationStatus.EXPIRED } });
      throw new HttpError(410, 'This negotiation has expired', undefined, 'NEGOTIATION_QUOTE_EXPIRED');
    }
    if (!session.rulesSnapshot) throw new HttpError(409, 'Negotiation pricing snapshot is unavailable', undefined, 'PRICING_BOUNDARY_VIOLATION');
    const offerNumber = session.offerCount + 1;
    const decision = this.pricing.decide({
      ...session.rulesSnapshot,
      customerOfferMinor: offeredPriceMinor,
      offerNumber,
      currency: session.currency,
    });
    const wording = await this.language.phrase(decision);
    const response: Record<string, unknown> = {
      negotiationId: session.publicId,
      decision: decision.decision,
      message: wording.message,
      ...(decision.acceptedPriceMinor ? { acceptedPriceMinor: decision.acceptedPriceMinor } : {}),
      ...(decision.counterPriceMinor ? { counterPriceMinor: decision.counterPriceMinor } : {}),
      remainingOffers: decision.remainingOffers,
      status: decision.decision === 'ACCEPT' && identity.customerId
        ? NegotiationStatus.AGREED
        : decision.decision === 'DECLINE'
          ? NegotiationStatus.DECLINED
          : NegotiationStatus.ACTIVE,
      ...(decision.decision === 'ACCEPT' && !identity.customerId ? { requiresCustomerVerification: true } : {}),
      providerFallback: wording.fallbackUsed,
    };

    let quote: any;
    const transaction = await mongoose.startSession();
    try {
      await transaction.withTransaction(async () => {
        if (decision.decision === 'ACCEPT' && identity.customerId) {
          quote = await this.createQuote(session, identity.customerId!, decision.acceptedPriceMinor!, transaction);
          response.quoteId = quote.publicId;
          response.quoteExpiresAt = quote.expiresAt;
        }
        const updated = await Negotiation.findOneAndUpdate(
          { _id: session._id, version: session.version, 'idempotencyResults.key': { $ne: idempotencyKey } },
          {
            $set: {
              status: response.status,
              lastDecision: decision.decision,
              lastCounterPriceMinor: decision.counterPriceMinor,
              agreedPriceMinor: decision.acceptedPriceMinor,
              ...(quote ? { quoteId: quote._id.toString() } : {}),
            },
            $inc: { offerCount: 1, version: 1 },
            $push: {
              transcript: {
                $each: [
                  { role: 'customer', message: 'Customer submitted an offer.', offeredPriceMinor, createdAt: new Date() },
                  { role: 'hook', message: wording.message, decision: decision.decision, createdAt: new Date() },
                ],
              },
              providerTelemetry: wording.telemetry,
              idempotencyResults: { key: idempotencyKey, requestHash: hash, response, createdAt: new Date() },
            },
          },
          { returnDocument: 'after', session: transaction },
        ).lean({ virtuals: true });
        if (!updated) throw new HttpError(409, 'The negotiation changed before this offer completed', undefined, 'IDEMPOTENCY_CONFLICT');
      });
      return response;
    } finally {
      await transaction.endSession();
    }
  }

  async accept(identity: NegotiationIdentity, negotiationIdentifier: string) {
    if (!identity.customerId) {
      throw new HttpError(403, 'Verify your customer account before saving an accepted quote', undefined, 'NEGOTIATION_OWNERSHIP_REQUIRED');
    }
    const customer = await User.findOne({
      _id: identity.customerId,
      accountType: AccountType.CUSTOMER,
      isEmailVerified: true,
      isActive: true,
    }).lean();
    if (!customer) throw new HttpError(403, 'A verified customer account is required', undefined, 'NEGOTIATION_OWNERSHIP_REQUIRED');
    const session = await Negotiation.findOne({
      ...identifier(negotiationIdentifier),
      customerId: identity.customerId,
      status: NegotiationStatus.ACTIVE,
    }).lean({ virtuals: true });
    if (!session) throw new HttpError(404, 'Active negotiation not found', undefined, 'NOT_FOUND');
    if (!session.lastCounterPriceMinor || !session.rulesSnapshot) {
      throw new HttpError(409, 'There is no counteroffer to accept', undefined, 'INVALID_STATE_TRANSITION');
    }
    if (session.expiresAt && session.expiresAt <= new Date()) {
      await Negotiation.updateOne({ _id: session._id }, { $set: { status: NegotiationStatus.EXPIRED } });
      throw new HttpError(410, 'This negotiation has expired', undefined, 'NEGOTIATION_QUOTE_EXPIRED');
    }
    const transaction = await mongoose.startSession();
    try {
      let quote: any;
      await transaction.withTransaction(async () => {
        quote = await this.createQuote(session, identity.customerId!, session.lastCounterPriceMinor!, transaction);
        const updated = await Negotiation.updateOne(
          { _id: session._id, version: session.version, status: NegotiationStatus.ACTIVE },
          {
            $set: {
              status: NegotiationStatus.AGREED,
              agreedPriceMinor: session.lastCounterPriceMinor,
              quoteId: quote._id.toString(),
              lastDecision: 'ACCEPT',
            },
            $push: {
              transcript: {
                role: 'hook',
                message: 'Counteroffer accepted. Your price is locked for 30 minutes.',
                decision: 'ACCEPT',
                createdAt: new Date(),
              },
            },
            $inc: { version: 1 },
          },
          { session: transaction },
        );
        if (!updated.modifiedCount) throw new HttpError(409, 'Negotiation state changed before acceptance', undefined, 'INVALID_STATE_TRANSITION');
      });
      return {
        negotiationId: session.publicId,
        status: NegotiationStatus.AGREED,
        quoteId: quote.publicId,
        agreedPriceMinor: quote.agreedPriceMinor,
        expiresAt: quote.expiresAt,
      };
    } finally {
      await transaction.endSession();
    }
  }

  async close(identity: NegotiationIdentity, negotiationIdentifier: string) {
    const updated = await Negotiation.findOneAndUpdate(
      { ...identifier(negotiationIdentifier), ...identityFilter(identity), status: NegotiationStatus.ACTIVE },
      { $set: { status: NegotiationStatus.CLOSED }, $inc: { version: 1 } },
      { returnDocument: 'after' },
    ).lean({ virtuals: true });
    if (!updated) throw new HttpError(404, 'Active negotiation not found', undefined, 'NOT_FOUND');
    return present(updated);
  }

  async detail(identity: NegotiationIdentity, negotiationIdentifier: string) {
    const session = await Negotiation.findOne({
      ...identifier(negotiationIdentifier),
      ...identityFilter(identity),
    }).lean({ virtuals: true });
    if (!session) throw new HttpError(404, 'Negotiation not found', undefined, 'NOT_FOUND');
    if (session.status === NegotiationStatus.ACTIVE && session.expiresAt && session.expiresAt <= new Date()) {
      await Negotiation.updateOne({ _id: session._id }, { $set: { status: NegotiationStatus.EXPIRED } });
      session.status = NegotiationStatus.EXPIRED;
    }
    return present(session);
  }

  async list(identity: NegotiationIdentity) {
    const sessions = await Negotiation.find(identityFilter(identity)).sort({ createdAt: -1 }).limit(50).lean({ virtuals: true });
    return sessions.map((session) => present(session));
  }

  private async createQuote(session: any, customerId: string, agreedPriceMinor: number, mongoSession: mongoose.ClientSession) {
    const existing = await NegotiatedQuote.findOne({ negotiationId: session._id.toString() }).session(mongoSession);
    if (existing) return existing;
    const publicId = await nextPublicId('quote');
    const records = await NegotiatedQuote.create([{
      publicId,
      negotiationId: session._id.toString(),
      customerId,
      productId: session.productId,
      variantId: session.variantId,
      quantity: session.quantity,
      currency: session.currency,
      originalPriceMinor: session.rulesSnapshot.sellingPriceMinor,
      agreedPriceMinor,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      status: NegotiatedQuoteStatus.ACTIVE,
    }], { session: mongoSession });
    return records[0];
  }
}

export async function expireNegotiationsAndQuotes(now = new Date()) {
  const [sessions, quotes] = await Promise.all([
    Negotiation.updateMany(
      { status: NegotiationStatus.ACTIVE, expiresAt: { $lte: now } },
      { $set: { status: NegotiationStatus.EXPIRED } },
    ),
    NegotiatedQuote.updateMany(
      { status: NegotiatedQuoteStatus.ACTIVE, expiresAt: { $lte: now } },
      { $set: { status: NegotiatedQuoteStatus.EXPIRED } },
    ),
  ]);
  return { sessions: sessions.modifiedCount, quotes: quotes.modifiedCount };
}
