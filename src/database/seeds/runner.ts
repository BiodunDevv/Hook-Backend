import dotenv from 'dotenv';
import mongoose from 'mongoose';
import {
  LogisticsStatus,
  NegotiationStatus,
  OrderStatus,
  PaymentStatus,
  ProductStatus,
  SettlementStatus,
  UserRole,
  VendorTier,
} from '@lib/constants';

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

const categories = [
  { name: 'Sneakers', slug: 'sneakers', description: 'Everyday, running, and fashion sneakers.', sortOrder: 1 },
  { name: 'Streetwear', slug: 'streetwear', description: 'Urban apparel and casual fashion.', sortOrder: 2 },
  { name: 'Accessories', slug: 'accessories', description: 'Bags, caps, socks, and finishing items.', sortOrder: 3 },
];

const vendors = [
  {
    ownerEmail: 'vendor.one@hook.africa',
    ownerFirstName: 'Ada',
    ownerLastName: 'Okafor',
    businessName: 'Lagos Sneaker Lab',
    businessEmail: 'sales@lagossneakerlab.africa',
    businessPhone: '+2348010000101',
    businessAddress: 'Admiralty Way, Lekki Phase 1, Lagos',
    tier: VendorTier.TIER_1,
    commissionPercentage: 12,
  },
  {
    ownerEmail: 'vendor.two@hook.africa',
    ownerFirstName: 'Tunde',
    ownerLastName: 'Balogun',
    businessName: 'Mainland Kicks Depot',
    businessEmail: 'ops@mainlandkicks.africa',
    businessPhone: '+2348010000102',
    businessAddress: 'Allen Avenue, Ikeja, Lagos',
    tier: VendorTier.TIER_2,
    commissionPercentage: 15,
  },
  {
    ownerEmail: 'vendor.three@hook.africa',
    ownerFirstName: 'Mariam',
    ownerLastName: 'Bello',
    businessName: 'Balogun Market Select',
    businessEmail: 'hello@balogunselect.africa',
    businessPhone: '+2348010000103',
    businessAddress: 'Balogun Market, Lagos Island',
    tier: VendorTier.TIER_3,
    commissionPercentage: 18,
  },
];

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

