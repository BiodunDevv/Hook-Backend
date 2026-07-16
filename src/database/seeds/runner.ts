import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { createHash } from 'crypto';
import {
  LogisticsStatus,
  EscrowEventType,
  NegotiationStatus,
  OrderStatus,
  OrderType,
  PaymentMode,
  PaymentStatus,
  ProductStatus,
  SettlementStatus,
  UserRole,
  VendorTier,
  VendorFulfilmentStatus,
} from '@lib/constants';
import { DEFAULT_OPERATIONAL_STATE_CODE, NIGERIAN_STATES } from '@lib/nigeria-states';

// All granular permissions — mirrors lib/permissions.ts on the frontend
const ALL_PERMISSIONS = [
  'orders.view', 'orders.edit', 'orders.create',
  'products.view', 'products.review', 'products.edit',
  'vendors.view', 'vendors.approve', 'vendors.edit',
  'customers.view', 'customers.edit',
  'drivers.view', 'drivers.edit',
  'field_agents.view',
  'booths.view', 'booths.edit',
  'financials.view',
  'financials.refund', 'financials.reconcile',
  'refunds.view', 'refunds.manage',
  'booths.inventory', 'booths.qr.rotate',
  'deletions.view', 'deletions.manage',
  'analytics.checkout',
  'reports.view',
  'ai_negotiation.view',
  'settings.view',
];

dotenv.config({ quiet: true });

const PRODUCT_IMAGES = [
  'https://images.unsplash.com/photo-1491553895911-0055eca6402d?w=800&auto=format&fit=crop&q=60&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxzZWFyY2h8MTF8fHNuZWFrZXJzfGVufDB8fDB8fHww',
  'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=800&auto=format&fit=crop&q=60',
  'https://images.unsplash.com/photo-1549298916-b41d501d3772?w=800&auto=format&fit=crop&q=60',
  'https://images.unsplash.com/photo-1608231387042-66d1773070a5?w=800&auto=format&fit=crop&q=60',
  'https://images.unsplash.com/photo-1525966222134-fcfa99b8ae77?w=800&auto=format&fit=crop&q=60',
  'https://images.unsplash.com/photo-1552346154-21d32810aba3?w=800&auto=format&fit=crop&q=60',
  'https://images.unsplash.com/photo-1506629905607-d405d7d3b0d2?w=800&auto=format&fit=crop&q=60',
  'https://images.unsplash.com/photo-1556906781-9a412961c28c?w=800&auto=format&fit=crop&q=60',
];

// Free Unsplash images used as the display icon for each category
const categories = [
  {
    name: 'Sneakers',
    slug: 'sneakers',
    description: 'Everyday, running, and fashion sneakers.',
    sortOrder: 1,
    iconUrl: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=400&auto=format&fit=crop&q=60',
  },
  {
    name: 'Streetwear',
    slug: 'streetwear',
    description: 'Urban apparel and casual fashion.',
    sortOrder: 2,
    iconUrl: 'https://images.unsplash.com/photo-1523398002811-999ca8dec234?w=400&auto=format&fit=crop&q=60',
  },
  {
    name: 'Accessories',
    slug: 'accessories',
    description: 'Bags, caps, socks, and finishing items.',
    sortOrder: 3,
    iconUrl: 'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=400&auto=format&fit=crop&q=60',
  },
  {
    name: 'Dresses',
    slug: 'dresses',
    description: 'Everyday, evening, and occasion dresses.',
    sortOrder: 4,
    iconUrl: 'https://images.unsplash.com/photo-1595777457583-95e059d581b8?w=400&auto=format&fit=crop&q=60',
  },
  {
    name: 'Bags',
    slug: 'bags',
    description: 'Handbags, totes, and everyday carry.',
    sortOrder: 5,
    iconUrl: 'https://images.unsplash.com/photo-1566150905458-1bf1fc113f0d?w=400&auto=format&fit=crop&q=60',
  },
];

const vendors = [
  {
    ownerEmail: 'vendor.one@hook.africa',
    ownerFirstName: 'Ada',
    ownerLastName: 'Okafor',
    businessName: 'Balogun Sneaker Market',
    businessEmail: 'sales@balogunsneakers.africa',
    businessPhone: '+2348010000101',
    businessAddress: 'Admiralty Way, Lekki Phase 1, Lagos',
    description: 'Sneakers, trainers, and street footwear',
    tier: VendorTier.TIER_1,
    commissionPercentage: 12,
    imageUrl: 'https://images.unsplash.com/photo-1555529771-835f59fc5efe?w=800&auto=format&fit=crop&q=80',
  },
  {
    ownerEmail: 'vendor.two@hook.africa',
    ownerFirstName: 'Tunde',
    ownerLastName: 'Balogun',
    businessName: 'Allen Avenue Fashion Hub',
    businessEmail: 'ops@allenavenuehub.africa',
    businessPhone: '+2348010000102',
    businessAddress: 'Allen Avenue, Ikeja, Lagos',
    description: 'Streetwear, jackets, and everyday fashion',
    tier: VendorTier.TIER_2,
    commissionPercentage: 15,
    imageUrl: 'https://images.unsplash.com/photo-1607083206968-13611e3d76db?w=800&auto=format&fit=crop&q=80',
  },
  {
    ownerEmail: 'vendor.three@hook.africa',
    ownerFirstName: 'Mariam',
    ownerLastName: 'Bello',
    businessName: 'Yaba Fabric & Textile Market',
    businessEmail: 'hello@yabatextiles.africa',
    businessPhone: '+2348010000103',
    businessAddress: 'Balogun Market, Lagos Island',
    description: 'Fabrics, bags, and accessories',
    tier: VendorTier.TIER_3,
    commissionPercentage: 18,
    imageUrl: 'https://images.unsplash.com/photo-1567401893414-76b7b1e5a7a5?w=800&auto=format&fit=crop&q=80',
  },
  {
    ownerEmail: 'vendor.four@hook.africa',
    ownerFirstName: 'Chinedu',
    ownerLastName: 'Eze',
    businessName: 'Computer Village Gadget Mart',
    businessEmail: 'sales@cvgadgetmart.africa',
    businessPhone: '+2348010000104',
    businessAddress: 'Otigba Street, Computer Village, Ikeja',
    description: 'Bags, cases, and everyday accessories',
    tier: VendorTier.TIER_2,
    commissionPercentage: 15,
    imageUrl: 'https://images.unsplash.com/photo-1441984904996-e0b6ba687e04?w=800&auto=format&fit=crop&q=80',
  },
  {
    ownerEmail: 'vendor.five@hook.africa',
    ownerFirstName: 'Blessing',
    ownerLastName: 'Adeyinka',
    businessName: 'Surulere Dress & Style House',
    businessEmail: 'hello@surulerestyle.africa',
    businessPhone: '+2348010000105',
    businessAddress: 'Adeniran Ogunsanya Street, Surulere, Lagos',
    description: 'Dresses, occasion wear, and tailoring',
    tier: VendorTier.TIER_3,
    commissionPercentage: 18,
    imageUrl: 'https://images.unsplash.com/photo-1560243563-062bfc001d68?w=800&auto=format&fit=crop&q=80',
  },
  {
    ownerEmail: 'vendor.six@hook.africa',
    ownerFirstName: 'Kunle',
    ownerLastName: 'Adebayo',
    businessName: 'Sango Ota Trade Fair',
    businessEmail: 'hello@sangotradefair.africa',
    businessPhone: '+2348010000106',
    businessAddress: 'Idiroko Road, Sango Ota, Ogun State',
    description: 'Wholesale fashion and footwear',
    tier: VendorTier.TIER_2,
    commissionPercentage: 15,
    imageUrl: 'https://images.unsplash.com/photo-1445205170230-053b83016050?w=800&auto=format&fit=crop&q=80',
    stateOverride: 'OG',
  },
  {
    ownerEmail: 'vendor.seven@hook.africa',
    ownerFirstName: 'Ibiere',
    ownerLastName: 'Wokoma',
    businessName: 'Port Harcourt Waterfront Market',
    businessEmail: 'hello@phwaterfront.africa',
    businessPhone: '+2348010000107',
    businessAddress: 'Aggrey Road, Port Harcourt, Rivers State',
    description: 'Sneakers, bags, and streetwear',
    tier: VendorTier.TIER_3,
    commissionPercentage: 18,
    imageUrl: 'https://images.unsplash.com/photo-1483985988355-763728e1935b?w=800&auto=format&fit=crop&q=80',
    stateOverride: 'RI',
  },
];

