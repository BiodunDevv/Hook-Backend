const { writeFileSync } = require('fs');
const { join } = require('path');

const apiPrefix = '/api/v1';

const tags = [
  ['System', 'Health checks and API metadata.'],
  ['Authentication', 'Customer/mobile authentication and profile endpoints.'],
  ['Public Marketplace', 'Public product, category, vendor, booth, feed, and search endpoints.'],
  ['Customer Cart', 'Authenticated shopper cart management.'],
  ['Customer Orders', 'Authenticated checkout and order management.'],
  ['Negotiations', 'Customer AI negotiation sessions.'],
  ['Payments', 'Customer payment initialization, verification, and status checks.'],
  ['Notifications', 'Authenticated customer notifications.'],
  ['Devices', 'Customer and guest device token registration for push notifications.'],
  ['Vendor Portal', 'Vendor profile, catalog, order, settlement, and bank detail endpoints.'],
  ['Logistics', 'Driver, field-agent, and admin assignment workflows.'],
  ['Uploads', 'Authenticated image uploads.'],
  ['Webhooks', 'Provider webhook receivers.'],
  ['Admin Auth', 'Admin-only authentication.'],
  ['Admin Dashboard', 'Admin dashboard, analytics, and health.'],
  ['Admin Users', 'Admin user and customer management.'],
  ['Admin Vendors', 'Admin vendor approval and configuration.'],
  ['Admin Products', 'Admin product catalog and review queue.'],
  ['Admin Orders', 'Admin order visibility and status overrides.'],
  ['Admin Dispatch', 'Admin delivery and driver operations.'],
  ['Admin Field Agents', 'Admin field-agent directory and toggles.'],
  ['Admin Booths', 'Admin physical booth provisioning and analytics.'],
  ['Admin Financials', 'Super-admin financial controls, settlements, and audit logs.'],
  ['Admin Negotiations', 'Admin AI negotiation monitoring.'],
  ['Admin Reports', 'Admin report listing and generation.'],
  ['Admin Settings', 'Admin platform settings.'],
].map(([name, description]) => ({ name, description }));

