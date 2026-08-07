import dotenv from 'dotenv';
import mongoose from 'mongoose';

import { connectDatabase, disconnectDatabase } from '@config/data-source';
import {
  AccountStatus,
  AccountType,
  ProductAvailabilityStatus,
  ProductStatus,
  ScopeType,
  UserRole,
} from '@lib/constants';
import { NIGERIAN_STATES } from '@lib/nigeria-states';
import { hashPassword } from '@lib/security';
import { Category } from '@models/categories/category.model';
import { CommercePolicyVersion, CommerceSettings } from '@models/commerce/commerce.model';
import { ProductVariant } from '@models/catalog/catalog.model';
import { OperationCity, OperationState, ServiceZone } from '@models/platform/geography.model';
import { DeliveryPricingRule } from '@models/platform/delivery-pricing.model';
import { DispatchHub, Market } from '@models/platform/network.model';
import { Role } from '@models/platform/access.model';
import { StaffProfile } from '@models/platform/operations-accounts.model';
import { OperationalState } from '@models/operations/operational-state.model';
import { Product } from '@models/products/product.model';
import { User } from '@models/users/user.model';
import { ensurePlatformAccessCatalog } from '@services/platform-bootstrap.service';
import { nextPublicIds, nextPublicId } from '@services/public-id.service';
import { refreshNigerianLocationCatalog } from '@services/location-catalog.service';

dotenv.config({ quiet: true });

const PRODUCT_IMAGES = [
  'https://images.unsplash.com/photo-1491553895911-0055eca6402d?w=900&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=900&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1549298916-b41d501d3772?w=900&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1608231387042-66d1773070a5?w=900&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1525966222134-fcfa99b8ae77?w=900&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1552346154-21d32810aba3?w=900&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1506629905607-d405d7d3b0d2?w=900&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1556906781-9a412961c28c?w=900&auto=format&fit=crop&q=80',
];