// [title, marketPrice, hookPlatformPrice, negotiationFloor, quantity]
const products = [
  ['Air Pulse Runner', 39000, 52000, 45000, 25],
  ['Court Flex Low', 42000, 58000, 50000, 18],
  ['Metro Knit Trainer', 35000, 47000, 41000, 9],
  ['Street Grid 90', 46000, 64000, 56000, 14],
  ['Cloudstep Daily', 28000, 39000, 34000, 30],
  ['Vanta High Top', 50000, 72000, 63000, 7],
  ['Orbit Foam Pro', 54000, 78000, 69000, 12],
  ['Classic Suede Court', 33000, 45500, 39000, 21],
  ['Rift Trail Sneaker', 48000, 68500, 59000, 5],
  ['Nova Street Runner', 57000, 82000, 72000, 16],
  ['Luxe Track Jacket', 26000, 42000, 35000, 20],
  ['Utility Crossbody Bag', 18000, 29500, 24000, 35],
  ['Everyday Ribbed Socks', 3500, 6500, 5000, 80],
  ['Oversized Street Tee', 9000, 16500, 13500, 45],
  ['Premium Snapback Cap', 7000, 12000, 9500, 32],
] as const;

const customers = [
  ['customer.one@hook.africa', 'Nora', 'Adebayo', '+2348020000101'],
  ['customer.two@hook.africa', 'Emeka', 'Nwosu', '+2348020000102'],
  ['customer.three@hook.africa', 'Zainab', 'Ibrahim', '+2348020000103'],
  ['customer.four@hook.africa', 'Femi', 'Lawal', '+2348020000104'],
] as const;

const drivers = [
  ['driver.one@hook.africa', 'Ife', 'Akin', '+2348030000101'],
  ['driver.two@hook.africa', 'Sola', 'Adeyemi', '+2348030000102'],
] as const;

// Staff seed — admin and support accounts for RBAC testing.
// categorySlugs are resolved to real category ids after categories are saved.
const staffAccounts = [
  {
    email: 'admin.one@hook.africa',
    firstName: 'Chidi',
    lastName: 'Okeke',
    phone: '+2348040000101',
    role: UserRole.ADMIN,
    permissions: ALL_PERMISSIONS, // admin gets all by default
    categorySlugs: ['sneakers'],
  },
  {
    email: 'admin.two@hook.africa',
    firstName: 'Fatima',
    lastName: 'Yusuf',
    phone: '+2348040000102',
    role: UserRole.ADMIN,
    permissions: ALL_PERMISSIONS,
    categorySlugs: ['streetwear', 'accessories'],
  },
  {
    email: 'support.one@hook.africa',
    firstName: 'Temi',
    lastName: 'Adeyemi',
    phone: '+2348040000103',
    role: UserRole.SUPPORT,
    permissions: ['orders.view', 'orders.edit', 'customers.view', 'customers.edit', 'products.view'],
    categorySlugs: ['sneakers'],
  },
  {
    email: 'support.two@hook.africa',
    firstName: 'Kola',
    lastName: 'Balogun',
    phone: '+2348040000104',
    role: UserRole.SUPPORT,
    permissions: ['vendors.view', 'vendors.approve', 'products.view', 'products.review', 'reports.view'],
    categorySlugs: ['streetwear'],
  },
  {
    email: 'support.three@hook.africa',
    firstName: 'Amaka',
    lastName: 'Eze',
    phone: '+2348040000105',
    role: UserRole.SUPPORT,
    permissions: ['orders.view', 'drivers.view', 'financials.view', 'reports.view', 'ai_negotiation.view'],
    categorySlugs: ['accessories'],
  },
] as const;

// Field agents — people assigned to individual markets who upload listings for QA
const fieldAgentAccounts = [
  {
    email: 'agent.one@hook.africa',
    firstName: 'Chika',
    lastName: 'Nwosu',
    phone: '+2348050000101',
    assignedMarket: 'Balogun Market',
    coverageArea: { lat: 6.4541, lng: 3.3894, radiusKm: 2 },
  },
  {
    email: 'agent.two@hook.africa',
    firstName: 'Ibrahim',
    lastName: 'Sani',
    phone: '+2348050000102',
    assignedMarket: 'Yaba (Tejuosho)',
    coverageArea: { lat: 6.5095, lng: 3.3711, radiusKm: 3 },
  },
  {
    email: 'agent.three@hook.africa',
    firstName: 'Grace',
    lastName: 'Okafor',
    phone: '+2348050000103',
    assignedMarket: 'Mandilas',
    coverageArea: { lat: 6.4507, lng: 3.3903, radiusKm: 1.5 },
  },
] as const;

