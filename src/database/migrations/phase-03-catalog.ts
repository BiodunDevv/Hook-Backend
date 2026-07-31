import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { createHash } from 'crypto';
import { connectDatabase, disconnectDatabase } from '@config/data-source';
import {
  CatalogMediaAsset,
  NegotiatedQuote,
  ProductSubmission,
  ProductVariant,
} from '@models/catalog/catalog.model';
import { Negotiation } from '@models/negotiations/negotiation.model';
import { Product } from '@models/products/product.model';
import { Category } from '@models/categories/category.model';
import { ProductStatus } from '@lib/constants';
import { nextPublicId } from '@services/public-id.service';

dotenv.config({ quiet: true });

type Mode = 'analyze' | 'dry-run' | 'execute' | 'verify' | 'rollback';
const CATALOG_MIGRATION_VERSION = 3;

function modeFromArgs(): Mode {
  const value = process.argv.find((arg) => arg.startsWith('--mode='))?.split('=')[1] || 'dry-run';
  if (!['analyze', 'dry-run', 'execute', 'verify', 'rollback'].includes(value)) {
    throw new Error(`Unsupported migration mode: ${value}`);
  }
  return value as Mode;
}

function minorUnits(value?: number) {
  if (value === undefined || value === null || !Number.isFinite(value)) return undefined;
  return Math.round(value * 100);
}

async function summary(mode: Mode) {
  const [
    totalProducts,
    migratedProducts,
    missingProductIds,
    legacyNegotiations,
    migratedNegotiations,
    submissions,
    variants,
    media,
    quotes,
    categoriesMissingPublicId,
  ] = await Promise.all([
    Product.countDocuments({ deletedAt: { $exists: false } }),
    Product.countDocuments({ catalogMigrationVersion: CATALOG_MIGRATION_VERSION }),
    Product.countDocuments({ publicId: { $exists: false }, deletedAt: { $exists: false } }),
    Negotiation.countDocuments({ publicId: { $exists: false } }),
    Negotiation.countDocuments({ publicId: { $exists: true } }),
    ProductSubmission.countDocuments(),
    ProductVariant.countDocuments(),
    CatalogMediaAsset.countDocuments(),
    NegotiatedQuote.countDocuments(),
    Category.countDocuments({ publicId: { $exists: false }, deletedAt: { $exists: false } }),
  ]);
  return {
    mode,
    database: mongoose.connection.db?.databaseName || 'unknown',
    catalogMigrationVersion: CATALOG_MIGRATION_VERSION,
    products: {
      total: totalProducts,
      migrated: migratedProducts,
      pending: totalProducts - migratedProducts,
      missingPublicId: missingProductIds,
    },
    negotiations: { legacy: legacyNegotiations, migrated: migratedNegotiations },
    phase3Collections: { submissions, variants, media, quotes },
    categoriesMissingPublicId,
    warnings: [
      'Legacy Vendor references remain historical compatibility fields.',
      'Legacy products become Commercial drafts and are never auto-published.',
      'Legacy public image URLs remain compatibility media until signed replacement media is reviewed.',
      'Rollback removes only Phase 3-derived fields and records; it does not delete legacy source data.',
    ],
  };
}

async function ensureIndexes() {
  for (const model of [ProductSubmission, ProductVariant, CatalogMediaAsset, NegotiatedQuote]) {
    await model.createCollection();
    await model.createIndexes();
  }
  await Promise.all([Product.createIndexes(), Negotiation.createIndexes()]);
}

