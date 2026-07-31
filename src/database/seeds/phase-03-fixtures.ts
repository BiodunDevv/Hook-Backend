import dotenv from 'dotenv';
import { createHash } from 'crypto';
import { connectDatabase, disconnectDatabase } from '@config/data-source';
import {
  AccountStatus,
  AccountType,
  ProductAvailabilityStatus,
  ProductStatus,
  ProductSubmissionStatus,
  ScopeType,
  UserRole,
} from '@lib/constants';
import { hashPassword } from '@lib/security';
import { nextPublicId } from '@services/public-id.service';
import { OperationCity, OperationState, ServiceZone } from '@models/platform/geography.model';
import { DispatchHub, Market } from '@models/platform/network.model';
import { HookPartner, RunnerMarketAssignment, RunnerProfile } from '@models/platform/operations-accounts.model';
import { User } from '@models/users/user.model';
import { Category } from '@models/categories/category.model';
import { Product } from '@models/products/product.model';
import { CatalogMediaAsset, ProductSubmission, ProductVariant } from '@models/catalog/catalog.model';

dotenv.config({ quiet: true });

const submissionStatuses = [
  ProductSubmissionStatus.DRAFT,
  ProductSubmissionStatus.SUBMITTED,
  ProductSubmissionStatus.IN_REVIEW,
  ProductSubmissionStatus.CHANGES_REQUESTED,
  ProductSubmissionStatus.APPROVED,
  ProductSubmissionStatus.REJECTED,
];

async function upsertNetwork() {
  const state = await OperationState.findOne({ code: 'LA' });
  if (!state) throw new Error('Phase 3 fixtures require the migrated Lagos operation state');

  const city = await OperationCity.findOneAndUpdate(
    { stateId: state.id, code: 'LOS' },
    { $set: { name: 'Lagos', status: 'active' }, $setOnInsert: { publicId: await nextPublicId('city'), stateId: state.id, code: 'LOS' } },
    { upsert: true, returnDocument: 'after' },
  );
  const zone = await ServiceZone.findOneAndUpdate(
    { cityId: city.id, code: 'LOS-CEN' },
    { $set: { name: 'Lagos Central', stateId: state.id, status: 'active', deliveryEligible: true }, $setOnInsert: { publicId: await nextPublicId('zone'), cityId: city.id, code: 'LOS-CEN' } },
    { upsert: true, returnDocument: 'after' },
  );
  const hub = await DispatchHub.findOneAndUpdate(
    { stateId: state.id, name: 'Lagos Central Dispatch Hub' },
    {
      $set: { cityId: city.id, zoneIds: [zone.id], address: '12 Admiralty Way, Lekki Phase 1', status: 'active' },
      $setOnInsert: { publicId: await nextPublicId('hub'), marketIds: [], staffIds: [] },
    },
    { upsert: true, returnDocument: 'after' },
  );
  city.defaultHubId = hub.id;
  await city.save();

  const marketSeeds = [
    ['Balogun Market', 'balogun market', 'Balogun Market, Lagos Island'],
    ['Tejuosho Market', 'tejuosho market', 'Tejuosho Road, Yaba'],
    ['Mandilas Market', 'mandilas market', 'Broad Street, Lagos Island'],
  ] as const;
  const markets = [];
  for (const [name, normalizedName, address] of marketSeeds) {
    markets.push(await Market.findOneAndUpdate(
      { stateId: state.id, normalizedName },
      {
        $set: { name, cityId: city.id, zoneId: zone.id, hubId: hub.id, address, status: 'active' },
        $setOnInsert: { publicId: await nextPublicId('market'), normalizedName },
      },
      { upsert: true, returnDocument: 'after' },
    ));
  }
  hub.marketIds = markets.map((market) => market.id);
  await hub.save();
  return { state, city, zone, hub, markets };
}