const CATEGORY_SEEDS = [
  ['Sneakers', 'sneakers', 'Everyday, running, and fashion sneakers.', 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=500&auto=format&fit=crop&q=80'],
  ['Streetwear', 'streetwear', 'Urban apparel and casual fashion.', 'https://images.unsplash.com/photo-1523398002811-999ca8dec234?w=500&auto=format&fit=crop&q=80'],
  ['Accessories', 'accessories', 'Bags, caps, socks, and finishing items.', 'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=500&auto=format&fit=crop&q=80'],
  ['Dresses', 'dresses', 'Everyday, evening, and occasion dresses.', 'https://images.unsplash.com/photo-1595777457583-95e059d581b8?w=500&auto=format&fit=crop&q=80'],
  ['Bags', 'bags', 'Handbags, totes, and everyday carry.', 'https://images.unsplash.com/photo-1566150905458-1bf1fc113f0d?w=500&auto=format&fit=crop&q=80'],
] as const;

const MARKET_SEEDS = [
  { stateCode: 'LA', city: 'Lagos', cityCode: 'LOS', market: 'Balogun Market', address: 'Balogun Market, Lagos Island', color: '#FF5A19', priority: 1, image: 'https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=1200&auto=format&fit=crop&q=80' },
  { stateCode: 'LA', city: 'Lagos', cityCode: 'LOS', market: 'Tejuosho Market', address: 'Tejuosho Road, Yaba', color: '#48C7E8', priority: 2, image: 'https://images.unsplash.com/photo-1472851294608-062f824d29cc?w=1200&auto=format&fit=crop&q=80' },
  { stateCode: 'LA', city: 'Lagos', cityCode: 'LOS', market: 'Mile 12 Market', address: 'Ikorodu Road, Ketu', color: '#F15AC8', priority: 3, image: 'https://images.unsplash.com/photo-1534452203293-494d7ddbf7e0?w=1200&auto=format&fit=crop&q=80' },
  { stateCode: 'OG', city: 'Abeokuta', cityCode: 'ABK', market: 'Kuto Market', address: 'Kuto Road, Abeokuta', color: '#F3A7D9', priority: 10, image: 'https://images.unsplash.com/photo-1483985988355-763728e1935b?w=1200&auto=format&fit=crop&q=80' },
  { stateCode: 'OY', city: 'Ibadan', cityCode: 'IBD', market: 'Bodija Market', address: 'Bodija, Ibadan', color: '#269AF2', priority: 20, image: 'https://images.unsplash.com/photo-1445205170230-053b83016050?w=1200&auto=format&fit=crop&q=80' },
  { stateCode: 'RI', city: 'Port Harcourt', cityCode: 'PHC', market: 'Mile One Market', address: 'Ikwerre Road, Port Harcourt', color: '#FF8A62', priority: 30, image: 'https://images.unsplash.com/photo-1555529669-e69e7aa0ba9a?w=1200&auto=format&fit=crop&q=80' },
  { stateCode: 'FC', city: 'Abuja', cityCode: 'ABV', market: 'Wuse Market', address: 'Wuse Zone 5, Abuja', color: '#FFC809', priority: 40, image: 'https://images.unsplash.com/photo-1528698827591-e19ccd7bc23d?w=1200&auto=format&fit=crop&q=80' },
] as const;

const PRODUCT_SEEDS = [
  ['Air Pulse Runner', 39000, 52000, 45000, 25, 'sneakers'],
  ['Court Flex Low', 42000, 58000, 50000, 18, 'sneakers'],
  ['Metro Knit Trainer', 35000, 47000, 41000, 9, 'sneakers'],
  ['Street Grid 90', 46000, 64000, 56000, 14, 'sneakers'],
  ['Cloudstep Daily', 28000, 39000, 34000, 30, 'sneakers'],
  ['Vanta High Top', 50000, 72000, 63000, 7, 'sneakers'],
  ['Luxe Track Jacket', 26000, 42000, 35000, 20, 'streetwear'],
  ['Utility Crossbody Bag', 18000, 29500, 24000, 35, 'bags'],
  ['Everyday Ribbed Socks', 3500, 6500, 5000, 80, 'accessories'],
  ['Oversized Street Tee', 9000, 16500, 13500, 45, 'streetwear'],
  ['Premium Snapback Cap', 7000, 12000, 9500, 32, 'accessories'],
  ['Lagos Day Dress', 24000, 38000, 32000, 16, 'dresses'],
  ['Classic Suede Court', 33000, 45500, 39000, 21, 'sneakers'],
  ['Nova Street Runner', 57000, 82000, 72000, 16, 'sneakers'],
  ['Canvas Carryall', 22000, 35000, 29000, 24, 'bags'],
] as const;

function assertSeedResetAllowed() {
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DESTRUCTIVE_SEED !== 'true') {
    throw new Error('Refusing to reset a production database. Set ALLOW_DESTRUCTIVE_SEED=true only after verifying the target database.');
  }
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function idOf(record: { _id?: unknown; id?: string }) {
  return String(record.id || record._id || '');
}

async function seedStates() {
  const publicIds = await nextPublicIds('state', NIGERIAN_STATES.length);
  const stateRows = NIGERIAN_STATES.map((state, index) => ({
    publicId: publicIds[index],
    ...state,
    countryCode: 'NG',
    status: 'active' as const,
    deliveryEnabled: true,
    timezone: 'Africa/Lagos',
    currency: 'NGN',
    deliveryPromiseHours: 48,
    payAtHubEnabled: false,
    payAtHubLimitMinor: 10_000_000,
    podEnabled: false,
    podLimitMinor: 10_000_000,
  }));
  const states = await OperationState.insertMany(stateRows);
  await OperationalState.insertMany(NIGERIAN_STATES.map((state) => ({
    ...state,
    countryCode: 'NG',
    countryName: 'Nigeria',
    isEnabled: true,
    enabledAt: new Date(),
  })));
  return states;
}

async function seedAdmin() {
  await ensurePlatformAccessCatalog();
  const role = await Role.findOne({ key: 'SUPER_ADMIN', isActive: true }).lean();
  if (!role) throw new Error('SUPER_ADMIN role was not created');
  const password = await hashPassword(process.env.SEED_ADMIN_PASSWORD || '123456');
  const user = await User.create({
    publicId: await nextPublicId('staff'),
    email: process.env.SEED_ADMIN_EMAIL || 'admin@gmail.com',
    phone: process.env.SEED_ADMIN_PHONE || '+2348000000000',
    password,
    firstName: process.env.SEED_ADMIN_FIRST_NAME || 'Hook',
    lastName: process.env.SEED_ADMIN_LAST_NAME || 'Admin',
    role: UserRole.SUPER_ADMIN,
    accountType: AccountType.STAFF,
    accountStatus: AccountStatus.ACTIVE,
    roleIds: [String(role._id)],
    scopeType: ScopeType.GLOBAL,
    assignedStateIds: [],
    assignedHubIds: [],
    permissions: role.permissionKeys,
    isActive: true,
    isEmailVerified: true,
    isPhoneVerified: true,
  });
  await StaffProfile.create({
    publicId: user.publicId,
    accountId: idOf(user),
    roleIds: [String(role._id)],
    scopeType: ScopeType.GLOBAL,
    stateIds: [],
    hubIds: [],
    status: 'active',
  });
  return user;
}

async function seedCategories() {
  const publicIds = await nextPublicIds('category', CATEGORY_SEEDS.length);
  return Category.insertMany(CATEGORY_SEEDS.map(([name, slug, description, iconUrl], index) => ({
    publicId: publicIds[index], name, slug, description, iconUrl, sortOrder: index + 1, isActive: true,
  })));
}

async function seedNetwork(states: any[]) {
  const stateByCode = new Map(states.map((state) => [state.code, state]));
  const markets: any[] = [];
  const networkByCity = new Map<string, { city: any; zone: any; hub: any }>();
  for (const entry of MARKET_SEEDS) {
    const state = stateByCode.get(entry.stateCode);
    if (!state) continue;
    const networkKey = `${entry.stateCode}:${entry.cityCode}`;
    let network = networkByCity.get(networkKey);
    if (!network) {
      const city = await OperationCity.create({
        publicId: await nextPublicId('city'), stateId: idOf(state), name: entry.city, code: entry.cityCode, status: 'active',
      });
      const zone = await ServiceZone.create({
        publicId: await nextPublicId('zone'), stateId: idOf(state), cityId: idOf(city), name: `${entry.city} Central`, code: `${entry.cityCode}-CENTRAL`, status: 'active', deliveryEligible: true,
      });
      const hub = await DispatchHub.create({
        publicId: await nextPublicId('hub'), stateId: idOf(state), cityId: idOf(city), zoneIds: [idOf(zone)], name: `${entry.city} Dispatch Hub`, address: entry.address, coordinates: entry.stateCode === 'LA' ? { lat: 6.45, lng: 3.39 } : undefined, marketIds: [], staffIds: [], status: 'active',
      });
      city.defaultHubId = idOf(hub);
      await city.save();
      network = { city, zone, hub };
      networkByCity.set(networkKey, network);
    }
    const { city, zone, hub } = network;
    const market = await Market.create({
      publicId: await nextPublicId('market'), name: entry.market, normalizedName: entry.market.toLowerCase(), stateId: idOf(state), cityId: idOf(city), zoneId: idOf(zone), hubId: idOf(hub), address: entry.address, imageUrl: entry.image, shortDisplayName: entry.market.replace(' Market', '\nMarket'), discoveryColor: entry.color, isFeatured: entry.priority < 10, displayPriority: entry.priority, status: 'active',
    });
    hub.marketIds = [...new Set([...(hub.marketIds || []), idOf(market)])];
    await hub.save();
    markets.push(market);
  }
  return markets;
}

async function seedProducts(categories: any[], markets: any[], states: any[], adminId: string) {
  const categoryBySlug = new Map(categories.map((category) => [category.slug, category]));
  const stateById = new Map(states.map((state) => [idOf(state), state]));
  const productIds = await nextPublicIds('product', PRODUCT_SEEDS.length);
  const products: any[] = [];
  for (let index = 0; index < PRODUCT_SEEDS.length; index += 1) {
    const [title, basePrice, sellingPrice, floorPrice, quantity, categorySlug] = PRODUCT_SEEDS[index];
    const market = markets[index % markets.length];
    const state = stateById.get(String(market.stateId));
    const basePriceMinor = basePrice * 100;
    const sellingPriceMinor = sellingPrice * 100;
    const discountMinor = index % 4 === 0 ? Math.round(sellingPriceMinor * 0.08) : 0;
    const product = await Product.create({
      publicId: productIds[index],
      hookId: `HK-${String(index + 1).padStart(4, '0')}`,
      title,
      slug: slugify(title),
      description: `${title} is part of the Hook marketplace collection, curated for everyday style and reliable delivery.`,
      costPrice: basePrice,
      sellingPrice,
      discountedPrice: discountMinor ? sellingPrice - discountMinor / 100 : undefined,
      minAcceptablePrice: floorPrice,
      basePriceMinor,
      sellingPriceMinor,
      markupMinor: sellingPriceMinor - basePriceMinor,
      discountMinor,
      currency: 'NGN',
      sourceStateId: idOf(state),
      marketId: idOf(market),
      categoryId: idOf(categoryBySlug.get(categorySlug)),
      quantity,
      reservedQuantity: 0,
      colors: ['#111111', '#FFFFFF', '#FFC809'],
      sizes: ['40', '41', '42', '43', '44'],
      images: [PRODUCT_IMAGES[index % PRODUCT_IMAGES.length], PRODUCT_IMAGES[(index + 1) % PRODUCT_IMAGES.length]],
      mediaAssetIds: [],
      negotiationRules: { enabled: true, minimumNegotiablePriceMinor: floorPrice * 100, maximumDiscountMinor: sellingPriceMinor - floorPrice * 100, maximumCustomerOffers: 3, acceptedQuoteExpiryMinutes: 30 },
      availabilityStatus: ProductAvailabilityStatus.AVAILABLE,
      customerAvailabilityNote: 'Available from a verified Hook Market.',
      lastMarketVerifiedAt: new Date(),
      lastPriceVerifiedAt: new Date(),
      lastAvailabilityConfirmedAt: new Date(),
      publishedAt: new Date(Date.now() - index * 60_000),
      publishedBy: adminId,
      commercialApproval: { approved: true, approvedBy: adminId, approvedAt: new Date() },
      catalogMigrationVersion: 3,
      catalogVersion: 1,
      status: ProductStatus.PUBLISHED,
      viewCount: 0,
      orderCount: 0,
      averageRating: 4.6,
      source: 'admin',
    });
    await ProductVariant.create({
      publicId: await nextPublicId('variant'), productId: idOf(product), sku: `${product.hookId}-42-BLK`, size: '42', colour: '#111111', attributes: {}, active: true, mediaAssetIds: [],
    });
    products.push(product);
  }
  return products;
}

async function seedCommerceDefaults(adminId: string) {
  const policyVersions = Object.fromEntries(await Promise.all((['TERMS', 'PRIVACY', 'RETURNS'] as const).map(async (type) => {
    const version = '2026.08';
    await CommercePolicyVersion.create({ publicId: `POL-${type}-${version.replace('.', '-')}`, type, version, status: 'active', effectiveAt: new Date() });
    return [type, version];
  })));
  await CommerceSettings.create({ key: 'commerce', currency: 'NGN', defaultDeliveryFeeMinor: 300_000, podEnabled: false, defaultPodLimitMinor: 10_000_000, previewTtlMinutes: 10, activePolicyVersions: policyVersions, updatedBy: adminId });
  await DeliveryPricingRule.create({
    publicId: await nextPublicId('deliveryRule'), name: 'Nigeria default delivery', scope: 'global', mode: 'per_km', baseFeeMinor: 150_000, feePerKmMinor: 15_000, fallbackFeeMinor: 300_000, status: 'active', version: 1, createdBy: adminId,
  });
}

export async function runSimpleSeed() {
  assertSeedResetAllowed();
  await connectDatabase();
  const databaseName = mongoose.connection.db?.databaseName || 'unknown';
  console.warn(`Hook seed: resetting development database "${databaseName}"`);
  await mongoose.connection.dropDatabase();

  const admin = await seedAdmin();
  const states = await seedStates();
  const locationResult = await refreshNigerianLocationCatalog();
  const categories = await seedCategories();
  const markets = await seedNetwork(states);
  const products = await seedProducts(categories, markets, states, idOf(admin));
  await seedCommerceDefaults(idOf(admin));

  console.log('Hook seed completed');
  console.log(`  Admin: ${admin.email}`);
  console.log(`  States: ${states.length} enabled for delivery`);
  console.log(`  LGAs: ${locationResult.total} active`);
  console.log(`  Markets: ${markets.length}`);
  console.log(`  Categories: ${categories.length}`);
  console.log(`  Published products: ${products.length}`);
}

if (require.main === module) {
  runSimpleSeed()
    .catch((error) => {
      console.error('Hook seed failed');
      console.error(error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await disconnectDatabase().catch(() => undefined);
    });
}