async function migrateProducts() {
  const products = await Product.find({
    $or: [
      { catalogMigrationVersion: { $exists: false } },
      { catalogMigrationVersion: { $lt: CATALOG_MIGRATION_VERSION } },
    ],
    deletedAt: { $exists: false },
  });
  for (const product of products) {
    if (!product.publicId) product.publicId = await nextPublicId('product');
    product.basePriceMinor = product.basePriceMinor ?? minorUnits(product.costPrice);
    product.sellingPriceMinor = product.sellingPriceMinor ?? minorUnits(product.sellingPrice);
    product.discountMinor = product.discountMinor ?? Math.max(
      0,
      (product.sellingPriceMinor || 0) - (minorUnits(product.discountedPrice) || product.sellingPriceMinor || 0),
    );
    product.markupMinor = Math.max(0, (product.sellingPriceMinor || 0) - (product.basePriceMinor || 0));
    product.currency = product.currency || 'NGN';
    product.negotiationRules = product.negotiationRules || {
      enabled: Boolean(product.minAcceptablePrice),
      minimumNegotiablePriceMinor: minorUnits(product.minAcceptablePrice),
      maximumDiscountMinor: Math.max(
        0,
        (product.sellingPriceMinor || 0) - (minorUnits(product.minAcceptablePrice) || product.sellingPriceMinor || 0),
      ),
      maximumCustomerOffers: 3,
      acceptedQuoteExpiryMinutes: 30,
    };
    if (![ProductStatus.DRAFT, ProductStatus.PUBLISHED, ProductStatus.PAUSED].includes(product.status)) {
      product.status = ProductStatus.DRAFT;
    }
    product.commercialApproval = product.commercialApproval || { approved: false };
    product.catalogMigrationVersion = CATALOG_MIGRATION_VERSION;
    product.catalogVersion = Math.max(1, product.catalogVersion || 1);
    await product.save();

    const legacyMediaIds: string[] = [];
    for (const imageUrl of product.images || []) {
      if (!/^https?:\/\//i.test(imageUrl)) continue;
      const digest = createHash('sha256').update(imageUrl).digest('hex').slice(0, 24);
      const providerPublicId = `legacy-external/${digest}`;
      const asset = await CatalogMediaAsset.findOneAndUpdate(
        { providerPublicId },
        {
          $setOnInsert: {
            publicId: `MED-LEGACY-${digest.toUpperCase()}`,
            provider: 'legacy_external',
            providerPublicId,
            resourceType: 'image',
            deliveryType: 'external',
            secureUrl: imageUrl,
            format: imageUrl.split('?')[0].split('.').pop()?.toLowerCase() || 'jpg',
            width: 1,
            height: 1,
            bytes: 1,
            uploaderAccountId: 'phase-03-migration',
            ownerType: 'product',
            ownerId: product.id,
            uploadIntentId: `legacy-${digest}`,
            status: 'ready',
            order: legacyMediaIds.length,
            metadata: { migrationSource: 'phase_03_legacy_product' },
          },
        },
        { upsert: true, returnDocument: 'after' },
      ).lean({ virtuals: true });
      if (asset) legacyMediaIds.push(asset.publicId);
    }
    if (legacyMediaIds.length && !product.mediaAssetIds?.length) {
      product.mediaAssetIds = legacyMediaIds;
      await product.save();
    }

    if (!await ProductVariant.exists({ productId: product.id })) {
      const combinations = product.sizes?.length || product.colors?.length
        ? (product.sizes?.length ? product.sizes : [undefined]).flatMap((size) =>
            (product.colors?.length ? product.colors : [undefined]).map((colour) => ({ size, colour })))
        : [{ size: undefined, colour: undefined }];
      for (let index = 0; index < combinations.length; index += 1) {
        const combination = combinations[index];
        await ProductVariant.create({
          publicId: await nextPublicId('variant'),
          productId: product.id,
          sku: `${product.publicId}-${String(index + 1).padStart(2, '0')}`,
          size: combination.size,
          colour: combination.colour,
          attributes: {},
          active: true,
          mediaAssetIds: [],
          migrationSource: 'phase_03_legacy_product',
        });
      }
    }
  }
}

async function migrateNegotiations() {
  const sessions = await Negotiation.find({ publicId: { $exists: false } });
  for (const session of sessions) {
    session.publicId = await nextPublicId('negotiation');
    session.customerId = session.customerId || session.userId;
    session.guestSessionId = session.guestSessionId || session.guestId;
    session.channel = session.channel || 'shopper';
    session.quantity = session.quantity || 1;
    session.currency = session.currency || 'NGN';
    session.offerCount = session.offerCount || session.round || 0;
    session.maximumOffers = 3;
    session.version = Math.max(1, session.version || 1);
    session.transcript = session.transcript?.length
      ? session.transcript
      : (session.messageHistory || []).map((entry) => ({
          role: entry.role === 'user' ? 'customer' : 'hook',
          message: entry.message,
          offeredPriceMinor: entry.price ? minorUnits(entry.price) : undefined,
          createdAt: new Date(entry.timestamp),
        }));
    await session.save();
  }
}

async function migrateCategories() {
  const categories = await Category.find({ publicId: { $exists: false }, deletedAt: { $exists: false } });
  for (const category of categories) {
    category.publicId = await nextPublicId('category');
    await category.save();
  }
}

export async function seedPhase3CatalogFoundation() {
  await ensureIndexes();
  await migrateCategories();
  await migrateProducts();
  await migrateNegotiations();
}

async function verify() {
  const invalidProducts = await Product.countDocuments({
    catalogMigrationVersion: CATALOG_MIGRATION_VERSION,
    $or: [
      { publicId: { $exists: false } },
      { basePriceMinor: { $not: { $type: 'number' } } },
      { sellingPriceMinor: { $not: { $type: 'number' } } },
    ],
  } as any);
  const productsWithoutVariants = await Product.aggregate([
    { $match: { catalogMigrationVersion: CATALOG_MIGRATION_VERSION, deletedAt: { $exists: false } } },
    { $addFields: { productStringId: { $toString: '$_id' } } },
    { $lookup: { from: ProductVariant.collection.name, localField: 'productStringId', foreignField: 'productId', as: 'variants' } },
    { $match: { variants: { $size: 0 } } },
    { $count: 'count' },
  ]);
  return {
    invalidProducts,
    productsWithoutVariants: productsWithoutVariants[0]?.count || 0,
    duplicateProductPublicIds: await Product.aggregate([
      { $match: { publicId: { $exists: true } } },
      { $group: { _id: '$publicId', count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
      { $count: 'count' },
    ]).then((rows) => rows[0]?.count || 0),
  };
}

async function rollback() {
  if (process.env.PHASE_03_ROLLBACK_CONFIRMED !== 'true') {
    throw new Error('Set PHASE_03_ROLLBACK_CONFIRMED=true after reviewing the migration runbook');
  }
  await Product.updateMany(
    { catalogMigrationVersion: CATALOG_MIGRATION_VERSION },
    {
      $unset: {
        basePriceMinor: 1,
        sellingPriceMinor: 1,
        markupMinor: 1,
        discountMinor: 1,
        currency: 1,
        negotiationRules: 1,
        catalogMigrationVersion: 1,
        catalogVersion: 1,
      },
    },
  );
  await ProductVariant.deleteMany({ migrationSource: 'phase_03_legacy_product' });
  await CatalogMediaAsset.deleteMany({ 'metadata.migrationSource': 'phase_03_legacy_product' });
}

async function main() {
  const mode = modeFromArgs();
  await connectDatabase();
  console.log(JSON.stringify({ stage: 'analysis', ...(await summary(mode)) }, null, 2));
  if (mode === 'execute') {
    if (process.env.PHASE_03_MIGRATION_CONFIRMED !== 'true') {
      throw new Error('Set PHASE_03_MIGRATION_CONFIRMED=true only after a verified mongodump backup');
    }
    await seedPhase3CatalogFoundation();
  }
  if (mode === 'rollback') await rollback();
  if (['execute', 'verify', 'rollback'].includes(mode)) {
    console.log(JSON.stringify({ stage: 'verification', ...(await verify()), ...(await summary(mode)) }, null, 2));
  }
  await disconnectDatabase();
}

if (require.main === module) {
  main().catch(async (error) => {
    console.error('Phase 3 catalog migration failed');
    console.error(error);
    await disconnectDatabase().catch(() => undefined);
    process.exit(1);
  });
}