async function seedPartner(
  state: { id: string },
  city: { id: string },
  zone: { id: string },
) {
  const email = 'partner.lagos@hook.africa';
  const publicId = (await User.findOne({ email }).lean())?.publicId || await nextPublicId('partner');
  const account = await User.findOneAndUpdate(
    { email },
    {
      $set: {
        firstName: 'Tola',
        lastName: 'Akinyemi',
        phone: '+2348010000401',
        password: await hashPassword(process.env.SEED_PARTNER_PASSWORD || '123456'),
        role: UserRole.VENDOR,
        accountType: AccountType.PARTNER,
        accountStatus: AccountStatus.ACTIVE,
        scopeType: ScopeType.SELF,
        isActive: true,
        isEmailVerified: true,
        isPhoneVerified: true,
      },
      $setOnInsert: { publicId },
    },
    { upsert: true, returnDocument: 'after' },
  );
  await HookPartner.findOneAndUpdate(
    { accountId: account.id },
    {
      $set: {
        name: 'Hook Partner Lekki',
        stateId: state.id,
        cityId: city.id,
        zoneId: zone.id,
        address: '12 Admiralty Way, Lekki Phase 1',
        coordinates: { lat: 6.4478, lng: 3.4723 },
        contact: { name: 'Tola Akinyemi', email, phone: '+2348010000401' },
        status: 'active',
      },
      $setOnInsert: { publicId },
    },
    { upsert: true, returnDocument: 'after' },
  );
  return account;
}

async function assignRunners(stateId: string, hubId: string, markets: Array<{ id: string }>) {
  const runners = await RunnerProfile.find({ status: 'active' }).sort({ createdAt: 1 });
  for (let index = 0; index < runners.length; index += 1) {
    const runner = runners[index];
    const market = markets[index % markets.length];
    runner.stateIds = [stateId];
    runner.hubIds = [hubId];
    runner.availability = 'available';
    await runner.save();
    await RunnerMarketAssignment.findOneAndUpdate(
      { runnerId: runner.id, marketId: market.id, status: 'active' },
      {
        $set: { stateId, preferredHubId: hubId, priority: index + 1, isPrimary: true },
        $setOnInsert: {
          publicId: `RMA-${new Date().getFullYear()}-${String(index + 1).padStart(6, '0')}`,
          activeFrom: new Date(),
          assignmentReason: 'Phase 3 catalog QA responsibility',
          createdBy: 'phase-03-seed',
          history: [{ action: 'assigned', actorId: 'phase-03-seed', at: new Date() }],
        },
      },
      { upsert: true, returnDocument: 'after' },
    );
  }
  return runners;
}

async function publishCatalog(stateId: string, markets: Array<{ id: string }>) {
  const products = await Product.find({ catalogMigrationVersion: 3 }).sort({ createdAt: 1 });
  for (let index = 0; index < products.length; index += 1) {
    const product = products[index];
    const published = index < 12;
    product.sourceStateId = stateId;
    product.marketId = markets[index % markets.length].id;
    product.availabilityStatus = published ? ProductAvailabilityStatus.AVAILABLE : ProductAvailabilityStatus.UNCONFIRMED;
    product.customerAvailabilityNote = published ? 'Available from a verified Hook Market.' : 'Awaiting Market availability confirmation.';
    product.commercialApproval = published
      ? { approved: true, approvedBy: 'phase-03-seed', approvedAt: new Date() }
      : { approved: false };
    product.status = published ? ProductStatus.PUBLISHED : ProductStatus.DRAFT;
    product.publishedAt = published ? new Date(Date.now() - index * 60_000) : undefined;
    product.publishedBy = published ? 'phase-03-seed' : undefined;
    product.lastMarketVerifiedAt = new Date();
    product.lastPriceVerifiedAt = new Date();
    product.lastAvailabilityConfirmedAt = published ? new Date() : undefined;
    await product.save();
  }
  return products;
}