// Physical booths — company-owned walk-in locations
const boothSeeds = [
  {
    name: 'Balogun Phygital Booth',
    description: 'Flagship walk-in booth inside Balogun Market with live catalog browsing.',
    boothType: 'phygital',
    location: { address: 'Balogun Market, Lagos Island', lat: 6.4541, lng: 3.3894 },
    operatingHours: { open: '08:00', close: '19:00', days: 'Mon-Sat' },
    previewImageUrl: 'https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=600&auto=format&fit=crop&q=60',
    isActive: true,
    agentEmail: 'agent.one@hook.africa',
  },
  {
    name: 'Yaba Micro Hub',
    description: 'Pickup and dispatch micro hub serving Tejuosho and Yaba axis.',
    boothType: 'micro_hub',
    location: { address: 'Tejuosho Ultra Modern Market, Yaba', lat: 6.5095, lng: 3.3711 },
    operatingHours: { open: '09:00', close: '18:00', days: 'Mon-Sat' },
    previewImageUrl: 'https://images.unsplash.com/photo-1472851294608-062f824d29cc?w=600&auto=format&fit=crop&q=60',
    isActive: true,
    agentEmail: 'agent.two@hook.africa',
  },
  {
    name: 'Ikeja City Mall Booth',
    description: 'Experience booth for product discovery and instant checkout.',
    boothType: 'phygital',
    location: { address: 'Ikeja City Mall, Alausa, Ikeja', lat: 6.6142, lng: 3.3579 },
    operatingHours: { open: '10:00', close: '21:00', days: 'Mon-Sun' },
    previewImageUrl: 'https://images.unsplash.com/photo-1555529669-e69e7aa0ba9a?w=600&auto=format&fit=crop&q=60',
    isActive: true,
    agentEmail: 'agent.three@hook.africa',
  },
  {
    name: 'Lekki Experience Booth',
    description: 'Coming online soon — hardware installation in progress.',
    boothType: 'micro_hub',
    location: { address: 'Admiralty Way, Lekki Phase 1', lat: 6.4478, lng: 3.4723 },
    operatingHours: { open: '09:00', close: '19:00', days: 'Mon-Sat' },
    previewImageUrl: 'https://images.unsplash.com/photo-1556740738-b6a63e27c4df?w=600&auto=format&fit=crop&q=60',
    isActive: false,
    agentEmail: null,
  },
] as const;

// Field uploads awaiting QA review — [title, marketPrice, hookPlatformPrice, negotiationFloor, qty, categorySlug, agentEmail]
const pendingUploads = [
  ["Nike Air Force 1 '07 - White", 18000, 22500, 20000, 12, 'sneakers', 'agent.one@hook.africa'],
  ['Vintage Denim Jacket - Oversized', 6000, 9000, 7500, 4, 'streetwear', 'agent.two@hook.africa'],
  ['Dior Replica Quilted Tote', 25000, 33000, 29000, 6, 'accessories', 'agent.three@hook.africa'],
  ['New Balance 530 - Grey Matter', 28000, 36500, 32000, 8, 'sneakers', 'agent.one@hook.africa'],
  ['Two-Piece Ankara Co-ord Set', 8500, 13000, 11000, 10, 'streetwear', 'agent.two@hook.africa'],
  ['Leather Crossbody Mini Bag', 9000, 14500, 12000, 15, 'accessories', 'agent.three@hook.africa'],
] as const;

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'item';
}

async function resetSeedData() {
  await mongoose.connection.dropDatabase();
  console.log('Database cleared for fresh seed');
}