const schemas = {
  ApiSuccess: {
    type: 'object',
    properties: {
      success: { type: 'boolean', example: true },
      message: { type: 'string', example: 'Success' },
      data: { nullable: true },
      timestamp: { type: 'string', format: 'date-time' },
    },
  },
  ApiError: {
    type: 'object',
    properties: {
      success: { type: 'boolean', example: false },
      message: { type: 'string', example: 'Invalid request body' },
      errors: { nullable: true },
      timestamp: { type: 'string', format: 'date-time' },
    },
  },
  LoginRequest: {
    type: 'object',
    required: ['email', 'password'],
    properties: {
      email: { type: 'string', format: 'email', example: 'admin@gmail.com' },
      password: { type: 'string', example: '123456' },
      guestId: { type: 'string', description: 'Optional guest id to merge guest cart/orders after login.' },
    },
  },
  AuthLookupRequest: {
    type: 'object',
    required: ['email'],
    properties: { email: { type: 'string', format: 'email', example: 'shopper@example.com' } },
  },
  SignupStartRequest: {
    type: 'object',
    required: ['email', 'password'],
    properties: {
      email: { type: 'string', format: 'email', example: 'shopper@example.com' },
      password: { type: 'string', minLength: 6, example: '123456789' },
      guestId: { type: 'string' },
    },
  },
  SignupVerifyRequest: {
    type: 'object',
    required: ['signupSessionToken', 'code'],
    properties: {
      signupSessionToken: { type: 'string' },
      code: { type: 'string', example: '1234' },
    },
  },
  SignupCompleteRequest: {
    type: 'object',
    required: ['signupSessionToken', 'firstName', 'lastName'],
    properties: {
      signupSessionToken: { type: 'string' },
      firstName: { type: 'string', example: 'Hook' },
      lastName: { type: 'string', example: 'Shopper' },
      phone: { type: 'string', example: '+2348012345678' },
      guestId: { type: 'string' },
    },
  },
  RegisterRequest: {
    type: 'object',
    required: ['email', 'password'],
    properties: {
      email: { type: 'string', format: 'email', example: 'shopper@example.com' },
      password: { type: 'string', minLength: 6, example: '123456' },
    },
  },
  OtpRequest: {
    type: 'object',
    required: ['email', 'code'],
    properties: {
      email: { type: 'string', format: 'email', example: 'shopper@example.com' },
      code: { type: 'string', example: '1234' },
    },
  },
  RefreshRequest: {
    type: 'object',
    required: ['refreshToken'],
    properties: { refreshToken: { type: 'string' } },
  },
  ProfileRequest: {
    type: 'object',
    properties: {
      firstName: { type: 'string', example: 'Hook' },
      lastName: { type: 'string', example: 'Shopper' },
      phone: { type: 'string', example: '+2348012345678' },
      avatarUrl: { type: 'string', format: 'uri' },
      address: { type: 'object', additionalProperties: true },
      preferences: { type: 'object', additionalProperties: true },
    },
  },
  PasswordForgotRequest: {
    type: 'object',
    required: ['email'],
    properties: { email: { type: 'string', format: 'email' } },
  },
  PasswordResetRequest: {
    type: 'object',
    required: ['email', 'code', 'password'],
    properties: {
      email: { type: 'string', format: 'email' },
      code: { type: 'string', example: '1234' },
      password: { type: 'string', minLength: 6 },
    },
  },
  PasswordVerifyRequest: {
    type: 'object',
    required: ['email', 'code'],
    properties: {
      email: { type: 'string', format: 'email' },
      code: { type: 'string', example: '1234' },
    },
  },
  ChangePasswordRequest: {
    type: 'object',
    required: ['currentPassword', 'newPassword'],
    properties: {
      currentPassword: { type: 'string' },
      newPassword: { type: 'string', minLength: 6 },
    },
  },
  CartItemRequest: {
    type: 'object',
    required: ['productId', 'quantity'],
    properties: {
      productId: { type: 'string', format: 'uuid' },
      quantity: { type: 'integer', minimum: 1, example: 2 },
      selectedVariants: {
        type: 'object',
        properties: {
          color: { type: 'string', example: 'Black' },
          size: { type: 'string', example: '42' },
        },
      },
    },
  },
  QuantityRequest: {
    type: 'object',
    required: ['quantity'],
    properties: { quantity: { type: 'integer', minimum: 1, example: 1 } },
  },
  CheckoutRequest: {
    type: 'object',
    required: ['deliveryAddress'],
    properties: {
      guestEmail: { type: 'string', format: 'email', description: 'Required for guest checkout.' },
      guestName: { type: 'string', description: 'Required for guest checkout.' },
      deliveryAddress: {
        type: 'object',
        required: ['street', 'city', 'state', 'phone'],
        properties: {
          street: { type: 'string', example: '12 Admiralty Way' },
          city: { type: 'string', example: 'Lekki' },
          state: { type: 'string', example: 'Lagos' },
          landmark: { type: 'string', example: 'Near the roundabout' },
          phone: { type: 'string', example: '+2348012345678' },
          coordinates: {
            type: 'object',
            properties: {
              lat: { type: 'number', example: 6.4474 },
              lng: { type: 'number', example: 3.4542 },
            },
          },
        },
      },
      deliveryNotes: { type: 'string' },
      scheduledDeliveryAt: { type: 'string', format: 'date-time' },
    },
  },
  DeviceRegisterRequest: {
    type: 'object',
    required: ['expoPushToken'],
    properties: {
      expoPushToken: { type: 'string', example: 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]' },
      platform: { type: 'string', enum: ['ios', 'android', 'web', 'unknown'], example: 'ios' },
      deviceName: { type: 'string', example: 'iPhone 17' },
    },
  },
  DeviceUnregisterRequest: {
    type: 'object',
    properties: {
      expoPushToken: { type: 'string' },
    },
  },
  NegotiationRequest: {
    type: 'object',
    required: ['productId', 'offeredPrice'],
    properties: {
      productId: { type: 'string', format: 'uuid' },
      offeredPrice: { type: 'number', example: 45000 },
      message: { type: 'string', example: 'Can you do this price?' },
    },
  },
  NegotiationCounterRequest: {
    type: 'object',
    required: ['offeredPrice'],
    properties: {
      offeredPrice: { type: 'number', example: 47000 },
      message: { type: 'string' },
    },
  },
  PaymentInitializeRequest: {
    type: 'object',
    required: ['orderId'],
    properties: {
      orderId: { type: 'string', format: 'uuid' },
      gateway: { type: 'string', enum: ['paystack', 'nomba'], example: 'paystack' },
      paymentMethod: { type: 'string', enum: ['card', 'bank_transfer', 'ussd'], example: 'card' },
    },
  },
  VendorRegistrationRequest: {
    type: 'object',
    required: ['businessName'],
    properties: {
      businessName: { type: 'string', example: 'Balogun Store Alpha' },
      businessEmail: { type: 'string', format: 'email' },
      businessPhone: { type: 'string' },
      businessAddress: { type: 'string' },
      description: { type: 'string' },
    },
  },
  ProductRequest: {
    type: 'object',
    required: ['title', 'costPrice', 'sellingPrice', 'minAcceptablePrice', 'categoryId'],
    properties: {
      title: { type: 'string', example: 'Nike Air Force 1' },
      description: { type: 'string' },
      costPrice: { type: 'number', example: 30000 },
      sellingPrice: { type: 'number', example: 45000 },
      discountedPrice: { type: 'number', example: 42000 },
      minAcceptablePrice: { type: 'number', example: 39000 },
      quantity: { type: 'integer', example: 10 },
      categoryId: { type: 'string', format: 'uuid' },
      images: { type: 'array', items: { type: 'string' } },
      colors: { type: 'array', items: { type: 'string' } },
      sizes: { type: 'array', items: { type: 'string' } },
    },
  },
  VendorBankRequest: {
    type: 'object',
    required: ['bankName', 'accountNumber', 'accountName', 'bankCode'],
    properties: {
      bankName: { type: 'string', example: 'GTBank' },
      accountNumber: { type: 'string', example: '0123456789' },
      accountName: { type: 'string', example: 'Balogun Store Alpha' },
      bankCode: { type: 'string', example: '058' },
    },
  },
  AssignDriverRequest: {
    type: 'object',
    required: ['orderId', 'driverId'],
    properties: {
      orderId: { type: 'string', format: 'uuid' },
      driverId: { type: 'string', format: 'uuid' },
    },
  },
  DriverJobUpdateRequest: {
    type: 'object',
    required: ['status'],
    properties: {
      status: {
        type: 'string',
        enum: ['assigned', 'driver_acknowledged', 'at_pickup', 'item_packed', 'qr_tagged', 'in_transit', 'delivered', 'failed'],
      },
      deliveryProof: { type: 'string' },
      trackingPath: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            lat: { type: 'number' },
            lng: { type: 'number' },
            timestamp: { type: 'string' },
          },
        },
      },
    },
  },
  AdminUserRequest: {
    type: 'object',
    required: ['email', 'password'],
    properties: {
      email: { type: 'string', format: 'email' },
      password: { type: 'string', minLength: 6 },
      firstName: { type: 'string' },
      lastName: { type: 'string' },
      role: { type: 'string', enum: ['shopper', 'vendor', 'field_agent', 'ev_driver', 'admin', 'super_admin'] },
    },
  },
  RoleRequest: {
    type: 'object',
    required: ['role'],
    properties: { role: { type: 'string', enum: ['shopper', 'vendor', 'field_agent', 'ev_driver', 'admin', 'super_admin'] } },
  },
  OrderStatusRequest: {
    type: 'object',
    required: ['status'],
    properties: {
      status: {
        type: 'string',
        enum: ['pending', 'confirmed', 'processing', 'packed', 'picked_up', 'in_transit', 'delivered', 'cancelled', 'returned', 'refunded'],
      },
    },
  },
  ProductReviewRequest: {
    type: 'object',
    required: ['status'],
    properties: {
      status: { type: 'string', enum: ['draft', 'pending_approval', 'approved', 'rejected', 'disabled', 'sold_out'] },
      adjustedSellingPrice: { type: 'number' },
    },
  },
  VendorTierRequest: {
    type: 'object',
    properties: {
      tier: { type: 'string', enum: ['tier_1', 'tier_2', 'tier_3'] },
      commissionPercentage: { type: 'number', minimum: 0, maximum: 100 },
    },
  },
  SettlementTriggerRequest: {
    type: 'object',
    properties: {
      reason: { type: 'string' },
      idempotencyKey: { type: 'string' },
    },
  },
  ReportRequest: {
    type: 'object',
    properties: { type: { type: 'string', example: 'sales' } },
  },
  BoothRequest: {
    type: 'object',
    required: ['name', 'location'],
    properties: {
      name: { type: 'string', example: 'Balogun Main Gate' },
      description: { type: 'string' },
      boothType: { type: 'string', enum: ['phygital', 'micro_hub'] },
      location: {
        type: 'object',
        required: ['address', 'lat', 'lng'],
        properties: {
          address: { type: 'string' },
          lat: { type: 'number' },
          lng: { type: 'number' },
        },
      },
      fieldAgentId: { type: 'string', format: 'uuid' },
      previewImageUrl: { type: 'string' },
    },
  },
  BoothStatusRequest: {
    type: 'object',
    properties: { isActive: { type: 'boolean' } },
  },
};

