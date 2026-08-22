import crypto from 'crypto';
import mongoose from 'mongoose';
import { MarketVendor, VendorCollection, VendorInvitation, VendorPaymentRecord, type VendorPaymentProfile } from '@models/catalog/market-vendor.model';
import { Product } from '@models/products/product.model';
import { ProductSubmission } from '@models/catalog/catalog.model';
import { Market } from '@models/platform/network.model';
import { MarketAssociateMarketAssignment, MarketAssociateProfile, StaffProfile } from '@models/platform/operations-accounts.model';
import { Role } from '@models/platform/access.model';
import { User } from '@models/users/user.model';
import { Notification } from '@models/notifications/notification.model';
import { publishRealtime } from '@services/realtime.service';
import { nextPublicId } from '@services/public-id.service';
import { decryptVendorAccountNumber, encryptVendorAccountNumber } from '@lib/vendor-payment-crypto';
import { HttpError } from '@utils/http';
import { EmailService } from '@emails/email.service';

const email = new EmailService();

function idQuery(identifier: string) {
  return /^[a-f\d]{24}$/i.test(identifier)
    ? { $or: [{ _id: identifier }, { publicId: identifier }] }
    : { publicId: identifier };
}

function normalizePhone(value: string) {
  const digits = value.replace(/\D/g, '');
  if (digits.startsWith('234') && digits.length === 13) return `0${digits.slice(3)}`;
  return digits;
}

function safeVendor(vendor: any) {
  const profile = vendor.paymentProfile || {};
  const publicId = vendor.publicId;
  return {
    id: publicId,
    publicId,
    marketId: vendor.marketId,
    stateId: vendor.stateId,
    businessName: vendor.businessName,
    contactName: vendor.contactName,
    phone: vendor.phone,
    email: vendor.email || null,
    address: vendor.address || null,
    preferredContactChannel: vendor.preferredContactChannel,
    status: vendor.status,
    consentAt: vendor.consentAt || null,
    invitedByMarketAssociateId: vendor.invitedByMarketAssociateId || null,
    lastContactedAt: vendor.lastContactedAt || null,
    paymentProfile: {
      method: profile.method || 'cash',
      bankName: profile.bankName || null,
      accountName: profile.accountName || null,
      accountNumberLast4: profile.accountNumberLast4 || null,
      verificationStatus: profile.verificationStatus || 'unverified',
    },
    notes: vendor.notes || null,
    createdAt: vendor.createdAt,
    updatedAt: vendor.updatedAt,
  };
}

function safePaymentRecord(payment: any) {
  if (!payment) return null;
  return {
    publicId: payment.publicId,
    amountMinor: payment.amountMinor,
    currency: payment.currency || 'NGN',
    method: payment.method,
    status: payment.status,
    reference: payment.reference || null,
    recordedAt: payment.recordedAt || null,
    reconciledAt: payment.reconciledAt || null,
  };
}

async function findMarket(identifier: string) {
  const market = await Market.findOne({ ...idQuery(identifier), deletedAt: { $exists: false } }).lean({ virtuals: true });
  if (!market) throw new HttpError(404, 'Market not found', undefined, 'NOT_FOUND');
  if (market.status !== 'active') throw new HttpError(409, 'The selected Market is inactive', undefined, 'MARKET_INACTIVE');
  return market;
}

async function marketAssociateContext(accountId: string, marketIdentifier: string) {
  const [marketAssociate, market] = await Promise.all([
    MarketAssociateProfile.findOne({ accountId, status: 'active' }).lean({ virtuals: true }),
    findMarket(marketIdentifier),
  ]);
  if (!marketAssociate) throw new HttpError(403, 'Active Market Associate profile required', undefined, 'ACCESS_DENIED');
  const assignment = await MarketAssociateMarketAssignment.findOne({
    marketAssociateId: marketAssociate._id.toString(),
    marketId: market._id.toString(),
    status: 'active',
    activeFrom: { $lte: new Date() },
    $or: [{ activeTo: { $exists: false } }, { activeTo: null }, { activeTo: { $gt: new Date() } }],
  }).lean({ virtuals: true });
  if (!assignment) throw new HttpError(403, 'An active Market assignment is required', undefined, 'RUNNER_MARKET_ASSIGNMENT_REQUIRED');
  return { marketAssociate, market, assignment };
}