async function seed() {
  const email = process.env.SEED_ADMIN_EMAIL || 'admin@gmail.com';
  const firstName = process.env.SEED_ADMIN_FIRST_NAME || 'Hook';
  const lastName = process.env.SEED_ADMIN_LAST_NAME || 'Admin';

  // All seeded accounts use the same password for easy local/QA testing
  const password = '123456';
  if (
    process.env.NODE_ENV === 'production' &&
    email === 'admin@gmail.com' &&
    password === '123456' &&
    process.env.ALLOW_WEAK_PRODUCTION_SEED !== 'true'
  ) {
    throw new Error('Refusing to seed default weak admin credentials in production. Set ALLOW_WEAK_PRODUCTION_SEED=true only for controlled QA.');
  }

  const [
    { hashPassword },
    { AppDataSource, initializeDatabase },
    { User },
    { Vendor },
    { Category },
    { Product },
    { Order },
    { OrderItem },
    { Payment },
    { Logistics },
    { Settlement },
    { Negotiation },
    { FieldAgent },
    { Booth },
    { OperationalState },
    { VendorFulfilment },
    { EscrowLedger },
    { BoothInventory },
    { BoothAttendantAssignment },
    { RefundRequest },
    { BoothAccessService },
    { AccountDeletionRequest },
    { CheckoutEvent },
  ] = await Promise.all([
    import('@lib/security'),
    import('@config/data-source'),
    import('@models/users/user.model'),
    import('@models/vendors/vendor.model'),
    import('@models/categories/category.model'),
    import('@models/products/product.model'),
    import('@models/orders/order.model'),
    import('@models/orders/order-item.model'),
    import('@models/payments/payment.model'),
    import('@models/logistics/logistics.model'),
    import('@models/settlements/settlement.model'),
    import('@models/negotiations/negotiation.model'),
    import('@models/field-agents/field-agent.model'),
    import('@models/booths/booth.model'),
    import('@models/operations/operational-state.model'),
    import('@models/orders/vendor-fulfilment.model'),
    import('@models/payments/escrow-ledger.model'),
    import('@models/booths/booth-inventory.model'),
    import('@models/booths/booth-attendant-assignment.model'),
    import('@models/orders/refund-request.model'),
    import('@services/booth-access.service'),
    import('@models/support/account-deletion-request.model'),
    import('@models/analytics/checkout-event.model'),
  ]);

  await initializeDatabase();
  const userRepo = AppDataSource.getRepository(User);
  const vendorRepo = AppDataSource.getRepository(Vendor);
  const categoryRepo = AppDataSource.getRepository(Category);
  const productRepo = AppDataSource.getRepository(Product);
  const orderRepo = AppDataSource.getRepository(Order);
  const orderItemRepo = AppDataSource.getRepository(OrderItem);
  const paymentRepo = AppDataSource.getRepository(Payment);
  const logisticsRepo = AppDataSource.getRepository(Logistics);
  const settlementRepo = AppDataSource.getRepository(Settlement);
  const negotiationRepo = AppDataSource.getRepository(Negotiation);
  const fieldAgentRepo = AppDataSource.getRepository(FieldAgent);
  const boothRepo = AppDataSource.getRepository(Booth);
  const operationalStateRepo = AppDataSource.getRepository(OperationalState);
  const fulfilmentRepo = AppDataSource.getRepository(VendorFulfilment);
  const ledgerRepo = AppDataSource.getRepository(EscrowLedger);
  const boothInventoryRepo = AppDataSource.getRepository(BoothInventory);
  const deletionRepo = AppDataSource.getRepository(AccountDeletionRequest);
  const checkoutEventRepo = AppDataSource.getRepository(CheckoutEvent);
  const boothAssignmentRepo = AppDataSource.getRepository(BoothAttendantAssignment);
  const refundRequestRepo = AppDataSource.getRepository(RefundRequest);
  const boothAccess = new BoothAccessService();

  await resetSeedData();

  const passwordHash = await hashPassword(password);
  const now = new Date();
  const defaultState = NIGERIAN_STATES.find((state) => state.code === DEFAULT_OPERATIONAL_STATE_CODE) || NIGERIAN_STATES[0];
  // Lagos plus a handful of major commercial hubs — enough for the mobile state
  // dropdown to demonstrate real multi-state filtering, not just Lagos-vs-empty.
  const enabledStateCodes = new Set([DEFAULT_OPERATIONAL_STATE_CODE, 'OG', 'OY', 'RI', 'FC']);

  for (const stateSeed of NIGERIAN_STATES) {
    const isEnabled = enabledStateCodes.has(stateSeed.code);
    await operationalStateRepo.save(operationalStateRepo.create({
      ...stateSeed,
      countryCode: 'NG',
      countryName: 'Nigeria',
      isEnabled,
      enabledAt: isEnabled ? now : undefined,
    } as any));
  }
  console.log(`Operating states ready: ${NIGERIAN_STATES.length} (${enabledStateCodes.size} enabled: ${Array.from(enabledStateCodes).join(', ')})`);

  const existingAdmin = await userRepo.findOne({ where: { email } });
  if (existingAdmin) {
    await userRepo.update(existingAdmin.id, {
      password: passwordHash,
      firstName,
      lastName,
      role: UserRole.SUPER_ADMIN,
      permissions: ALL_PERMISSIONS, // super_admin: all permissions always
      isActive: true,
      isEmailVerified: true,
    });
    console.log(`Seed super admin updated: ${email}`);
  } else {
    await userRepo.save(userRepo.create({
      email,
      password: passwordHash,
      firstName,
      lastName,
      role: UserRole.SUPER_ADMIN,
      permissions: ALL_PERMISSIONS,
      isActive: true,
      isEmailVerified: true,
    } as any));
    console.log(`Seed super admin created: ${email}`);
  }

  const savedCategories: any[] = [];
  for (const categorySeed of categories) {
    let category = await categoryRepo.findOne({ where: { slug: categorySeed.slug } });
    if (category) {
      Object.assign(category, categorySeed, { isActive: true });
    } else {
      category = categoryRepo.create({ ...categorySeed, isActive: true });
    }
    savedCategories.push(await categoryRepo.save(category));
  }
  console.log(`Categories ready: ${savedCategories.length}`);

  const savedVendors: any[] = [];
  for (const vendorSeed of vendors) {
    let owner = await userRepo.findOne({ where: { email: vendorSeed.ownerEmail } });
    if (owner) {
      Object.assign(owner, {
        firstName: vendorSeed.ownerFirstName,
        lastName: vendorSeed.ownerLastName,
        role: UserRole.VENDOR,
        isActive: true,
        isEmailVerified: true,
        password: passwordHash,
      });
    } else {
      owner = userRepo.create({
        email: vendorSeed.ownerEmail,
        password: passwordHash,
        firstName: vendorSeed.ownerFirstName,
        lastName: vendorSeed.ownerLastName,
        role: UserRole.VENDOR,
        isActive: true,
        isEmailVerified: true,
      });
    }
    owner = await userRepo.save(owner);
    if (!owner) throw new Error(`Unable to create vendor owner ${vendorSeed.ownerEmail}`);

    let vendor: any = await vendorRepo.findOne({ where: { ownerId: owner.id } });
    const vendorState = (vendorSeed as any).stateOverride
      ? NIGERIAN_STATES.find((state) => state.code === (vendorSeed as any).stateOverride) || defaultState
      : defaultState;
    const vendorPayload: any = {
      ownerId: owner.id,
      businessName: vendorSeed.businessName,
      businessEmail: vendorSeed.businessEmail,
      businessPhone: vendorSeed.businessPhone,
      businessAddress: vendorSeed.businessAddress,
      stateCode: vendorState.code,
      stateName: vendorState.name,
      description: vendorSeed.description,
      imageUrl: vendorSeed.imageUrl,
      tier: vendorSeed.tier,
      commissionPercentage: vendorSeed.commissionPercentage,
      isApproved: true,
      approvedAt: new Date(),
      isActive: true,
      bankDetails: {
        bankName: 'Test Bank',
        accountNumber: `01234567${savedVendors.length}`,
        accountName: vendorSeed.businessName,
        bankCode: '999',
      },
    };
    if (vendor) {
      Object.assign(vendor, vendorPayload);
    } else {
      vendor = vendorRepo.create(vendorPayload as any) as any;
    }
    savedVendors.push(await vendorRepo.save(vendor as any));
  }
  console.log(`Vendors ready: ${savedVendors.length}`);

  const sneakerCategory = savedCategories.find((category) => category.slug === 'sneakers') || savedCategories[0];
  const streetwearCategory = savedCategories.find((category) => category.slug === 'streetwear') || sneakerCategory;
  const accessoriesCategory = savedCategories.find((category) => category.slug === 'accessories') || sneakerCategory;
  // Indexes 0-9 are sneakers; 10+ are apparel/accessories items
  const productCategoryByIndex = (index: number) => {
    if (index === 10 || index === 13) return streetwearCategory; // jacket, tee
    if (index === 11 || index === 12 || index === 14) return accessoriesCategory; // bag, socks, cap
    return sneakerCategory;
  };
  const savedProducts: any[] = [];
  for (let index = 0; index < products.length; index += 1) {
    const [title, marketPrice, hookPlatformPrice, negotiationFloor, quantity] = products[index];
    const slug = slugify(title);
    const vendor = savedVendors[index % savedVendors.length];
    const hookId = `HK-SNK-${String(index + 1).padStart(3, '0')}`;
    let product: any = await productRepo.findOne({ where: [{ slug }, { hookId }] as any });
    const productPayload: any = {
      title,
      slug,
      description: `${title} seeded with a real sneaker image for admin product, catalog, upload, and detail page testing.`,
      costPrice: marketPrice,
      sellingPrice: hookPlatformPrice,
      discountedPrice: undefined,
      minAcceptablePrice: negotiationFloor,
      quantity,
      reservedQuantity: 0,
      colors: ['#000000', '#FFFFFF', '#FFD700'],
      sizes: ['40', '41', '42', '43', '44'],
      images: [
        PRODUCT_IMAGES[index % PRODUCT_IMAGES.length],
        PRODUCT_IMAGES[(index + 1) % PRODUCT_IMAGES.length],
        PRODUCT_IMAGES[(index + 2) % PRODUCT_IMAGES.length],
      ],
      hookId,
      status: ProductStatus.APPROVED,
      vendorId: vendor.id,
      categoryId: productCategoryByIndex(index).id,
      viewCount: 120 + index * 17,
      orderCount: 9 + index * 3,
      averageRating: Number((4.4 + (index % 5) * 0.1).toFixed(1)),
    };
    if (product) {
      Object.assign(product, productPayload);
    } else {
      product = productRepo.create(productPayload as any) as any;
    }
    savedProducts.push(await productRepo.save(product as any));
  }
  console.log(`Products ready: ${products.length}`);

  const seededCustomerProfiles = customers.map(([email, firstName, lastName, phone], index) => ({
    guestId: `seed-guest-${String(index + 1).padStart(3, '0')}`,
    email,
    firstName,
    lastName,
    name: `${firstName} ${lastName}`,
    phone,
  }));
  console.log(`Customer display profiles ready: ${seededCustomerProfiles.length} (no shopper users seeded)`);

  const savedDrivers: any[] = [];
  for (const [driverEmail, driverFirstName, driverLastName, phone] of drivers) {
    let driver: any = await userRepo.findOne({ where: { email: driverEmail } });
    const driverPayload = {
      email: driverEmail,
      phone,
      password: passwordHash,
      firstName: driverFirstName,
      lastName: driverLastName,
      role: UserRole.EV_DRIVER,
      operationalStateCode: defaultState.code,
      operationalStateName: defaultState.name,
      isActive: true,
      isEmailVerified: true,
      isPhoneVerified: true,
    };
    if (driver) Object.assign(driver, driverPayload);
    else driver = userRepo.create(driverPayload as any) as any;
    savedDrivers.push(await userRepo.save(driver as any));
  }
  console.log(`Drivers ready: ${savedDrivers.length}`);

  // ── Staff accounts (admin + support) ──────────────────────────────────────
  const categoryIdBySlug = new Map<string, string>(
    savedCategories.map((category: any) => [category.slug, category.id]),
  );
  let staffCreated = 0;
  for (const staffSeed of staffAccounts) {
    let staffUser: any = await userRepo.findOne({ where: { email: staffSeed.email } });
    const staffPayload: any = {
      email: staffSeed.email,
      phone: staffSeed.phone,
      password: passwordHash,
      firstName: staffSeed.firstName,
      lastName: staffSeed.lastName,
      role: staffSeed.role,
      permissions: staffSeed.permissions,
      assignedCategoryIds: staffSeed.categorySlugs
        .map((slug) => categoryIdBySlug.get(slug))
        .filter(Boolean),
      isActive: true,
      isEmailVerified: true,
      isPhoneVerified: true,
    };
    if (staffUser) {
      Object.assign(staffUser, staffPayload);
    } else {
      staffUser = userRepo.create(staffPayload);
    }
    await userRepo.save(staffUser);
    staffCreated += 1;
  }
  console.log(`Staff accounts ready: ${staffCreated} (${staffAccounts.filter((s) => s.role === UserRole.ADMIN).length} admin, ${staffAccounts.filter((s) => s.role === UserRole.SUPPORT).length} support)`);

  // ── Field agents (market-assigned uploaders) ──────────────────────────────
  const fieldAgentByEmail = new Map<string, any>();
  for (const agentSeed of fieldAgentAccounts) {
    let agentUser: any = await userRepo.findOne({ where: { email: agentSeed.email } });
    const agentUserPayload = {
      email: agentSeed.email,
      phone: agentSeed.phone,
      password: passwordHash,
      firstName: agentSeed.firstName,
      lastName: agentSeed.lastName,
      role: UserRole.FIELD_AGENT,
      isActive: true,
      isEmailVerified: true,
      isPhoneVerified: true,
    };
    if (agentUser) Object.assign(agentUser, agentUserPayload);
    else agentUser = userRepo.create(agentUserPayload as any) as any;
    agentUser = await userRepo.save(agentUser);

    let fieldAgent: any = await fieldAgentRepo.findOne({ where: { agentId: agentUser.id } });
    const fieldAgentPayload = {
      agentId: agentUser.id,
      assignedMarket: agentSeed.assignedMarket,
      stateCode: defaultState.code,
      stateName: defaultState.name,
      coverageArea: agentSeed.coverageArea,
      isActive: true,
    };
    if (fieldAgent) Object.assign(fieldAgent, fieldAgentPayload);
    else fieldAgent = fieldAgentRepo.create(fieldAgentPayload as any) as any;
    fieldAgent = await fieldAgentRepo.save(fieldAgent);
    fieldAgentByEmail.set(agentSeed.email, fieldAgent);
  }
  console.log(`Field agents ready: ${fieldAgentAccounts.length}`);

  // ── Physical booths (company-owned locations) ─────────────────────────────
  const savedBooths: any[] = [];
  for (const boothSeed of boothSeeds) {
    const attendant = boothSeed.agentEmail ? fieldAgentByEmail.get(boothSeed.agentEmail) : undefined;
    let booth: any = await boothRepo.findOne({ where: { name: boothSeed.name } });
    const boothPayload = {
      name: boothSeed.name,
      description: boothSeed.description,
      boothType: boothSeed.boothType,
      location: { ...boothSeed.location, stateCode: defaultState.code, stateName: defaultState.name },
      operatingHours: boothSeed.operatingHours,
      previewImageUrl: boothSeed.previewImageUrl,
      isActive: boothSeed.isActive,
      fieldAgentId: attendant?.id,
      attendantUserId: attendant?.agentId,
      featuredProductIds: [],
    };
    if (booth) Object.assign(booth, boothPayload);
    else booth = boothRepo.create(boothPayload as any) as any;
    booth = await boothRepo.save(booth);
    savedBooths.push(booth);
    if (attendant?.agentId) {
      const user = await userRepo.findOne({ where: { id: attendant.agentId } });
      if (user) await boothAssignmentRepo.save(boothAssignmentRepo.create({ boothId: booth.id, attendantUserId: user.id, attendantName: `${user.firstName} ${user.lastName}`, attendantEmail: user.email, attendantPhone: user.phone || '', assignedAt: now, assignedBy: 'seed-system' } as any));
    }
  }
  console.log(`Booths ready: ${boothSeeds.length}`);

  // ── Field uploads awaiting QA (pending_approval products) ─────────────────
  const categoryBySlug = new Map<string, any>(savedCategories.map((category: any) => [category.slug, category]));
  for (let index = 0; index < pendingUploads.length; index += 1) {
    const [title, marketPrice, hookPlatformPrice, negotiationFloor, quantity, categorySlug, agentEmail] = pendingUploads[index];
    const agent = fieldAgentByEmail.get(agentEmail);
    const category = categoryBySlug.get(categorySlug) || savedCategories[0];
    const vendor = savedVendors[index % savedVendors.length];
    const slug = slugify(title);
    const hookId = `HK-FLD-${String(index + 1).padStart(3, '0')}`;

    let product: any = await productRepo.findOne({ where: [{ slug }, { hookId }] as any });
    const productPayload: any = {
      title,
      slug,
      description: `${title} uploaded from ${agent?.assignedMarket || 'the field'} and awaiting QA review.`,
      costPrice: marketPrice,
      sellingPrice: hookPlatformPrice,
      discountedPrice: undefined,
      minAcceptablePrice: negotiationFloor,
      quantity,
      reservedQuantity: 0,
      colors: index % 2 === 0 ? ['#FFFFFF', '#000000'] : ['#6F8FAF'],
      sizes: categorySlug === 'sneakers' ? ['41', '42', '43', '44'] : ['M', 'L', 'XL'],
      images: [PRODUCT_IMAGES[(index + 3) % PRODUCT_IMAGES.length]],
      hookId,
      status: ProductStatus.PENDING_APPROVAL,
      source: 'field_agent',
      fieldAgentId: agent?.id,
      vendorId: vendor.id,
      categoryId: category.id,
      viewCount: 0,
      orderCount: 0,
      averageRating: 0,
    };
    if (product) Object.assign(product, productPayload);
    else product = productRepo.create(productPayload as any) as any;
    await productRepo.save(product);
  }
  console.log(`Pending field uploads ready: ${pendingUploads.length}`);

  const orderStatuses = [
    OrderStatus.PENDING,
    OrderStatus.CONFIRMED,
    OrderStatus.PROCESSING,
    OrderStatus.IN_TRANSIT,
    OrderStatus.DELIVERED,
    OrderStatus.DELIVERED,
  ];
  const seededOrders: any[] = [];
  const seededPayments: any[] = [];
  for (let index = 0; index < 6; index += 1) {
    const customer = seededCustomerProfiles[index % seededCustomerProfiles.length];
    const firstProduct = savedProducts[index % savedProducts.length];
    const secondProduct = savedProducts[(index + 3) % savedProducts.length];
    const orderCode = `HK-ORD-${String(index + 1).padStart(4, '0')}`;
    const lineItems = [
      { product: firstProduct, quantity: 1 + (index % 2) },
      { product: secondProduct, quantity: 1 },
    ];
    const subtotal = lineItems.reduce((sum, item) => sum + Number(item.product.sellingPrice) * item.quantity, 0);
    const deliveryFee = 3000;
    const discount = index % 2 === 0 ? 1500 : 0;
    const total = subtotal + deliveryFee - discount;
    const status = orderStatuses[index];
    const paymentStatus = index < 4 ? PaymentStatus.SUCCESSFUL : index === 4 ? PaymentStatus.PENDING : PaymentStatus.UNPAID;

    let order: any = await orderRepo.findOne({ where: { orderCode } });
    const orderPayload: any = {
      orderCode,
      userId: undefined,
      guestId: customer.guestId,
      guestEmail: customer.email,
      guestName: customer.name,
      subtotal,
      deliveryFee,
      deliverySubsidy: 1500,
      discount,
      total,
      vendorCount: new Set(lineItems.map((item) => item.product.vendorId)).size,
      status,
      paymentStatus,
      paymentMode: index % 3 === 2 ? PaymentMode.PAY_ON_DELIVERY : PaymentMode.PAY_NOW,
      orderType: index === 1 ? OrderType.GIFT : OrderType.STANDARD,
      giftRecipient: index === 1 ? { name: 'Ada Gift Recipient', email: 'ada.gift@example.com', phone: '+2348030000099', address: { street: '18 Admiralty Way', city: 'Lekki', state: 'Lagos', phone: '+2348030000099' }, message: 'A Hook gift, delivered with care.' } : undefined,
      boothId: savedBooths[index % savedBooths.length].id,
      boothSnapshot: { name: savedBooths[index % savedBooths.length].name, accessCodeMasked: `***${String(index + 1).padStart(3, '0')}`, source: index % 2 ? 'qr' : 'code' },
      partialFulfilment: index === 0,
      vendorConfirmationDeadline: new Date(Date.now() + 2 * 60 * 60 * 1000),
      deliveryAddress: {
        street: `${10 + index} Admiralty Way`,
        city: index % 2 === 0 ? 'Lekki' : 'Ikeja',
        state: 'Lagos',
        landmark: 'Hook QA delivery point',
        phone: customer.phone,
        coordinates: { lat: 6.45 + index / 100, lng: 3.39 + index / 100 },
      },
      deliveryNotes: 'Seeded order for admin QA and operational testing.',
      deliveredAt: status === OrderStatus.DELIVERED ? new Date() : undefined,
    };
    if (order) Object.assign(order, orderPayload);
    else order = orderRepo.create(orderPayload);
    order = await orderRepo.save(order);
    seededOrders.push(order);

    await orderItemRepo.delete({ orderId: order.id } as any);
    const savedLineItems: Array<{ id: string; vendorId: string; totalPrice: number }> = [];
    for (const item of lineItems) {
      const itemTotal = Number(item.product.sellingPrice) * item.quantity;
      const savedItem = await orderItemRepo.save(orderItemRepo.create({
        orderId: order.id,
        productId: item.product.id,
        productTitle: item.product.title,
        productImage: item.product.images?.[0],
        vendorId: item.product.vendorId,
        quantity: item.quantity,
        unitPrice: Number(item.product.sellingPrice),
        totalPrice: itemTotal,
        selectedVariants: { color: 'Black', size: '42' },
        commissionAmount: itemTotal * 0.15,
      } as any));
      savedLineItems.push({ id: savedItem.id, vendorId: item.product.vendorId, totalPrice: itemTotal });
    }

    let payment: any = await paymentRepo.findOne({ where: { orderId: order.id } });
    const paymentPayload = {
      orderId: order.id,
      transactionRef: `HK-PAY-${String(index + 1).padStart(4, '0')}`,
      gatewayRef: `OPAY-SEED-${String(index + 1).padStart(4, '0')}`,
      gateway: 'opay',
      resourceType: 'order',
      paymentMethod: orderPayload.paymentMode === PaymentMode.PAY_ON_DELIVERY ? 'pos' : index % 2 === 0 ? 'card' : 'bank_transfer',
      amount: total,
      gatewayFee: Math.round(total * 0.015),
      amountSettled: paymentStatus === PaymentStatus.SUCCESSFUL ? total - Math.round(total * 0.015) : 0,
      status: paymentStatus,
      paidAt: paymentStatus === PaymentStatus.SUCCESSFUL ? new Date() : undefined,
      splitData: {
        hookShare: Math.round(subtotal * 0.15),
        vendorShare: Math.round(subtotal * 0.85),
        deliveryFee,
        commission: Math.round(subtotal * 0.15),
      },
      gatewayResponse: { seeded: true, provider: 'opay', verified: paymentStatus === PaymentStatus.SUCCESSFUL },
    };
    if (payment) Object.assign(payment, paymentPayload);
    else payment = paymentRepo.create(paymentPayload as any);
    payment = await paymentRepo.save(payment);
    seededPayments.push(payment);

    let logistics: any = await logisticsRepo.findOne({ where: { orderId: order.id } });
    const driver = savedDrivers[index % savedDrivers.length];
    const createdAt = new Date(Date.now() - 1000 * 60 * 60 * (index + 8));
    const estimatedDeliveryAt = status === OrderStatus.DELIVERED
      ? new Date(createdAt.getTime() + 1000 * 60 * 60 * (index % 2 === 0 ? 6 : 8))
      : new Date(Date.now() + 1000 * 60 * (12 + index * 6));
    const deliveredAt = status === OrderStatus.DELIVERED
      ? new Date(createdAt.getTime() + 1000 * 60 * 60 * (index % 2 === 0 ? 4 : 7))
      : undefined;
    const logisticsPayload = {
      createdAt,
      orderId: order.id,
      driverId: driver.id,
      status: status === OrderStatus.DELIVERED ? LogisticsStatus.DELIVERED : status === OrderStatus.IN_TRANSIT ? LogisticsStatus.IN_TRANSIT : LogisticsStatus.ASSIGNED,
      pickupLocation: {
        name: savedVendors[index % savedVendors.length].businessName,
        address: savedVendors[index % savedVendors.length].businessAddress,
        coordinates: { lat: 6.45, lng: 3.39 },
        notes: 'Seeded pickup location',
      },
      deliveryLocation: {
        address: `${orderPayload.deliveryAddress.street}, ${orderPayload.deliveryAddress.city}`,
        coordinates: orderPayload.deliveryAddress.coordinates,
        instructions: 'Call customer on arrival.',
      },
      qrCodeRef: `HK-QR-${String(index + 1).padStart(5, '0')}`,
      vendorOtp: `${445500 + index}`,
      estimatedDeliveryAt,
      estimatedDistanceKm: 5 + index,
      deliveredAt,
      trackingPath: [
        { lat: 6.45, lng: 3.39, timestamp: createdAt.toISOString() },
        { lat: 6.46 + index / 100, lng: 3.4 + index / 100, timestamp: new Date().toISOString() },
      ],
    };
    if (logistics) Object.assign(logistics, logisticsPayload);
    else logistics = logisticsRepo.create(logisticsPayload as any);
    await logisticsRepo.save(logistics);

    await settlementRepo.delete({ orderId: order.id } as any);
    await fulfilmentRepo.delete({ orderId: order.id } as any);
    for (const vendorId of Array.from(new Set(lineItems.map((item) => item.product.vendorId)))) {
      const vendorTotal = lineItems.filter((item) => item.product.vendorId === vendorId).reduce((sum, item) => sum + Number(item.product.sellingPrice) * item.quantity, 0);
      const commissionAmount = Math.round(vendorTotal * 0.15);
      const fulfilmentStatus = index === 0 && vendorId === lineItems[1].product.vendorId
        ? VendorFulfilmentStatus.REJECTED
        : status === OrderStatus.PENDING ? VendorFulfilmentStatus.AWAITING_CONFIRMATION : VendorFulfilmentStatus.CONFIRMED;
      const fulfilment = await fulfilmentRepo.save(fulfilmentRepo.create({
        orderId: order.id, vendorId, status: fulfilmentStatus,
        orderItemIds: savedLineItems.filter((item) => item.vendorId === vendorId).map((item) => item.id),
        itemTotal: vendorTotal,
        commissionAmount,
        refundAmount: fulfilmentStatus === VendorFulfilmentStatus.REJECTED ? vendorTotal : 0,
        confirmationDeadline: new Date(Date.now() + (status === OrderStatus.PENDING ? 60 : -60) * 60 * 1000),
        confirmedAt: fulfilmentStatus === VendorFulfilmentStatus.CONFIRMED ? new Date() : undefined,
        rejectedAt: fulfilmentStatus === VendorFulfilmentStatus.REJECTED ? new Date() : undefined,
        decidedBy: fulfilmentStatus === VendorFulfilmentStatus.AWAITING_CONFIRMATION ? undefined : 'seed-system',
        rejectionReason: fulfilmentStatus === VendorFulfilmentStatus.REJECTED ? 'Seeded out-of-stock scenario' : undefined,
        idempotencyKeys: [`seed:${order.id}:${vendorId}`],
      } as any));
      if (fulfilmentStatus === VendorFulfilmentStatus.CONFIRMED && paymentStatus === PaymentStatus.SUCCESSFUL) await settlementRepo.save(settlementRepo.create({
        vendorId,
        orderId: order.id,
        settlementRef: `HK-SET-${orderCode}-${String(vendorId).slice(0, 4)}`,
        itemTotal: vendorTotal,
        commissionAmount,
        netAmount: vendorTotal - commissionAmount,
        deliveryFeePortion: Math.round(deliveryFee / orderPayload.vendorCount),
        status: status === OrderStatus.DELIVERED ? SettlementStatus.CLEARED : SettlementStatus.PENDING_ESCROW,
        escrowReleaseAt: new Date(Date.now() + 1000 * 60 * 60 * 24),
        notes: 'Seeded settlement for finance testing.',
      } as any));

      if (paymentStatus === PaymentStatus.SUCCESSFUL) {
        await ledgerRepo.save(ledgerRepo.create({ orderId: order.id, paymentId: payment.id, vendorId, fulfilmentId: fulfilment.id, type: fulfilmentStatus === VendorFulfilmentStatus.REJECTED ? EscrowEventType.PARTIALLY_REFUNDED : EscrowEventType.HELD, amount: fulfilmentStatus === VendorFulfilmentStatus.REJECTED ? -vendorTotal : vendorTotal, currency: 'NGN', idempotencyKey: `seed:${order.id}:${vendorId}:${fulfilmentStatus}` } as any));
      }
    }
  }
  console.log('Orders, payments, logistics, and settlements ready: 6');

  for (let boothIndex = 0; boothIndex < savedBooths.length; boothIndex += 1) {
    const booth = savedBooths[boothIndex];
    const code = String(410001 + boothIndex);
    booth.accessCodeDigest = boothAccess.digestCode(code);
    booth.accessCodeVersion = 1;
    booth.accessCodeRotatedAt = now;
    booth.qrPublicId = `hook-booth-${boothIndex + 1}`;
    booth.qrTokenHash = boothAccess.digestQrToken(`seed-booth-token-${boothIndex + 1}`);
    booth.qrVersion = 1;
    booth.qrRotatedAt = now;
    await boothRepo.save(booth);
    for (const product of savedProducts.slice(boothIndex * 3, boothIndex * 3 + 5)) {
      await boothInventoryRepo.save(boothInventoryRepo.create({ boothId: booth.id, productId: product.id, vendorId: product.vendorId, isActive: booth.isActive }));
    }
  }
  console.log(`Booth credentials and inventory ready (test codes ${savedBooths.map((_, index) => 410001 + index).join(', ')})`);

  await refundRequestRepo.save(refundRequestRepo.create({ orderId: seededOrders[3].id, paymentId: seededPayments[3].id, requestedBy: seededCustomerProfiles[3 % seededCustomerProfiles.length].guestId, reasonType: 'not_delivered', reason: 'The seeded order did not arrive within its delivery window.', amount: seededOrders[3].total, evidenceUrls: [], status: 'under_review', assignedSupportUserId: (await userRepo.findOne({ where: { role: UserRole.SUPPORT } }))?.id, idempotencyKey: 'seed-refund-request-0001', auditHistory: [{ action: 'requested', actorId: seededCustomerProfiles[3 % seededCustomerProfiles.length].guestId, at: now }] } as any));

  const supportUser = await userRepo.findOne({ where: { role: UserRole.SUPPORT } });
  const provisional = await userRepo.save(userRepo.create({ email: 'guest.pending@hook.africa', firstName: 'Guest', lastName: 'Shopper', role: UserRole.SHOPPER, accountStatus: 'pending_password', originatingGuestId: 'seed-provisional-001', isActive: true, isEmailVerified: false } as any));
  await deletionRepo.save(deletionRepo.create({ userId: provisional.id, reason: 'Seeded support workflow', status: 'requested', assignedTo: supportUser?.id, coolingOffUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) }));

  const checkoutEvents = ['payment_options_shown', 'payment_method_selected', 'payment_initiated', 'payment_completed', 'delivered', 'checkout_abandoned'];
  for (let index = 0; index < 18; index += 1) await checkoutEventRepo.save(checkoutEventRepo.create({ sessionId: `seed-checkout-${Math.floor(index / 6) + 1}`, guestId: seededCustomerProfiles[index % seededCustomerProfiles.length].guestId, event: checkoutEvents[index % checkoutEvents.length], paymentMode: index % 3 === 0 ? PaymentMode.PAY_ON_DELIVERY : PaymentMode.PAY_NOW, metadata: { seeded: true }, occurredAt: new Date(Date.now() - index * 60 * 60 * 1000) } as any));
  console.log('Gift order, refund request, provisional guest, deletion request, and checkout analytics ready');

  await negotiationRepo.delete({ productId: { $in: savedProducts.map((product) => product.id) } } as any);
  const negotiationSeeds = [
    { status: NegotiationStatus.ACCEPTED, offeredRatio: 0.78, counterRatio: 0.9, acceptedRatio: 0.88, round: 3 },
    { status: NegotiationStatus.ACCEPTED, offeredRatio: 0.8, counterRatio: 0.91, acceptedRatio: 0.89, round: 2 },
    { status: NegotiationStatus.ACCEPTED, offeredRatio: 0.76, counterRatio: 0.88, acceptedRatio: 0.86, round: 4 },
    { status: NegotiationStatus.ACTIVE, offeredRatio: 0.74, counterRatio: 0.87, acceptedRatio: undefined, round: 2 },
    { status: NegotiationStatus.ACTIVE, offeredRatio: 0.79, counterRatio: 0.9, acceptedRatio: undefined, round: 1 },
    { status: NegotiationStatus.DECLINED, offeredRatio: 0.68, counterRatio: 0.85, acceptedRatio: undefined, round: 3 },
    { status: NegotiationStatus.ACCEPTED, offeredRatio: 0.81, counterRatio: 0.92, acceptedRatio: 0.9, round: 2 },
    { status: NegotiationStatus.EXPIRED, offeredRatio: 0.7, counterRatio: 0.86, acceptedRatio: undefined, round: 1 },
  ];
  for (let index = 0; index < negotiationSeeds.length; index += 1) {
    const product = savedProducts[index % savedProducts.length];
    const customer = seededCustomerProfiles[index % seededCustomerProfiles.length];
    const negotiationSeed = negotiationSeeds[index];
    const offeredPrice = Math.round(Number(product.sellingPrice) * negotiationSeed.offeredRatio);
    const counterPrice = Math.round(Number(product.sellingPrice) * negotiationSeed.counterRatio);
    const acceptedPrice = negotiationSeed.acceptedRatio
      ? Math.round(Number(product.sellingPrice) * negotiationSeed.acceptedRatio)
      : undefined;
    await negotiationRepo.save(negotiationRepo.create({
      userId: undefined,
      guestId: customer.guestId,
      guestEmail: customer.email,
      guestName: customer.name,
      productId: product.id,
      round: negotiationSeed.round,
      offeredPrice,
      counterPrice,
      acceptedPrice,
      status: negotiationSeed.status,
      costPrice: Number(product.costPrice),
      sellingPrice: Number(product.sellingPrice),
      minAcceptablePrice: Number(product.minAcceptablePrice),
      messageHistory: [
        {
          role: 'user',
          message: `Can Hook do ₦${offeredPrice.toLocaleString('en-NG')} for this item?`,
          price: offeredPrice,
          timestamp: new Date(Date.now() - 1000 * 60 * (index + 10)).toISOString(),
        },
        {
          role: 'bot',
          message: `Best smart counter is ₦${counterPrice.toLocaleString('en-NG')}.`,
          price: counterPrice,
          timestamp: new Date(Date.now() - 1000 * 60 * (index + 8)).toISOString(),
        },
      ],
      acceptedAt: negotiationSeed.status === NegotiationStatus.ACCEPTED ? new Date() : undefined,
      expiredAt: negotiationSeed.status === NegotiationStatus.EXPIRED ? new Date() : undefined,
      declineReason: negotiationSeed.status === NegotiationStatus.DECLINED ? 'Customer declined seeded counter offer.' : undefined,
    } as any));
  }
  console.log(`AI negotiations ready: ${negotiationSeeds.length}`);

  await mongoose.disconnect();
  console.log('Seed completed successfully');
}

seed().catch((error) => {
  console.error('Seed failed');
  console.error(error);
  process.exit(1);
});