function successResponse(description = 'Successful response') {
  return {
    description,
    content: {
      'application/json': {
        schema: { $ref: '#/components/schemas/ApiSuccess' },
      },
    },
  };
}

function errorResponse(description) {
  return {
    description,
    content: {
      'application/json': {
        schema: { $ref: '#/components/schemas/ApiError' },
      },
    },
  };
}

function body(schemaRef, required = true) {
  return {
    required,
    content: {
      'application/json': {
        schema: { $ref: `#/components/schemas/${schemaRef}` },
      },
    },
  };
}

function param(name, description = `${name} value`) {
  return { name, in: 'path', required: true, schema: { type: 'string' }, description };
}

function query(name, schema = { type: 'string' }, description = `${name} filter`) {
  return { name, in: 'query', required: false, schema, description };
}

function guestHeader() {
  return {
    name: 'X-Guest-Id',
    in: 'header',
    required: false,
    schema: { type: 'string' },
    description: 'Guest session id. Use this instead of Bearer auth for guest cart, checkout, orders, notifications, and device registration.',
  };
}

function op(tag, summary, options = {}) {
  return {
    tags: [tag],
    summary,
    description: options.description || summary,
    security: options.public ? [] : [{ bearerAuth: [] }],
    parameters: options.parameters || [],
    requestBody: options.requestBody,
    responses: {
      200: successResponse(),
      201: successResponse('Created successfully'),
      400: errorResponse('Invalid request'),
      401: errorResponse('Authentication required or token invalid'),
      403: errorResponse('Permission denied'),
      404: errorResponse('Resource not found'),
    },
  };
}