function paymentProfile(input: any): VendorPaymentProfile | undefined {
  if (!input) return undefined;
  const accountNumber = String(input.accountNumber || '').replace(/\s/g, '');
  return {
    method: input.method || 'cash',
    bankName: input.bankName?.trim() || undefined,
    bankCode: input.bankCode?.trim() || undefined,
    accountName: input.accountName?.trim() || undefined,
    accountNumberEncrypted: accountNumber ? encryptVendorAccountNumber(accountNumber) : undefined,
    accountNumberLast4: accountNumber ? accountNumber.slice(-4) : undefined,
    verificationStatus: 'unverified',
    updatedAt: new Date(),
  };
}

async function notifyAccount(accountId: string, title: string, body: string, data: Record<string, unknown>) {
  const [notification, account] = await Promise.all([
    Notification.create({ userId: accountId, title, body, type: 'catalog_availability', data, isRead: false }),
    User.findById(accountId).select('email firstName').lean(),
  ]);
  publishRealtime({ type: 'notification.created', entityId: notification.id, version: 1 }, { accountId });
  if (account?.email) {
    await email.send({
      to: account.email,
      subject: title,
      html: `<p>Hello ${account.firstName || 'Market Associate'},</p><p>${body}</p><p>Open your Hook Market Associate workspace to record the current supplier availability.</p>`,
      text: `${body}\n\nOpen your Hook Market Associate workspace to record the current supplier availability.`,
    }).catch(() => undefined);
  }
}

export class MarketVendorService {
  async marketAssociateMarket(accountId: string, identifier: string) {
    const { market, marketAssociate } = await marketAssociateContext(accountId, identifier);
    const [vendors, assignments, submissions, products, collections] = await Promise.all([
      MarketVendor.find({ marketId: market._id.toString(), deletedAt: { $exists: false } }).sort({ businessName: 1 }).lean({ virtuals: true }),
      MarketAssociateMarketAssignment.find({ marketId: market._id.toString(), status: 'active' }).lean({ virtuals: true }),
      ProductSubmission.find({ marketId: market._id.toString(), deletedAt: { $exists: false } }).select('publicId basicTitle status marketVendorId marketAssociateId availabilityStatus updatedAt').sort({ updatedAt: -1 }).limit(50).lean({ virtuals: true }),
      Product.find({ marketId: market._id.toString(), deletedAt: { $exists: false } }).select('publicId title status availabilityStatus sourceMarketVendorId sourceMarketAssociateId images mediaAssetIds updatedAt').sort({ updatedAt: -1 }).limit(50).lean({ virtuals: true }),
      VendorCollection.find({ marketId: market._id.toString(), deletedAt: { $exists: false } }).sort({ createdAt: -1 }).limit(50).lean({ virtuals: true }),
    ]);
    const vendorMap = new Map(vendors.map((vendor: any) => [String(vendor._id), vendor]));
    const presentVendorReference = (record: any, field: 'marketVendorId' | 'sourceMarketVendorId') => {
      const vendor = vendorMap.get(String(record[field] || ''));
      return {
        ...record,
        [field]: vendor?.publicId || null,
        marketVendorName: vendor?.businessName || null,
      };
    };
    return {
      market,
      currentMarketAssociateId: marketAssociate._id.toString(),
      assignments,
      vendors: vendors.map(safeVendor),
      products: products.map((product: any) => presentVendorReference(product, 'sourceMarketVendorId')),
      submissions: submissions.map((submission: any) => presentVendorReference(submission, 'marketVendorId')),
      collections: collections.map((collection: any) => presentVendorReference(collection, 'marketVendorId')),
      summary: {
        vendors: vendors.length,
        assignedMarketAssociates: assignments.length,
        products: products.length,
        pendingAvailability: products.filter((item: any) => item.availabilityStatus === 'unconfirmed').length,
        collections: collections.length,
      },
    };
  }