// Staff seed — admin and support accounts for RBAC testing
const staffAccounts = [
  {
    email: 'admin.one@hook.africa',
    firstName: 'Chidi',
    lastName: 'Okeke',
    role: UserRole.ADMIN,
    permissions: ALL_PERMISSIONS, // admin gets all by default
  },
  {
    email: 'admin.two@hook.africa',
    firstName: 'Fatima',
    lastName: 'Yusuf',
    role: UserRole.ADMIN,
    permissions: ALL_PERMISSIONS,
  },
  {
    email: 'support.one@hook.africa',
    firstName: 'Temi',
    lastName: 'Adeyemi',
    role: UserRole.SUPPORT,
    permissions: ['orders.view', 'orders.edit', 'customers.view', 'customers.edit', 'products.view'],
  },
  {
    email: 'support.two@hook.africa',
    firstName: 'Kola',
    lastName: 'Balogun',
    role: UserRole.SUPPORT,
    permissions: ['vendors.view', 'vendors.approve', 'products.view', 'products.review', 'reports.view'],
  },
  {
    email: 'support.three@hook.africa',
    firstName: 'Amaka',
    lastName: 'Eze',
    role: UserRole.SUPPORT,
    permissions: ['orders.view', 'drivers.view', 'financials.view', 'reports.view', 'ai_negotiation.view'],
  },
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

  await resetSeedData();

  const passwordHash = await hashPassword(password);

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
    const vendorPayload: any = {
      ownerId: owner.id,
      businessName: vendorSeed.businessName,
      businessEmail: vendorSeed.businessEmail,
      businessPhone: vendorSeed.businessPhone,
      businessAddress: vendorSeed.businessAddress,
      description: `${vendorSeed.businessName} is seeded for Hook admin QA, catalog testing, and onboarding flows.`,
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
  const savedProducts: any[] = [];
  for (let index = 0; index < products.length; index += 1) {
    const [title, costPrice, sellingPrice, minAcceptablePrice, quantity] = products[index];
    const slug = slugify(title);
    const vendor = savedVendors[index % savedVendors.length];
    const hookId = `HK-SNK-${String(index + 1).padStart(3, '0')}`;
    let product: any = await productRepo.findOne({ where: [{ slug }, { hookId }] as any });
    const productPayload: any = {
      title,
      slug,
      description: `${title} seeded with a real sneaker image for admin product, catalog, upload, and detail page testing.`,
      costPrice,
      sellingPrice,
      discountedPrice: Math.round(sellingPrice * 0.92),
      minAcceptablePrice,
      quantity,
      reservedQuantity: 0,
      colors: ['Black', 'White', 'Gold'],
      sizes: ['40', '41', '42', '43', '44'],
      images: [
        PRODUCT_IMAGES[index % PRODUCT_IMAGES.length],
        PRODUCT_IMAGES[(index + 1) % PRODUCT_IMAGES.length],
        PRODUCT_IMAGES[(index + 2) % PRODUCT_IMAGES.length],
      ],
      hookId,
      status: ProductStatus.APPROVED,
      vendorId: vendor.id,
      categoryId: sneakerCategory.id,
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

  const savedCustomers: any[] = [];
  for (const [customerEmail, customerFirstName, customerLastName, phone] of customers) {
    let customer: any = await userRepo.findOne({ where: { email: customerEmail } });
    const customerPayload = {
      email: customerEmail,
      phone,
      password: passwordHash,
      firstName: customerFirstName,
      lastName: customerLastName,
      role: UserRole.SHOPPER,
      isActive: true,
      isEmailVerified: true,
      isPhoneVerified: true,
      address: {
        street: '12 Admiralty Road',
        city: 'Lekki',
        state: 'Lagos',
        country: 'Nigeria',
      },
      preferences: {
        sizes: ['41', '42'],
        categories: ['Sneakers', 'Streetwear'],
      },
    };
    if (customer) Object.assign(customer, customerPayload);
    else customer = userRepo.create(customerPayload as any) as any;
    savedCustomers.push(await userRepo.save(customer as any));
  }
  console.log(`Customers ready: ${savedCustomers.length}`);

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
  let staffCreated = 0;
  for (const staffSeed of staffAccounts) {
    let staffUser: any = await userRepo.findOne({ where: { email: staffSeed.email } });
    const staffPayload: any = {
      email: staffSeed.email,
      password: passwordHash,
      firstName: staffSeed.firstName,
      lastName: staffSeed.lastName,
      role: staffSeed.role,
      permissions: staffSeed.permissions,
      isActive: true,
      isEmailVerified: true,
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

  const orderStatuses = [
    OrderStatus.PENDING,
    OrderStatus.CONFIRMED,
    OrderStatus.PROCESSING,
    OrderStatus.IN_TRANSIT,
    OrderStatus.DELIVERED,
    OrderStatus.DELIVERED,
  ];
  for (let index = 0; index < 6; index += 1) {
    const customer = savedCustomers[index % savedCustomers.length];
    const firstProduct = savedProducts[index % savedProducts.length];
    const secondProduct = savedProducts[(index + 3) % savedProducts.length];
    const orderCode = `HK-ORD-${String(index + 1).padStart(4, '0')}`;
    const lineItems = [
      { product: firstProduct, quantity: 1 + (index % 2) },
      { product: secondProduct, quantity: 1 },
    ];
    const subtotal = lineItems.reduce((sum, item) => sum + Number(item.product.sellingPrice) * item.quantity, 0);
    const deliveryFee = 2500 + index * 250;
    const discount = index % 2 === 0 ? 1500 : 0;
    const total = subtotal + deliveryFee - discount;
    const status = orderStatuses[index];
    const paymentStatus = index < 4 ? PaymentStatus.SUCCESSFUL : index === 4 ? PaymentStatus.PENDING : PaymentStatus.UNPAID;

    let order: any = await orderRepo.findOne({ where: { orderCode } });
    const orderPayload: any = {
      orderCode,
      userId: customer.id,
      subtotal,
      deliveryFee,
      discount,
      total,
      vendorCount: new Set(lineItems.map((item) => item.product.vendorId)).size,
      status,
      paymentStatus,
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

    await orderItemRepo.delete({ orderId: order.id } as any);
    for (const item of lineItems) {
      const itemTotal = Number(item.product.sellingPrice) * item.quantity;
      await orderItemRepo.save(orderItemRepo.create({
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
    }

    let payment: any = await paymentRepo.findOne({ where: { orderId: order.id } });
    const paymentPayload = {
      orderId: order.id,
      transactionRef: `HK-PAY-${String(index + 1).padStart(4, '0')}`,
      gatewayRef: `PSK-SEED-${String(index + 1).padStart(4, '0')}`,
      gateway: 'paystack',
      paymentMethod: index % 2 === 0 ? 'card' : 'bank_transfer',
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
      gatewayResponse: { seeded: true, authorizationUrl: 'https://checkout.paystack.com/seeded-hook-payment' },
    };
    if (payment) Object.assign(payment, paymentPayload);
    else payment = paymentRepo.create(paymentPayload as any);
    await paymentRepo.save(payment);

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
    for (const vendorId of Array.from(new Set(lineItems.map((item) => item.product.vendorId)))) {
      const vendorTotal = lineItems.filter((item) => item.product.vendorId === vendorId).reduce((sum, item) => sum + Number(item.product.sellingPrice) * item.quantity, 0);
      const commissionAmount = Math.round(vendorTotal * 0.15);
      await settlementRepo.save(settlementRepo.create({
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
    }
  }
  console.log('Orders, payments, logistics, and settlements ready: 6');

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
    const customer = savedCustomers[index % savedCustomers.length];
    const negotiationSeed = negotiationSeeds[index];
    const offeredPrice = Math.round(Number(product.sellingPrice) * negotiationSeed.offeredRatio);
    const counterPrice = Math.round(Number(product.sellingPrice) * negotiationSeed.counterRatio);
    const acceptedPrice = negotiationSeed.acceptedRatio
      ? Math.round(Number(product.sellingPrice) * negotiationSeed.acceptedRatio)
      : undefined;
    await negotiationRepo.save(negotiationRepo.create({
      userId: customer.id,
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