const paths = {};
function add(method, path, operation) {
  paths[path] = paths[path] || {};
  paths[path][method] = operation;
}

// System
add('get', '/health', op('System', 'Check API health', { public: true }));

// Auth
add('post', `${apiPrefix}/auth/lookup`, op('Authentication', 'Lookup email and return next auth step', { public: true, requestBody: body('AuthLookupRequest') }));
add('post', `${apiPrefix}/auth/signup/start`, op('Authentication', 'Start staged signup and send email OTP', { public: true, requestBody: body('SignupStartRequest') }));
add('post', `${apiPrefix}/auth/signup/verify`, op('Authentication', 'Verify staged signup OTP', { public: true, requestBody: body('SignupVerifyRequest') }));
add('post', `${apiPrefix}/auth/signup/complete`, op('Authentication', 'Complete staged signup and issue tokens', { public: true, requestBody: body('SignupCompleteRequest') }));
add('post', `${apiPrefix}/auth/register`, op('Authentication', 'Register shopper account', { public: true, requestBody: body('RegisterRequest') }));
add('post', `${apiPrefix}/auth/login`, op('Authentication', 'Login shopper/mobile user', { public: true, requestBody: body('LoginRequest') }));
add('post', `${apiPrefix}/auth/verify-otp`, op('Authentication', 'Verify email OTP', { public: true, requestBody: body('OtpRequest') }));
add('post', `${apiPrefix}/auth/refresh`, op('Authentication', 'Refresh access token', { public: true, requestBody: body('RefreshRequest') }));
add('post', `${apiPrefix}/auth/password/forgot`, op('Authentication', 'Request password reset code', { public: true, requestBody: body('PasswordForgotRequest') }));
add('post', `${apiPrefix}/auth/password/verify`, op('Authentication', 'Verify password reset code', { public: true, requestBody: body('PasswordVerifyRequest') }));
add('post', `${apiPrefix}/auth/password/reset`, op('Authentication', 'Reset password with code', { public: true, requestBody: body('PasswordResetRequest') }));
add('get', `${apiPrefix}/auth/profile`, op('Authentication', 'Get current authenticated profile'));
add('patch', `${apiPrefix}/auth/profile`, op('Authentication', 'Update current authenticated profile', { requestBody: body('ProfileRequest') }));
add('post', `${apiPrefix}/auth/complete-profile`, op('Authentication', 'Complete shopper profile', { requestBody: body('ProfileRequest') }));
add('post', `${apiPrefix}/auth/password/change`, op('Authentication', 'Change authenticated user password', { requestBody: body('ChangePasswordRequest') }));
add('post', `${apiPrefix}/auth/social`, op('Authentication', 'Social login placeholder', { public: true }));

