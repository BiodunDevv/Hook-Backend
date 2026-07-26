import dotenv from 'dotenv';
import mongoose from 'mongoose';
import type { AddressInfo } from 'net';
import { AccountStatus, AccountType, ProductStatus, ScopeType, UserRole } from '@lib/constants';
import { hashPassword } from '@lib/security';
import { OperationState } from '@models/platform/geography.model';
import { Role } from '@models/platform/access.model';
import { StaffProfile } from '@models/platform/operations-accounts.model';
import { AccountSession } from '@models/platform/session.model';
import { User } from '@models/users/user.model';
import { Category } from '@models/categories/category.model';
import { Product } from '@models/products/product.model';
import { connectDatabase, disconnectDatabase } from '@config/data-source';
import { ensurePlatformAccessCatalog } from '@services/platform-bootstrap.service';
import { createApp } from '../../app';

dotenv.config({ quiet: true });

const databaseName = `hook_phase2_http_test_${Date.now()}`;
process.env.NODE_ENV = 'test';
process.env.MONGODB_DB_NAME = databaseName;
process.env.ENABLE_API_DOCS = 'false';
delete process.env.BREVO_API_KEY;

type Envelope<T = unknown> = {
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
  meta?: { requestId: string; timestamp: string };
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  if (!databaseName.startsWith('hook_phase2_http_test_')) {
    throw new Error('Refusing to run outside the isolated Phase 2 HTTP database');
  }
  await connectDatabase();
  await mongoose.connection.dropDatabase();
  await ensurePlatformAccessCatalog();

  const superRole = await Role.findOne({ key: 'SUPER_ADMIN' });
  const managerRole = await Role.findOne({ key: 'STATE_OPERATIONS_MANAGER' });
  assert(superRole && managerRole, 'Platform roles were not bootstrapped');
  assert(
    managerRole.permissionKeys.includes('orders.view') && managerRole.permissionKeys.includes('orders.edit'),
    'Retained commerce permissions were not consolidated into the platform Role catalogue',
  );

  const password = 'Phase2-Validation-Password!';
  const superAccount = await User.create({
    publicId: 'STF-2026-900001',
    accountType: AccountType.STAFF,
    accountStatus: AccountStatus.ACTIVE,
    email: 'phase2.super@hook.test',
    phone: '+2348000000001',
    password: await hashPassword(password),
    firstName: 'Phase',
    lastName: 'Super',
    role: UserRole.SUPER_ADMIN,
    roleIds: [superRole.id],
    scopeType: ScopeType.GLOBAL,
    assignedStateIds: [],
    assignedHubIds: [],
    isEmailVerified: true,
    isPhoneVerified: true,
    isActive: true,
  });
  await StaffProfile.create({
    publicId: superAccount.publicId,
    accountId: superAccount.id,
    roleIds: [superRole.id],
    scopeType: ScopeType.GLOBAL,
    stateIds: [],
    hubIds: [],
    status: AccountStatus.ACTIVE,
  });

  const server = createApp().listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  async function request<T = unknown>(
    path: string,
    options: RequestInit = {},
  ): Promise<{ status: number; headers: Headers; body: Envelope<T> }> {
    const headers = new Headers(options.headers);
    if (options.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
    const response = await fetch(`${base}${path}`, { ...options, headers });
    return {
      status: response.status,
      headers: response.headers,
      body: await response.json() as Envelope<T>,
    };
  }

  try {
    const health = await request<{ status: string }>('/health', {
      headers: { 'x-request-id': 'phase2-http-e2e' },
    });
    assert(health.status === 200 && health.body.success, 'Health envelope failed');
    assert(health.body.meta?.requestId === 'phase2-http-e2e', 'Request ID missing from envelope');
    assert(health.headers.get('x-request-id') === 'phase2-http-e2e', 'Request ID response header missing');

    const guest = await request<{ token: string }>('/api/v1/guest-sessions', {
      method: 'POST',
      body: JSON.stringify({ platform: 'ios', deviceId: 'phase2-device' }),
    });
    assert(guest.status === 201 && guest.body.data?.token, 'Guest session creation failed');
    const guestToken = guest.body.data.token;
    const currentGuest = await request('/api/v1/guest-sessions/current', {
      headers: { 'x-guest-session': guestToken },
    });
    assert(currentGuest.status === 200 && currentGuest.body.success, 'Guest session restoration failed');
    const revokedGuest = await request('/api/v1/guest-sessions/current', {
      method: 'DELETE',
      headers: { 'x-guest-session': guestToken },
    });
    assert(revokedGuest.status === 200, 'Guest session revocation failed');
    const staleGuest = await request('/api/v1/guest-sessions/current', {
      headers: { 'x-guest-session': guestToken },
    });
    assert(staleGuest.status === 401 && staleGuest.body.error?.code === 'TOKEN_INVALID', 'Revoked guest session remained usable');

    const category = await Category.create({ name: 'Phase 2 Products', slug: 'phase-2-products', isActive: true });
    await Product.create({
      title: 'Public identifier product',
      slug: 'public-identifier-product',
      description: 'Phase 2 boundary validation',
      costPrice: 12000,
      sellingPrice: 10000,
      minAcceptablePrice: 9000,
      quantity: 5,
      images: ['https://images.unsplash.com/photo-1542291026-7eec264c27ff'],
      hookId: 'HK-PHASE2-001',
      status: ProductStatus.APPROVED,
      categoryId: category.id,
      source: 'admin',
    });
    const products = await request<{ data: Array<{ id: string }> }>('/api/v1/products');
    assert(products.body.data?.data[0]?.id === 'HK-PHASE2-001', 'Public product list exposed a Mongo identifier');
    const productDetail = await request<{ id: string }>('/api/v1/products/HK-PHASE2-001');
    assert(productDetail.status === 200 && productDetail.body.data?.id === 'HK-PHASE2-001', 'Public product identifier lookup failed');

    const login = await request<{ accessToken: string; refreshToken: string }>('/api/v1/admin/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: superAccount.email, password }),
    });
    assert(login.status === 200 && login.body.data?.accessToken && login.body.data.refreshToken, 'Staff login failed');
    const originalRefresh = login.body.data.refreshToken;
    const accountAfterLogin = await User.findById(superAccount.id).lean();
    const sessionAfterLogin = await AccountSession.findOne({ accountId: superAccount.id }).lean();
    assert(
      accountAfterLogin?.isActive && accountAfterLogin.accountStatus === AccountStatus.ACTIVE,
      `Staff account changed during login: ${JSON.stringify(accountAfterLogin)}`,
    );
    assert(sessionAfterLogin, 'Staff session was not linked to the account Mongo identifier');

    const rotated = await request<{ accessToken: string; refreshToken: string }>('/api/v1/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken: originalRefresh }),
    });
    assert(
      rotated.status === 200 && rotated.body.data?.refreshToken !== originalRefresh,
      `Refresh token did not rotate: ${rotated.status} ${rotated.body.error?.code || ''} ${rotated.body.error?.message || ''}`,
    );
    const replay = await request('/api/v1/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken: originalRefresh }),
    });
    assert(replay.status === 401 && replay.body.error?.code === 'TOKEN_INVALID', 'Refresh replay was not rejected');
    const familyRevoked = await request('/api/v1/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken: rotated.body.data!.refreshToken }),
    });
    assert(familyRevoked.status === 401, 'Refresh replay did not revoke the session family');

    const secondLogin = await request<{ accessToken: string }>('/api/v1/admin/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: superAccount.email, password }),
    });
    const authorization = `Bearer ${secondLogin.body.data!.accessToken}`;
    const createState = async (name: string, code: string) => request<{ id: string; publicId: string }>('/api/v1/admin/states', {
      method: 'POST',
      headers: { authorization },
      body: JSON.stringify({ name, code, status: 'active' }),
    });
    const lagos = await createState('Lagos', 'LA');
    const abuja = await createState('Federal Capital Territory', 'FC');
    assert(lagos.status === 201 && abuja.status === 201, 'State creation scenario failed');

    const createCity = async (stateId: string, name: string, code: string) => request<{ id: string; publicId: string }>('/api/v1/admin/cities', {
      method: 'POST',
      headers: { authorization },
      body: JSON.stringify({ stateId, name, code, status: 'active' }),
    });
    const lagosCity = await createCity(lagos.body.data!.publicId, 'Lagos City', 'LAG');
    const abujaCity = await createCity(abuja.body.data!.publicId, 'Abuja', 'ABV');
    assert(lagosCity.status === 201 && abujaCity.status === 201, 'Public-ID City relationship creation failed');
    const incompatibleZone = await request('/api/v1/admin/zones', {
      method: 'POST',
      headers: { authorization },
      body: JSON.stringify({
        stateId: lagos.body.data!.publicId,
        cityId: abujaCity.body.data!.publicId,
        name: 'Invalid cross-state zone',
        code: 'INVALID',
      }),
    });
    assert(
      incompatibleZone.status === 409 && incompatibleZone.body.error?.code === 'CONFLICT',
      'Cross-state geography relationship was not rejected',
    );
    const lagosZone = await request<{ id: string; publicId: string }>('/api/v1/admin/zones', {
      method: 'POST',
      headers: { authorization },
      body: JSON.stringify({
        stateId: lagos.body.data!.publicId,
        cityId: lagosCity.body.data!.publicId,
        name: 'Lagos Core',
        code: 'LGC',
        status: 'active',
      }),
    });
    assert(lagosZone.status === 201, 'Compatible Service Zone creation failed');
    const incompatibleZoneUpdate = await request(
      `/api/v1/admin/zones/${lagosZone.body.data!.publicId}`,
      {
        method: 'PATCH',
        headers: { authorization },
        body: JSON.stringify({ cityId: abujaCity.body.data!.publicId }),
      },
    );
    assert(
      incompatibleZoneUpdate.status === 409,
      'Cross-state Service Zone update was not rejected',
    );

    const incompatibleMarket = await request('/api/v1/admin/markets', {
      method: 'POST',
      headers: { authorization },
      body: JSON.stringify({
        stateId: lagos.body.data!.publicId,
        cityId: abujaCity.body.data!.publicId,
        name: 'Invalid cross-state Market',
        address: 'Invalid Market address',
      }),
    });
    assert(
      incompatibleMarket.status === 409 && incompatibleMarket.body.error?.code === 'CONFLICT',
      'Cross-state Market relationship was not rejected',
    );

    const incompatibleHub = await request('/api/v1/admin/hubs', {
      method: 'POST',
      headers: { authorization },
      body: JSON.stringify({
        stateId: lagos.body.data!.publicId,
        cityId: abujaCity.body.data!.publicId,
        name: 'Invalid cross-state Hub',
        address: 'Invalid Hub address',
        zoneIds: [],
        marketIds: [],
        staffIds: [],
      }),
    });
    assert(
      incompatibleHub.status === 409 && incompatibleHub.body.error?.code === 'CONFLICT',
      'Cross-state Dispatch Hub relationship was not rejected',
    );

    const lagosHub = await request<{ id: string; publicId: string; stateId: string; cityId: string }>(
      '/api/v1/admin/hubs',
      {
        method: 'POST',
        headers: { authorization },
        body: JSON.stringify({
          stateId: lagos.body.data!.publicId,
          cityId: lagosCity.body.data!.publicId,
          name: 'Lagos Dispatch Hub',
          address: '1 Hook Way, Lagos',
          zoneIds: [lagosZone.body.data!.publicId],
          marketIds: [],
          staffIds: [],
          status: 'active',
        }),
      },
    );
    assert(
      lagosHub.status === 201
      && lagosHub.body.data?.id === lagosHub.body.data?.publicId
      && lagosHub.body.data?.stateId === lagos.body.data!.publicId
      && lagosHub.body.data?.cityId === lagosCity.body.data!.publicId,
      'Dispatch Hub response did not preserve the public-ID boundary',
    );

    const lagosMarket = await request<{ id: string; publicId: string }>('/api/v1/admin/markets', {
      method: 'POST',
      headers: { authorization },
      body: JSON.stringify({
        stateId: lagos.body.data!.publicId,
        cityId: lagosCity.body.data!.publicId,
        zoneId: lagosZone.body.data!.publicId,
        name: 'Lagos Central Market',
        address: '2 Hook Way, Lagos',
        status: 'active',
      }),
    });
    assert(lagosMarket.status === 201, 'Compatible Market creation failed');
    const incompatibleMarketUpdate = await request(
      `/api/v1/admin/markets/${lagosMarket.body.data!.publicId}`,
      {
        method: 'PATCH',
        headers: { authorization },
        body: JSON.stringify({ cityId: abujaCity.body.data!.publicId }),
      },
    );
    assert(
      incompatibleMarketUpdate.status === 409,
      'Cross-state Market update was not rejected',
    );
    const assignMarkets = await request<{ marketIds: string[] }>(
      `/api/v1/admin/hubs/${lagosHub.body.data!.publicId}/assign-markets`,
      {
        method: 'POST',
        headers: { authorization },
        body: JSON.stringify({
          marketIds: [lagosMarket.body.data!.publicId],
          reason: 'Validate public identifier assignment',
        }),
      },
    );
    assert(
      assignMarkets.status === 200
      && assignMarkets.body.data?.marketIds[0] === lagosMarket.body.data!.publicId,
      'Public-ID Hub Market assignment failed',
    );
    const incompatibleHubUpdate = await request(
      `/api/v1/admin/hubs/${lagosHub.body.data!.publicId}`,
      {
        method: 'PATCH',
        headers: { authorization },
        body: JSON.stringify({ cityId: abujaCity.body.data!.publicId }),
      },
    );
    assert(
      incompatibleHubUpdate.status === 409,
      'Cross-state Dispatch Hub update was not rejected',
    );
    const stateFilteredHubs = await request<{ data: Array<{ publicId: string }> }>(
      `/api/v1/admin/hubs?stateId=${lagos.body.data!.publicId}`,
      { headers: { authorization } },
    );
    assert(
      stateFilteredHubs.status === 200
      && stateFilteredHubs.body.data?.data.length === 1
      && stateFilteredHubs.body.data.data[0].publicId === lagosHub.body.data!.publicId,
      'Public State identifier filtering did not resolve at the API boundary',
    );

    const invitedStaff = await request<{ publicId: string; status: string }>('/api/v1/admin/staff', {
      method: 'POST',
      headers: { authorization },
      body: JSON.stringify({
        firstName: 'Invited',
        lastName: 'Operator',
        email: 'phase2.invited@hook.test',
        phone: '+2348000000003',
        roleIds: [managerRole.id],
        scopeType: 'single_state',
        stateIds: [lagos.body.data!.publicId],
        hubIds: [],
      }),
    });
    assert(invitedStaff.status === 201 && invitedStaff.body.data?.status === 'invited', 'Staff invitation creation failed');
    assert(
      (invitedStaff.body.data as any)?.stateIds?.[0] === lagos.body.data!.publicId,
      'Staff scope response exposed an internal State identifier',
    );
    const cancelInvitation = await request<{ status: string }>(
      `/api/v1/admin/staff/${invitedStaff.body.data!.publicId}/cancel-invitation`,
      {
        method: 'POST',
        headers: { authorization },
        body: JSON.stringify({ reason: 'HTTP validation cancellation' }),
      },
    );
    assert(
      cancelInvitation.status === 200 && cancelInvitation.body.data?.status === 'disabled',
      'Invitation cancellation failed',
    );

    const lagosRecord = await OperationState.findOne({ publicId: lagos.body.data!.publicId });
    assert(lagosRecord, 'Created state was not persisted');
    const manager = await User.create({
      publicId: 'STF-2026-900002',
      accountType: AccountType.STAFF,
      accountStatus: AccountStatus.ACTIVE,
      email: 'phase2.manager@hook.test',
      phone: '+2348000000002',
      password: await hashPassword(password),
      firstName: 'Lagos',
      lastName: 'Manager',
      role: UserRole.ADMIN,
      roleIds: [managerRole.id],
      scopeType: ScopeType.SINGLE_STATE,
      assignedStateIds: [lagosRecord.id],
      assignedHubIds: [],
      isEmailVerified: true,
      isPhoneVerified: true,
      isActive: true,
    });
    await StaffProfile.create({
      publicId: manager.publicId,
      accountId: manager.id,
      roleIds: [managerRole.id],
      scopeType: ScopeType.SINGLE_STATE,
      stateIds: [lagosRecord.id],
      hubIds: [],
      status: AccountStatus.ACTIVE,
    });
    const managerLogin = await request<{ accessToken: string }>('/api/v1/admin/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: manager.email, password }),
    });
    const managerAuthorization = `Bearer ${managerLogin.body.data!.accessToken}`;
    assert(
      (managerLogin.body.data as any)?.user?.assignedStateIds?.[0] === lagos.body.data!.publicId,
      'Authenticated staff context exposed an internal State identifier',
    );
    const financeDenied = await request('/api/v1/admin/financials', {
      headers: { authorization: managerAuthorization },
    });
    assert(
      financeDenied.status === 403 && financeDenied.body.error?.code === 'ACCESS_DENIED',
      'Legacy admin role bypassed live Role permissions',
    );
    const scopedList = await request<{ data: Array<{ publicId: string }> }>('/api/v1/admin/states', {
      headers: { authorization: managerAuthorization },
    });
    assert(scopedList.status === 200 && scopedList.body.data?.data.length === 1, 'State-scoped list leaked records');
    const crossState = await request(`/api/v1/admin/states/${abuja.body.data!.publicId}`, {
      headers: { authorization: managerAuthorization },
    });
    assert(crossState.status === 403 && crossState.body.error?.code === 'SCOPE_DENIED', 'Cross-state detail access was not denied');

    await Promise.all([
      User.updateOne({ _id: manager.id }, { $set: { accountStatus: AccountStatus.SUSPENDED, isActive: false } }),
      StaffProfile.updateOne({ accountId: manager.id }, { $set: { status: AccountStatus.SUSPENDED } }),
    ]);
    const suspendedAccess = await request('/api/v1/admin/states', {
      headers: { authorization: managerAuthorization },
    });
    assert(suspendedAccess.status === 401, 'Suspended account retained API access');

    console.log('Phase 2 HTTP E2E passed: envelope, guest lifecycle, public IDs, refresh replay, geography relationships, permissions, invitations, scope, suspension');
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await mongoose.connection.dropDatabase();
    await disconnectDatabase();
  }
}

main().catch(async (error) => {
  console.error('Phase 2 HTTP E2E failed');
  console.error(error);
  try {
    if (mongoose.connection.readyState !== 0 && mongoose.connection.name.startsWith('hook_phase2_http_test_')) {
      await mongoose.connection.dropDatabase();
    }
    await disconnectDatabase();
  } finally {
    process.exit(1);
  }
});