async function seedSubmissions(
  stateId: string,
  markets: Array<{ id: string }>,
  runners: Array<{ id: string; publicId: string }>,
  products: Array<{ id: string; title: string; categoryId: string; costPrice: number; images: string[] }>,
) {
  const categories = await Category.find().lean({ virtuals: true });
  for (let index = 0; index < Math.min(6, products.length); index += 1) {
    const product = products[index];
    const runner = runners[index % runners.length];
    const market = markets[index % markets.length];
    const publicId = `SUB-QA-${String(index + 1).padStart(4, '0')}`;
    const submission = await ProductSubmission.findOneAndUpdate(
      { publicId },
      {
        $set: {
          runnerId: runner.id,
          marketId: market.id,
          sourceStateId: stateId,
          categorySuggestionId: categories.find((category) => category._id.toString() === product.categoryId)?._id.toString() || product.categoryId,
          basicTitle: product.title,
          notes: 'Seeded Runner capture for end-to-end Catalog Review QA.',
          basePriceMinor: Math.round(product.costPrice * 100),
          currency: 'NGN',
          variants: [{ size: '42', colour: '#000000', attributes: {}, active: true }],
          availabilityStatus: ProductAvailabilityStatus.AVAILABLE,
          availabilityNote: 'Runner confirmed stock during QA capture.',
          status: submissionStatuses[index],
          version: 1,
          submittedAt: index === 0 ? undefined : new Date(),
          reviewStartedAt: index >= 2 ? new Date() : undefined,
          reviewedAt: index >= 3 ? new Date() : undefined,
          reviewedBy: index >= 3 ? 'phase-03-seed-reviewer' : undefined,
          productId: index === 4 ? product.id : undefined,
          reviewNotes: index >= 3 ? [{ action: submissionStatuses[index] === ProductSubmissionStatus.CHANGES_REQUESTED ? 'changes_requested' : submissionStatuses[index] === ProductSubmissionStatus.APPROVED ? 'approved' : 'rejected', message: 'Seeded workflow decision for QA.', actorId: 'phase-03-seed-reviewer', createdAt: new Date() }] : [],
        },
        $setOnInsert: { publicId, mediaIds: [] },
      },
      { upsert: true, returnDocument: 'after' },
    );
    const imageUrl = product.images[0];
    if (imageUrl) {
      const digest = createHash('sha256').update(`${publicId}:${imageUrl}`).digest('hex').slice(0, 24);
      const media = await CatalogMediaAsset.findOneAndUpdate(
        { providerPublicId: `seed-submission/${digest}` },
        {
          $set: { ownerId: submission.id, order: 0 },
          $setOnInsert: {
            publicId: `MED-QA-${digest.toUpperCase()}`,
            provider: 'legacy_external',
            resourceType: 'image',
            deliveryType: 'external',
            secureUrl: imageUrl,
            format: 'jpg',
            width: 800,
            height: 800,
            bytes: 1,
            uploaderAccountId: runner.id,
            ownerType: 'submission',
            uploadIntentId: `seed-submission-${digest}`,
            status: 'ready',
            metadata: { seed: 'phase_03' },
          },
        },
        { upsert: true, returnDocument: 'after' },
      );
      submission.mediaIds = [media.publicId];
      await submission.save();
    }
  }
}

async function main() {
  await connectDatabase();
  const { state, city, zone, hub, markets } = await upsertNetwork();
  await seedPartner(state, city, zone);
  const runners = await assignRunners(state.id, hub.id, markets);
  if (!runners.length) throw new Error('Phase 3 fixtures require at least one migrated Runner profile');
  const products = await publishCatalog(state.id, markets);
  await seedSubmissions(state.id, markets, runners, products);
  console.log(`Phase 3 QA fixtures ready: ${markets.length} Markets, ${runners.length} Runner assignments, 1 Hook Partner, 6 submissions, 12 published products`);
  console.log(`Catalog variants available: ${await ProductVariant.countDocuments({ active: true })}`);
  await disconnectDatabase();
}

main().catch(async (error) => {
  console.error('Phase 3 QA fixture seed failed');
  console.error(error);
  await disconnectDatabase().catch(() => undefined);
  process.exit(1);
});