  async listMarketAssociateVendors(accountId: string, marketIdentifier: string, search?: string) {
    const { market } = await marketAssociateContext(accountId, marketIdentifier);
    const filter: Record<string, unknown> = { marketId: market._id.toString(), deletedAt: { $exists: false } };
    if (search?.trim()) filter.$or = [
      { businessName: { $regex: search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } },
      { contactName: { $regex: search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } },
      { phone: { $regex: search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') } },
    ];
    const vendors = await MarketVendor.find(filter).sort({ businessName: 1 }).lean({ virtuals: true });
    return vendors.map(safeVendor);
  }

  async createMarketAssociateVendor(accountId: string, marketIdentifier: string, input: any) {
    const { market, marketAssociate } = await marketAssociateContext(accountId, marketIdentifier);
    const normalizedPhone = normalizePhone(input.phone);
    if (normalizedPhone.length < 7) throw new HttpError(400, 'Enter a valid vendor phone number', undefined, 'VALIDATION_ERROR');
    const emailAddress = input.email?.trim().toLowerCase() || undefined;
    const duplicate = await MarketVendor.findOne({
      marketId: market._id.toString(),
      deletedAt: { $exists: false },
      $or: [{ normalizedPhone }, ...(emailAddress ? [{ email: emailAddress }] : [])],
    }).lean();
    if (duplicate) throw new HttpError(409, 'This vendor is already tracked in this Market', undefined, 'MARKET_VENDOR_DUPLICATE');

    const token = crypto.randomBytes(32).toString('base64url');
    const invitationExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const session = await mongoose.startSession();
    let vendor: any;
    let invitation: any;
    try {
      await session.withTransaction(async () => {
        vendor = await MarketVendor.create([{
          publicId: await nextPublicId('marketVendor'),
          marketId: market._id.toString(),
          stateId: market.stateId,
          businessName: input.businessName.trim(),
          contactName: input.contactName.trim(),
          normalizedPhone,
          phone: input.phone.trim(),
          email: emailAddress,
          address: input.address?.trim(),
          preferredContactChannel: input.preferredContactChannel || 'phone',
          paymentProfile: paymentProfile(input.paymentProfile),
          status: 'pending',
          invitedByMarketAssociateId: marketAssociate._id.toString(),
          notes: input.notes?.trim(),
        } as any], { session });
        invitation = await VendorInvitation.create([{
          publicId: await nextPublicId('vendorInvitation'),
          vendorId: vendor[0].id,
          marketId: market._id.toString(),
          invitedByMarketAssociateId: marketAssociate._id.toString(),
          email: emailAddress,
          tokenHash: crypto.createHash('sha256').update(token).digest('hex'),
          status: 'pending',
          expiresAt: invitationExpiresAt,
        }], { session });
      });
    } finally {
      await session.endSession();
    }

    const baseUrl = (process.env.ADMIN_APP_URL || 'http://localhost:3000').replace(/\/$/, '');
    const inviteUrl = `${baseUrl}/vendor-invitations/accept?token=${encodeURIComponent(token)}`;
    let delivery = { delivered: false, provider: 'share_link' };
    if (emailAddress) {
      delivery = await email.send({
        to: emailAddress,
        subject: `Hook is verifying your ${market.name} supplier profile`,
        html: `<p>Hello ${input.contactName.trim()},</p><p>${input.businessName.trim()} has been added to the Hook supplier directory for ${market.name}.</p><p>Review and confirm your contact details here: <a href="${inviteUrl}">${inviteUrl}</a></p><p>This link expires in 7 days.</p>`,
        text: `Review your Hook supplier profile for ${market.name}: ${inviteUrl}`,
      });
      await VendorInvitation.updateOne({ _id: invitation[0]._id }, { $set: { emailSentAt: new Date() } });
    }
    return { vendor: safeVendor(vendor[0]), invitation: { publicId: invitation[0].publicId, status: invitation[0].status, expiresAt: invitationExpiresAt, inviteUrl, delivery } };
  }

  async updateMarketAssociateVendor(accountId: string, identifier: string, input: any) {
    const marketAssociate = await MarketAssociateProfile.findOne({ accountId, status: 'active' }).lean();
    if (!marketAssociate) throw new HttpError(403, 'Active Market Associate profile required', undefined, 'ACCESS_DENIED');
    const vendor = await MarketVendor.findOne({ ...idQuery(identifier), deletedAt: { $exists: false } });
    if (!vendor) throw new HttpError(404, 'Market vendor not found', undefined, 'NOT_FOUND');
    await marketAssociateContext(accountId, vendor.marketId);
    const update: Record<string, unknown> = {};
    for (const key of ['businessName', 'contactName', 'address', 'preferredContactChannel', 'notes']) {
      if (input[key] !== undefined) update[key] = typeof input[key] === 'string' ? input[key].trim() : input[key];
    }
    if (input.phone !== undefined) {
      update.phone = input.phone.trim();
      update.normalizedPhone = normalizePhone(input.phone);
    }
    if (input.email !== undefined) update.email = input.email?.trim().toLowerCase() || undefined;
    if (input.paymentProfile !== undefined) update.paymentProfile = paymentProfile(input.paymentProfile);
    const updated = await MarketVendor.findByIdAndUpdate(vendor._id, { $set: update }, { returnDocument: 'after' }).lean({ virtuals: true });
    return safeVendor(updated);
  }

  async marketAssociateVendor(accountId: string, identifier: string) {
    const marketAssociate = await MarketAssociateProfile.findOne({ accountId, status: 'active' }).lean();
    if (!marketAssociate) throw new HttpError(403, 'Active Market Associate profile required', undefined, 'ACCESS_DENIED');
    const vendor = await MarketVendor.findOne({ ...idQuery(identifier), deletedAt: { $exists: false } }).lean({ virtuals: true });
    if (!vendor) throw new HttpError(404, 'Market vendor not found', undefined, 'NOT_FOUND');
    await marketAssociateContext(accountId, vendor.marketId);
    const [collections, invitations] = await Promise.all([
      VendorCollection.find({ marketVendorId: vendor._id.toString(), marketAssociateId: marketAssociate._id.toString(), deletedAt: { $exists: false } }).sort({ createdAt: -1 }).limit(50).lean({ virtuals: true }),
      VendorInvitation.find({ vendorId: vendor._id.toString(), deletedAt: { $exists: false } }).select('publicId status expiresAt emailSentAt acceptedAt createdAt').sort({ createdAt: -1 }).limit(20).lean({ virtuals: true }),
    ]);
    return { vendor: safeVendor(vendor), collections, invitations };
  }

  async adminUpdateVendor(identifier: string, input: any) {
    const vendor = await MarketVendor.findOne({ ...idQuery(identifier), deletedAt: { $exists: false } });
    if (!vendor) throw new HttpError(404, 'Market vendor not found', undefined, 'NOT_FOUND');
    const update: Record<string, unknown> = {};
    for (const key of ['businessName', 'contactName', 'address', 'preferredContactChannel', 'notes', 'status']) {
      if (input[key] !== undefined) update[key] = typeof input[key] === 'string' ? input[key].trim() : input[key];
    }
    if (input.phone !== undefined) { update.phone = input.phone.trim(); update.normalizedPhone = normalizePhone(input.phone); }
    if (input.email !== undefined) update.email = input.email?.trim().toLowerCase() || undefined;
    if (input.paymentProfile !== undefined) update.paymentProfile = paymentProfile(input.paymentProfile);
    const updated = await MarketVendor.findByIdAndUpdate(vendor._id, { $set: update }, { returnDocument: 'after' }).lean({ virtuals: true });
    return safeVendor(updated);
  }

  async adminCollections(query: Record<string, unknown>) {
    const filter: Record<string, unknown> = { deletedAt: { $exists: false } };
    if (query.marketId) filter.marketId = String(query.marketId);
    if (query.vendorId) filter.marketVendorId = String(query.vendorId);
    if (query.marketAssociateId) filter.marketAssociateId = String(query.marketAssociateId);
    if (query.status) filter.status = String(query.status);
    const limit = Math.min(Math.max(Number(query.limit || 50), 1), 100);
    const [rows, total] = await Promise.all([
      VendorCollection.find(filter).sort({ createdAt: -1 }).limit(limit).lean({ virtuals: true }),
      VendorCollection.countDocuments(filter),
    ]);
    const payments = await VendorPaymentRecord.find({ collectionId: { $in: rows.map((row: any) => String(row._id)) }, deletedAt: { $exists: false } })
      .select('publicId collectionId amountMinor currency method status reference recordedAt reconciledAt')
      .lean({ virtuals: true });
    const paymentMap = new Map(payments.map((payment: any) => [String(payment.collectionId), payment]));
    const markets = await Market.find({ _id: { $in: rows.map((row: any) => row.marketId) } }).select('_id stateId').lean();
    const stateMap = new Map(markets.map((market: any) => [String(market._id), market.stateId]));
    return {
      data: rows.map((row: any) => ({
        ...row,
        stateId: stateMap.get(String(row.marketId)),
        payment: safePaymentRecord(paymentMap.get(String(row._id))),
      })),
      total,
    };
  }

  async adminCollection(identifier: string) {
    const collection = await VendorCollection.findOne({ ...idQuery(identifier), deletedAt: { $exists: false } }).lean({ virtuals: true });
    if (!collection) throw new HttpError(404, 'Vendor collection not found', undefined, 'NOT_FOUND');
    const market = await Market.findById(collection.marketId).select('stateId').lean();
    return { ...collection, stateId: market?.stateId };
  }

  async resendInvitation(accountId: string, identifier: string) {
    const marketAssociate = await MarketAssociateProfile.findOne({ accountId, status: 'active' }).lean();
    if (!marketAssociate) throw new HttpError(403, 'Active Market Associate profile required', undefined, 'ACCESS_DENIED');
    const vendor = await MarketVendor.findOne({ ...idQuery(identifier), deletedAt: { $exists: false } }).lean({ virtuals: true });
    if (!vendor) throw new HttpError(404, 'Market vendor not found', undefined, 'NOT_FOUND');
    await marketAssociateContext(accountId, vendor.marketId);
    await VendorInvitation.updateMany({ vendorId: vendor._id.toString(), status: 'pending' }, { $set: { status: 'cancelled', cancelledAt: new Date() } });
    const token = crypto.randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const invitation = await VendorInvitation.create({
      publicId: await nextPublicId('vendorInvitation'),
      vendorId: vendor._id.toString(),
      marketId: vendor.marketId,
      invitedByMarketAssociateId: marketAssociate._id.toString(),
      email: vendor.email,
      tokenHash: crypto.createHash('sha256').update(token).digest('hex'),
      status: 'pending',
      expiresAt,
    });
    const inviteUrl = `${(process.env.ADMIN_APP_URL || 'http://localhost:3000').replace(/\/$/, '')}/vendor-invitations/accept?token=${encodeURIComponent(token)}`;
    if (vendor.email) {
      await email.send({ to: vendor.email, subject: `Hook supplier profile reminder for ${vendor.businessName}`, html: `<p>Review your Hook supplier profile here: <a href="${inviteUrl}">${inviteUrl}</a></p>`, text: inviteUrl }).then(() => VendorInvitation.updateOne({ _id: invitation._id }, { $set: { emailSentAt: new Date() } }));
    }
    return { publicId: invitation.publicId, expiresAt, inviteUrl, email: vendor.email || null };
  }

  async acceptInvitation(token: string, input: { contactName?: string; phone?: string; email?: string }) {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const invitation = await VendorInvitation.findOne({ tokenHash, status: 'pending', expiresAt: { $gt: new Date() } });
    if (!invitation) throw new HttpError(400, 'This supplier invitation is invalid or expired', undefined, 'TOKEN_INVALID');
    const update: Record<string, unknown> = { status: 'active', consentAt: new Date() };
    if (input.contactName?.trim()) update.contactName = input.contactName.trim();
    if (input.phone?.trim()) { update.phone = input.phone.trim(); update.normalizedPhone = normalizePhone(input.phone); }
    if (input.email?.trim()) update.email = input.email.trim().toLowerCase();
    const vendor = await MarketVendor.findByIdAndUpdate(invitation.vendorId, { $set: update }, { returnDocument: 'after' }).lean({ virtuals: true });
    await VendorInvitation.updateOne({ _id: invitation._id }, { $set: { status: 'accepted', acceptedAt: new Date() } });
    return safeVendor(vendor);
  }

  async recordCollection(accountId: string, submissionIdentifier: string, input: any) {
    const marketAssociate = await MarketAssociateProfile.findOne({ accountId, status: 'active' }).lean();
    if (!marketAssociate) throw new HttpError(403, 'Active Market Associate profile required', undefined, 'ACCESS_DENIED');
    const submission = await ProductSubmission.findOne({ ...idQuery(submissionIdentifier), marketAssociateId: marketAssociate._id.toString(), deletedAt: { $exists: false } }).lean({ virtuals: true });
    if (!submission) throw new HttpError(404, 'Product submission not found', undefined, 'NOT_FOUND');
    if (!submission.marketVendorId) throw new HttpError(409, 'This submission has no Market vendor', undefined, 'MARKET_VENDOR_REQUIRED');
    const { market } = await marketAssociateContext(accountId, submission.marketId);
    const vendor = await MarketVendor.findOne({ _id: submission.marketVendorId, marketId: market._id.toString(), status: { $in: ['pending', 'active'] } }).lean({ virtuals: true });
    if (!vendor) throw new HttpError(409, 'The submission vendor is no longer available', undefined, 'MARKET_VENDOR_INVALID');
    const existing = await VendorCollection.findOne({ productSubmissionId: submission._id.toString(), deletedAt: { $exists: false } });
    if (existing) throw new HttpError(409, 'A collection record already exists for this submission', undefined, 'VENDOR_COLLECTION_EXISTS');
    let collection: any;
    let payment: any;
    const transaction = await mongoose.startSession();
    try {
      await transaction.withTransaction(async () => {
        const [createdCollection] = await VendorCollection.create([{
          publicId: await nextPublicId('vendorCollection'),
          marketVendorId: vendor._id.toString(),
          marketId: market._id.toString(),
          marketAssociateId: marketAssociate._id.toString(),
          productSubmissionId: submission._id.toString(),
          productTitleSnapshot: submission.basicTitle,
          quantity: input.quantity,
          actualCostMinor: input.actualCostMinor,
          currency: 'NGN',
          status: 'collected',
          paymentStatus: input.payment ? 'recorded' : 'unpaid',
          collectedAt: new Date(),
          evidenceAssetIds: input.evidenceAssetIds || [],
          notes: input.notes?.trim(),
        }], { session: transaction });
        collection = createdCollection;
        if (input.payment) {
          const [createdPayment] = await VendorPaymentRecord.create([{
            publicId: await nextPublicId('vendorPayment'),
            collectionId: collection.id,
            marketVendorId: vendor._id.toString(),
            marketId: market._id.toString(),
            marketAssociateId: marketAssociate._id.toString(),
            amountMinor: input.payment.amountMinor,
            currency: 'NGN',
            method: input.payment.method,
            status: 'recorded',
            proofAssetIds: input.payment.proofAssetIds || [],
            reference: input.payment.reference?.trim(),
            notes: input.payment.notes?.trim(),
          }], { session: transaction });
          payment = createdPayment;
        }
      });
    } finally {
      await transaction.endSession();
    }
    return { collection, payment, vendor: safeVendor(vendor) };
  }

  async marketAssociateCollections(accountId: string, marketIdentifier?: string) {
    const marketAssociate = await MarketAssociateProfile.findOne({ accountId, status: 'active' }).lean();
    if (!marketAssociate) throw new HttpError(403, 'Active Market Associate profile required', undefined, 'ACCESS_DENIED');
    const filter: Record<string, unknown> = { marketAssociateId: marketAssociate._id.toString(), deletedAt: { $exists: false } };
    if (marketIdentifier) filter.marketId = (await marketAssociateContext(accountId, marketIdentifier)).market._id.toString();
    return VendorCollection.find(filter).sort({ createdAt: -1 }).limit(100).lean({ virtuals: true });
  }

  async adminMarket(identifier: string) {
    const market = await Market.findOne({ ...idQuery(identifier), deletedAt: { $exists: false } }).lean({ virtuals: true });
    if (!market) throw new HttpError(404, 'Market not found', undefined, 'NOT_FOUND');
    const [vendors, assignments, submissions, products, collections, payments] = await Promise.all([
      MarketVendor.find({ marketId: market._id.toString(), deletedAt: { $exists: false } }).sort({ businessName: 1 }).lean({ virtuals: true }),
      MarketAssociateMarketAssignment.find({ marketId: market._id.toString(), status: 'active' }).lean({ virtuals: true }),
      ProductSubmission.find({ marketId: market._id.toString(), deletedAt: { $exists: false } }).select('publicId basicTitle status marketVendorId marketAssociateId availabilityStatus updatedAt').sort({ updatedAt: -1 }).limit(100).lean({ virtuals: true }),
      Product.find({ marketId: market._id.toString(), deletedAt: { $exists: false } }).select('publicId title status availabilityStatus sourceMarketVendorId sourceMarketAssociateId images mediaAssetIds updatedAt').sort({ updatedAt: -1 }).limit(100).lean({ virtuals: true }),
      VendorCollection.find({ marketId: market._id.toString(), deletedAt: { $exists: false } }).sort({ createdAt: -1 }).limit(100).lean({ virtuals: true }),
      VendorPaymentRecord.find({ marketId: market._id.toString(), deletedAt: { $exists: false } }).select('publicId collectionId amountMinor currency method status reference recordedAt reconciledAt').lean({ virtuals: true }),
    ]);
    const marketAssociateIds = assignments.map((item: any) => item.marketAssociateId);
    const marketAssociates = await MarketAssociateProfile.find({ _id: { $in: marketAssociateIds } }).select('publicId accountId availability status stateIds hubIds').lean({ virtuals: true });
    const vendorMap = new Map(vendors.map((vendor: any) => [String(vendor._id), vendor]));
    const paymentMap = new Map(payments.map((payment: any) => [String(payment.collectionId), payment]));
    const presentVendorReference = (record: any, field: 'marketVendorId' | 'sourceMarketVendorId') => {
      const vendor = vendorMap.get(String(record[field] || ''));
      return {
        ...record,
        [field]: vendor?.publicId || null,
        marketVendorName: vendor?.businessName || null,
      };
    };
    return {
      market,
      vendors: vendors.map(safeVendor),
      assignments,
      marketAssociates,
      submissions: submissions.map((submission: any) => presentVendorReference(submission, 'marketVendorId')),
      products: products.map((product: any) => presentVendorReference(product, 'sourceMarketVendorId')),
      collections: collections.map((collection: any) => ({
        ...presentVendorReference(collection, 'marketVendorId'),
        payment: safePaymentRecord(paymentMap.get(String(collection._id))),
      })),
      summary: {
        vendors: vendors.length,
        assignedMarketAssociates: assignments.length,
        products: products.length,
        pendingAvailability: products.filter((item: any) => item.availabilityStatus === 'unconfirmed').length,
        collections: collections.length,
      },
    };
  }

  async adminVendors(identifier: string) {
    const market = await Market.findOne({ ...idQuery(identifier), deletedAt: { $exists: false } }).select('_id').lean();
    if (!market) throw new HttpError(404, 'Market not found', undefined, 'NOT_FOUND');
    const vendors = await MarketVendor.find({ marketId: market._id.toString(), deletedAt: { $exists: false } }).sort({ businessName: 1 }).lean({ virtuals: true });
    return vendors.map(safeVendor);
  }

  async adminVendor(identifier: string) {
    const vendor = await MarketVendor.findOne({ ...idQuery(identifier), deletedAt: { $exists: false } }).lean({ virtuals: true });
    if (!vendor) throw new HttpError(404, 'Market vendor not found', undefined, 'NOT_FOUND');
    const [collections, invitations] = await Promise.all([
      VendorCollection.find({ marketVendorId: vendor._id.toString(), deletedAt: { $exists: false } }).sort({ createdAt: -1 }).limit(100).lean({ virtuals: true }),
      VendorInvitation.find({ vendorId: vendor._id.toString(), deletedAt: { $exists: false } }).select('publicId status expiresAt emailSentAt acceptedAt createdAt').sort({ createdAt: -1 }).lean({ virtuals: true }),
    ]);
    return { vendor: safeVendor(vendor), collections, invitations };
  }

  async adminVendorPaymentDetails(identifier: string) {
    const vendor = await MarketVendor.findOne({ ...idQuery(identifier), deletedAt: { $exists: false } })
      .select('+paymentProfile.accountNumberEncrypted').lean({ virtuals: true });
    if (!vendor) throw new HttpError(404, 'Market vendor not found', undefined, 'NOT_FOUND');
    const profile = vendor.paymentProfile;
    return {
      vendor: safeVendor(vendor),
      accountNumber: profile?.accountNumberEncrypted ? decryptVendorAccountNumber(profile.accountNumberEncrypted) : null,
    };
  }

  async reconcileCollection(identifier: string, actorId: string, status: 'reconciled' | 'disputed', notes?: string) {
    const transaction = await mongoose.startSession();
    let updated: any;
    try {
      await transaction.withTransaction(async () => {
        const collection = await VendorCollection.findOne({ ...idQuery(identifier), deletedAt: { $exists: false } }).session(transaction);
        if (!collection) throw new HttpError(404, 'Vendor collection not found', undefined, 'NOT_FOUND');
        const payment = await VendorPaymentRecord.findOne({ collectionId: collection._id.toString(), deletedAt: { $exists: false } }).session(transaction);
        if (!payment) throw new HttpError(409, 'No payment record exists for this collection', undefined, 'VENDOR_PAYMENT_MISSING');
        const set: Record<string, unknown> = { status, notes: notes?.trim() || undefined };
        const update: Record<string, unknown> = { $set: set };
        if (status === 'reconciled') {
          set.reconciledAt = new Date();
          set.reconciledBy = actorId;
        } else {
          update.$unset = { reconciledAt: 1, reconciledBy: 1 };
        }
        updated = await VendorPaymentRecord.findByIdAndUpdate(payment._id, update, { returnDocument: 'after', session: transaction }).lean({ virtuals: true });
        await VendorCollection.findByIdAndUpdate(collection._id, { $set: { paymentStatus: status } }, { session: transaction });
      });
    } finally {
      await transaction.endSession();
    }
    return updated;
  }

  async notifyAvailability(accountId: string, product: any) {
    const marketAssociateId = product.sourceMarketAssociateId || product.commercialApproval?.sourceMarketAssociateId;
    let accounts: string[] = [];
    if (marketAssociateId) {
      const marketAssociate = await MarketAssociateProfile.findById(marketAssociateId).select('accountId status').lean();
      if (marketAssociate?.status === 'active') accounts = [marketAssociate.accountId];
    }
    if (!accounts.length && product.marketId) {
      const assignments = await MarketAssociateMarketAssignment.find({ marketId: product.marketId, status: 'active' }).select('marketAssociateId').lean();
      const marketAssociates = await MarketAssociateProfile.find({ _id: { $in: assignments.map((item) => item.marketAssociateId) }, status: 'active' }).select('accountId').lean();
      accounts = marketAssociates.map((item) => item.accountId);
    }
    await Promise.all(accounts.map((accountIdValue) => notifyAccount(accountIdValue, 'Product availability check', `${product.title} needs a fresh availability check before it can be shown to customers.`, { productId: product.publicId, marketId: product.marketId })));
    return accounts.length;
  }

  async notifyAvailabilityOverdue(product: any) {
    const roles = await Role.find({
      isActive: true,
      $or: [
        { key: 'SUPER_ADMIN' },
        { permissionKeys: 'catalog.availability.manage' },
      ],
    }).select('_id').lean();
    const staff = await StaffProfile.find({ status: 'active', roleIds: { $in: roles.map((role) => role._id.toString()) } })
      .select('accountId scopeType stateIds').lean();
    const scopedStaff = staff.filter((profile) => profile.scopeType === 'global' || !product.sourceStateId || profile.stateIds.includes(product.sourceStateId));
    await Promise.all(scopedStaff.map((profile) => notifyAccount(
      profile.accountId,
      'Overdue product availability check',
      `${product.title} has passed its supplier availability deadline and remains unavailable to customers.`,
      { productId: product.publicId, marketId: product.marketId, dueAt: product.availabilityCheckDueAt },
    )));
    return scopedStaff.length;
  }
}