// Public marketplace
add('get', `${apiPrefix}/feed`, op('Public Marketplace', 'Get homepage feed', { public: true }));
add('get', `${apiPrefix}/products`, op('Public Marketplace', 'List approved products', { public: true, parameters: [query('page', { type: 'integer' }), query('limit', { type: 'integer' }), query('q'), query('categoryId'), query('vendorId'), query('minPrice', { type: 'number' }), query('maxPrice', { type: 'number' })] }));
add('get', `${apiPrefix}/products/{id}`, op('Public Marketplace', 'Get product detail', { public: true, parameters: [param('id', 'Product id')] }));
add('get', `${apiPrefix}/categories`, op('Public Marketplace', 'List categories', { public: true }));
add('get', `${apiPrefix}/categories/tree`, op('Public Marketplace', 'List category tree', { public: true }));
add('get', `${apiPrefix}/categories/{id}`, op('Public Marketplace', 'Get category detail', { public: true, parameters: [param('id', 'Category id')] }));
add('get', `${apiPrefix}/vendors`, op('Public Marketplace', 'List approved vendors', { public: true, parameters: [query('page', { type: 'integer' }), query('limit', { type: 'integer' })] }));
add('get', `${apiPrefix}/vendors/{id}`, op('Public Marketplace', 'Get vendor detail', { public: true, parameters: [param('id', 'Vendor id')] }));
add('get', `${apiPrefix}/booths`, op('Public Marketplace', 'List active booths', { public: true }));
add('get', `${apiPrefix}/booths/nearby`, op('Public Marketplace', 'List nearby booths', { public: true, parameters: [query('lat', { type: 'number' }), query('lng', { type: 'number' })] }));
add('get', `${apiPrefix}/booths/{id}`, op('Public Marketplace', 'Get booth detail', { public: true, parameters: [param('id', 'Booth id')] }));
add('get', `${apiPrefix}/search`, op('Public Marketplace', 'Search products and vendors', { public: true, parameters: [query('q')] }));
add('get', `${apiPrefix}/search/suggestions`, op('Public Marketplace', 'Get search suggestions', { public: true, parameters: [query('q')] }));

// Customer
add('get', `${apiPrefix}/cart`, op('Customer Cart', 'Get current cart', { parameters: [guestHeader()] }));
add('post', `${apiPrefix}/cart/items`, op('Customer Cart', 'Add item to cart', { parameters: [guestHeader()], requestBody: body('CartItemRequest') }));
add('patch', `${apiPrefix}/cart/items/{itemId}`, op('Customer Cart', 'Update cart item quantity', { parameters: [guestHeader(), param('itemId', 'Cart item id')], requestBody: body('QuantityRequest') }));
add('delete', `${apiPrefix}/cart/items/{itemId}`, op('Customer Cart', 'Remove item from cart', { parameters: [guestHeader(), param('itemId', 'Cart item id')] }));
add('delete', `${apiPrefix}/cart`, op('Customer Cart', 'Clear current cart', { parameters: [guestHeader()] }));
add('post', `${apiPrefix}/checkout`, op('Customer Orders', 'Create order from current cart', { parameters: [guestHeader()], requestBody: body('CheckoutRequest') }));
add('get', `${apiPrefix}/orders`, op('Customer Orders', 'List current shopper or guest orders', { parameters: [guestHeader()] }));
add('get', `${apiPrefix}/orders/{id}`, op('Customer Orders', 'Get current shopper or guest order detail', { parameters: [guestHeader(), param('id', 'Order id')] }));
add('post', `${apiPrefix}/orders/{id}/cancel`, op('Customer Orders', 'Cancel current shopper or guest order', { parameters: [guestHeader(), param('id', 'Order id')], requestBody: { required: false, content: { 'application/json': { schema: { type: 'object', properties: { reason: { type: 'string' } } } } } } }));
add('get', `${apiPrefix}/negotiations`, op('Negotiations', 'List current shopper or guest negotiations', { parameters: [guestHeader()] }));
add('post', `${apiPrefix}/negotiations`, op('Negotiations', 'Start negotiation', { parameters: [guestHeader()], requestBody: body('NegotiationRequest') }));
add('get', `${apiPrefix}/negotiations/{id}`, op('Negotiations', 'Get negotiation detail', { parameters: [guestHeader(), param('id', 'Negotiation id')] }));
add('post', `${apiPrefix}/negotiations/{id}/counter`, op('Negotiations', 'Counter negotiation offer', { parameters: [guestHeader(), param('id', 'Negotiation id')], requestBody: body('NegotiationCounterRequest') }));
add('post', `${apiPrefix}/negotiations/{id}/accept`, op('Negotiations', 'Accept negotiation counter', { parameters: [guestHeader(), param('id', 'Negotiation id')] }));
add('post', `${apiPrefix}/payments/initialize`, op('Payments', 'Initialize payment with provider-ready stub', { parameters: [guestHeader()], requestBody: body('PaymentInitializeRequest') }));
add('post', `${apiPrefix}/payments/verify/{reference}`, op('Payments', 'Verify payment reference', { parameters: [guestHeader(), param('reference', 'Payment transaction reference')] }));
add('get', `${apiPrefix}/payments/orders/{orderId}/status`, op('Payments', 'Get order payment status', { parameters: [guestHeader(), param('orderId', 'Order id')] }));
add('get', `${apiPrefix}/notifications`, op('Notifications', 'List notifications', { parameters: [guestHeader()] }));
add('patch', `${apiPrefix}/notifications/{id}/read`, op('Notifications', 'Mark notification as read', { parameters: [guestHeader(), param('id', 'Notification id')] }));
add('delete', `${apiPrefix}/notifications/{id}`, op('Notifications', 'Delete notification', { parameters: [guestHeader(), param('id', 'Notification id')] }));
add('post', `${apiPrefix}/devices/register`, op('Devices', 'Register Expo push device token', { parameters: [guestHeader()], requestBody: body('DeviceRegisterRequest') }));
add('post', `${apiPrefix}/devices/unregister`, op('Devices', 'Unregister Expo push device token', { parameters: [guestHeader()], requestBody: body('DeviceUnregisterRequest', false) }));

// Vendor
add('post', `${apiPrefix}/vendors/me/register`, op('Vendor Portal', 'Register current user as vendor', { requestBody: body('VendorRegistrationRequest') }));
add('get', `${apiPrefix}/vendors/me/profile`, op('Vendor Portal', 'Get current vendor profile'));
add('patch', `${apiPrefix}/vendors/me/profile`, op('Vendor Portal', 'Update current vendor profile', { requestBody: body('VendorRegistrationRequest', false) }));
add('get', `${apiPrefix}/vendors/me/products`, op('Vendor Portal', 'List current vendor products'));
add('post', `${apiPrefix}/vendors/me/products`, op('Vendor Portal', 'Create vendor product for review', { requestBody: body('ProductRequest') }));
add('patch', `${apiPrefix}/vendors/me/products/{id}`, op('Vendor Portal', 'Update vendor product and return to review', { parameters: [param('id', 'Product id')], requestBody: body('ProductRequest', false) }));
add('get', `${apiPrefix}/vendors/me/orders`, op('Vendor Portal', 'List current vendor orders'));
add('get', `${apiPrefix}/vendors/me/settlements`, op('Vendor Portal', 'List current vendor settlements and summary'));
add('patch', `${apiPrefix}/vendors/me/bank-details`, op('Vendor Portal', 'Update current vendor bank details', { requestBody: body('VendorBankRequest') }));

// Logistics, uploads, webhooks
add('post', `${apiPrefix}/logistics/assign-driver`, op('Logistics', 'Assign driver to order', { requestBody: body('AssignDriverRequest') }));
add('get', `${apiPrefix}/logistics/driver/jobs`, op('Logistics', 'List driver jobs'));
add('patch', `${apiPrefix}/logistics/driver/jobs/{id}`, op('Logistics', 'Update driver job status/proof/location', { parameters: [param('id', 'Logistics job id')], requestBody: body('DriverJobUpdateRequest') }));
add('post', `${apiPrefix}/logistics/driver/jobs/{id}/verify-otp`, op('Logistics', 'Verify pickup OTP for driver job', { parameters: [param('id', 'Logistics job id')], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['otp'], properties: { otp: { type: 'string', example: '123456' } } } } } } }));
add('get', `${apiPrefix}/logistics/field-agent/profile`, op('Logistics', 'Get current field-agent profile'));
add('post', `${apiPrefix}/upload/image`, op('Uploads', 'Upload one image', { requestBody: { required: true, content: { 'multipart/form-data': { schema: { type: 'object', required: ['image'], properties: { image: { type: 'string', format: 'binary' } } } } } } }));
add('post', `${apiPrefix}/upload/images`, op('Uploads', 'Upload multiple images', { requestBody: { required: true, content: { 'multipart/form-data': { schema: { type: 'object', required: ['images'], properties: { images: { type: 'array', items: { type: 'string', format: 'binary' } } } } } } } }));
add('post', `${apiPrefix}/webhooks/payments/{gateway}`, op('Webhooks', 'Receive payment provider webhook', { public: true, parameters: [param('gateway', 'Payment gateway: paystack or nomba')], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } } } }));

// Admin
add('post', `${apiPrefix}/admin/auth/login`, op('Admin Auth', 'Login admin or super-admin', { public: true, requestBody: body('LoginRequest') }));
add('get', `${apiPrefix}/admin/dashboard`, op('Admin Dashboard', 'Get admin dashboard summary'));
add('get', `${apiPrefix}/admin/analytics`, op('Admin Dashboard', 'Get admin analytics series'));
add('get', `${apiPrefix}/admin/health`, op('Admin Dashboard', 'Check admin API health'));
add('get', `${apiPrefix}/admin/users`, op('Admin Users', 'List users', { parameters: [query('page', { type: 'integer' }), query('limit', { type: 'integer' }), query('role'), query('search')] }));
add('get', `${apiPrefix}/admin/customers`, op('Admin Users', 'List shopper customers', { parameters: [query('page', { type: 'integer' }), query('limit', { type: 'integer' }), query('search')] }));
add('get', `${apiPrefix}/admin/users/{id}`, op('Admin Users', 'Get user detail', { parameters: [param('id', 'User id')] }));
add('post', `${apiPrefix}/admin/users`, op('Admin Users', 'Create user (super-admin)', { requestBody: body('AdminUserRequest') }));
add('patch', `${apiPrefix}/admin/users/{id}/toggle`, op('Admin Users', 'Toggle user active status', { parameters: [param('id', 'User id')] }));
add('patch', `${apiPrefix}/admin/users/{id}/role`, op('Admin Users', 'Change user role (super-admin)', { parameters: [param('id', 'User id')], requestBody: body('RoleRequest') }));
add('get', `${apiPrefix}/admin/vendors`, op('Admin Vendors', 'List vendors', { parameters: [query('page', { type: 'integer' }), query('limit', { type: 'integer' }), query('approved', { type: 'boolean' })] }));
add('patch', `${apiPrefix}/admin/vendors/{id}/approve`, op('Admin Vendors', 'Approve vendor', { parameters: [param('id', 'Vendor id')] }));
add('patch', `${apiPrefix}/admin/vendors/{id}/reject`, op('Admin Vendors', 'Reject vendor', { parameters: [param('id', 'Vendor id')], requestBody: { required: false, content: { 'application/json': { schema: { type: 'object', properties: { reason: { type: 'string' } } } } } } }));
add('patch', `${apiPrefix}/admin/vendors/{id}/tier`, op('Admin Vendors', 'Update vendor tier/commission (super-admin)', { parameters: [param('id', 'Vendor id')], requestBody: body('VendorTierRequest') }));
add('get', `${apiPrefix}/admin/products/review`, op('Admin Products', 'List product review queue', { parameters: [query('page', { type: 'integer' }), query('limit', { type: 'integer' })] }));
add('get', `${apiPrefix}/admin/products`, op('Admin Products', 'List all products', { parameters: [query('page', { type: 'integer' }), query('limit', { type: 'integer' }), query('status'), query('vendorId'), query('search')] }));
add('patch', `${apiPrefix}/admin/products/{id}/review`, op('Admin Products', 'Approve/reject product review', { parameters: [param('id', 'Product id')], requestBody: body('ProductReviewRequest') }));
add('get', `${apiPrefix}/admin/orders`, op('Admin Orders', 'List orders', { parameters: [query('page', { type: 'integer' }), query('limit', { type: 'integer' }), query('status')] }));
add('get', `${apiPrefix}/admin/orders/{id}`, op('Admin Orders', 'Get order detail', { parameters: [param('id', 'Order id')] }));
add('patch', `${apiPrefix}/admin/orders/{id}/status`, op('Admin Orders', 'Update order status', { parameters: [param('id', 'Order id')], requestBody: body('OrderStatusRequest') }));
add('get', `${apiPrefix}/admin/dispatch/active`, op('Admin Dispatch', 'List active deliveries'));
add('get', `${apiPrefix}/admin/dispatch`, op('Admin Dispatch', 'List delivery records', { parameters: [query('page', { type: 'integer' }), query('limit', { type: 'integer' })] }));
add('get', `${apiPrefix}/admin/dispatch/drivers`, op('Admin Dispatch', 'List active drivers'));
add('get', `${apiPrefix}/admin/field-agents`, op('Admin Field Agents', 'List field agents', { parameters: [query('page', { type: 'integer' }), query('limit', { type: 'integer' })] }));
add('get', `${apiPrefix}/admin/field-agents/{id}`, op('Admin Field Agents', 'Get field-agent detail', { parameters: [param('id', 'Field-agent id')] }));
add('patch', `${apiPrefix}/admin/field-agents/{id}/toggle`, op('Admin Field Agents', 'Toggle field-agent active status', { parameters: [param('id', 'Field-agent id')] }));
add('get', `${apiPrefix}/admin/booths`, op('Admin Booths', 'List booths', { parameters: [query('page', { type: 'integer' }), query('limit', { type: 'integer' })] }));
add('get', `${apiPrefix}/admin/booths/analytics`, op('Admin Booths', 'Get booth analytics'));
add('get', `${apiPrefix}/admin/booths/{id}`, op('Admin Booths', 'Get booth detail', { parameters: [param('id', 'Booth id')] }));
add('post', `${apiPrefix}/admin/booths`, op('Admin Booths', 'Provision booth (super-admin)', { requestBody: body('BoothRequest') }));
add('patch', `${apiPrefix}/admin/booths/{id}/status`, op('Admin Booths', 'Toggle booth status', { parameters: [param('id', 'Booth id')], requestBody: body('BoothStatusRequest', false) }));
add('get', `${apiPrefix}/admin/financials`, op('Admin Financials', 'Get financial dashboard (super-admin)'));
add('get', `${apiPrefix}/admin/financials/settlements`, op('Admin Financials', 'List settlements (super-admin)', { parameters: [query('page', { type: 'integer' }), query('limit', { type: 'integer' }), query('status')] }));
add('post', `${apiPrefix}/admin/financials/settlements/trigger/{vendorId}`, op('Admin Financials', 'Trigger settlement payout stub (super-admin)', { parameters: [param('vendorId', 'Vendor id')], requestBody: body('SettlementTriggerRequest', false) }));
add('get', `${apiPrefix}/admin/financials/audit-logs`, op('Admin Financials', 'List financial audit logs (super-admin)'));
add('get', `${apiPrefix}/admin/negotiations`, op('Admin Negotiations', 'List AI negotiations', { parameters: [query('page', { type: 'integer' }), query('limit', { type: 'integer' })] }));
add('get', `${apiPrefix}/admin/negotiations/{id}`, op('Admin Negotiations', 'Get AI negotiation detail', { parameters: [param('id', 'Negotiation id')] }));
add('get', `${apiPrefix}/admin/reports`, op('Admin Reports', 'List generated reports'));
add('post', `${apiPrefix}/admin/reports/generate`, op('Admin Reports', 'Generate report metadata', { requestBody: body('ReportRequest', false) }));
add('get', `${apiPrefix}/admin/settings`, op('Admin Settings', 'Get platform settings'));
add('patch', `${apiPrefix}/admin/settings`, op('Admin Settings', 'Update platform settings (super-admin)', { requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } } } }));

const spec = {
  openapi: '3.0.3',
  info: {
    title: 'Hook API',
    version: '1.0.0',
    description: 'Express + TypeScript API documentation for Hook customer, vendor, logistics, upload, webhook, and admin workflows. All responses keep the standard shape: { success, message, data, timestamp }.',
  },
  servers: [
    { url: 'http://localhost:4000', description: 'Local development server' },
    { url: 'https://hook-api.onrender.com', description: 'Production server' },
  ],
  tags,
  paths,
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      },
    },
    schemas,
  },
};

writeFileSync(join(__dirname, '..', 'swagger-spec.json'), `${JSON.stringify(spec, null, 2)}\n`);
console.log(`Swagger spec generated with ${Object.keys(paths).length} paths.`);
