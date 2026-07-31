import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { AccountStatus, AccountType, ScopeType, UserRole } from '@lib/constants';
import { connectDatabase, disconnectDatabase } from '@config/data-source';
import { AdminAuditLog } from '@models/admin/admin-audit-log.model';
import { FieldAgent } from '@models/field-agents/field-agent.model';
import { OperationalState } from '@models/operations/operational-state.model';
import { PlatformAuditLog } from '@models/platform/audit-log.model';
import { OperationCity, OperationState, ServiceZone } from '@models/platform/geography.model';
import { DispatchHub, Market } from '@models/platform/network.model';
import { HookPartner, RunnerMarketAssignment, RunnerProfile, StaffProfile } from '@models/platform/operations-accounts.model';
import { Permission, Role } from '@models/platform/access.model';
import { AccountSession, GuestSession } from '@models/platform/session.model';
import { PublicIdCounter } from '@models/platform/counter.model';
import { AccountInvitation } from '@models/platform/account-invitation.model';
import { User } from '@models/users/user.model';
import { ensurePlatformAccessCatalog } from '@services/platform-bootstrap.service';
import { nextPublicId } from '@services/public-id.service';

dotenv.config({ quiet: true });

type Mode = 'analyze' | 'dry-run' | 'execute';

interface MigrationSummary {
  mode: Mode;
  database: string;
  states: { source: number; create: number; existing: number };
  users: Record<string, number>;
  runnerProfiles: { create: number; existing: number; manualReview: number };
  staffProfiles: { create: number; existing: number };
  legacyAuditLogs: number;
  sessionsInvalidated: number;
  warnings: string[];
}

function modeFromArgs(): Mode {
  const value = process.argv.find((arg) => arg.startsWith('--mode='))?.split('=')[1] || 'dry-run';
  if (!['analyze', 'dry-run', 'execute'].includes(value)) throw new Error(`Unsupported migration mode: ${value}`);
  return value as Mode;
}

function accountMapping(role: UserRole) {
  if (role === UserRole.SHOPPER) return { accountType: AccountType.CUSTOMER, domain: 'customer' as const, status: AccountStatus.ACTIVE };
  if ([UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.SUPPORT].includes(role)) {
    return { accountType: AccountType.STAFF, domain: 'staff' as const, status: AccountStatus.ACTIVE };
  }
  if (role === UserRole.FIELD_AGENT) return { accountType: AccountType.RUNNER, domain: 'runner' as const, status: AccountStatus.ACTIVE };
  return { accountType: undefined, domain: undefined, status: AccountStatus.DISABLED };
}

async function ensurePhase2Indexes() {
  const models = [
    Permission,
    Role,
    PublicIdCounter,
    AccountSession,
    GuestSession,
    AccountInvitation,
    PlatformAuditLog,
    OperationState,
    OperationCity,
    ServiceZone,
    Market,
    DispatchHub,
    StaffProfile,
    RunnerProfile,
    HookPartner,
    RunnerMarketAssignment,
  ];
  for (const model of [AccountSession, GuestSession, AccountInvitation]) {
    await model.createCollection();
    const existing = await model.collection.indexes();
    const expiresIndex = existing.find((index) => index.name === 'expiresAt_1');
    if (expiresIndex && expiresIndex.expireAfterSeconds !== 0) {
      await model.collection.dropIndex(expiresIndex.name!);
    }
  }
  await Promise.all(models.map((model) => model.createIndexes()));
}

async function buildSummary(mode: Mode): Promise<MigrationSummary> {
  const database = mongoose.connection.db?.databaseName || 'unknown';
  const [states, users, fieldAgents, oldAudits, sessions] = await Promise.all([
    OperationalState.find().lean(),
    User.find().lean(),
    FieldAgent.find().lean(),
    AdminAuditLog.countDocuments(),
    AccountSession.countDocuments({ revokedAt: { $exists: false } }),
  ]);
  const existingStates = await OperationState.find({ code: { $in: states.map((state) => state.code) } }).lean();
  const userKinds: Record<string, number> = {};
  for (const user of users) {
    const key = accountMapping(user.role).accountType || `legacy_${user.role}`;
    userKinds[key] = (userKinds[key] || 0) + 1;
  }
  let runnerCreate = 0;
  let runnerExisting = 0;
  let runnerManual = 0;
  for (const fieldAgent of fieldAgents) {
    const user = users.find((candidate) => candidate._id.toString() === fieldAgent.agentId);
    if (!user) { runnerManual += 1; continue; }
    if (await RunnerProfile.exists({ accountId: user._id.toString() })) runnerExisting += 1;
    else runnerCreate += 1;
  }
  const staffUsers = users.filter((user) => accountMapping(user.role).accountType === AccountType.STAFF);
  const staffExisting = await StaffProfile.countDocuments({ accountId: { $in: staffUsers.map((user) => user._id.toString()) } });
  return {
    mode,
    database,
    states: { source: states.length, create: states.length - existingStates.length, existing: existingStates.length },
    users: userKinds,
    runnerProfiles: { create: runnerCreate, existing: runnerExisting, manualReview: runnerManual },
    staffProfiles: { create: staffUsers.length - staffExisting, existing: staffExisting },
    legacyAuditLogs: oldAudits,
    sessionsInvalidated: sessions,
    warnings: [
      'Legacy Booth records are not automatically mapped.',
      'Legacy Vendor and Driver accounts are disabled, not deleted.',
      'Legacy audit records remain read-only; unsafe free-form metadata is not copied automatically.',
      'Runner Market assignments require explicit Market classification and remain a manual-review step.',
    ],
  };
}

export async function seedPhase2Foundation() {
  await ensurePlatformAccessCatalog();
  await ensurePhase2Indexes();
  const roleByKey = new Map((await Role.find().lean()).map((role) => [role.key, role]));
  const legacyStates = await OperationalState.find().lean();
  for (const state of legacyStates) {
    const existing = await OperationState.findOne({ code: state.code });
    if (existing) continue;
    await OperationState.create({
      publicId: await nextPublicId('state'),
      name: state.name,
      code: state.code,
      countryCode: state.countryCode || 'NG',
      status: state.isEnabled ? 'active' : 'inactive',
      timezone: 'Africa/Lagos',
      currency: 'NGN',
      deliveryPromiseHours: 24,
      payAtHubEnabled: false,
      payAtHubLimitMinor: 10000000,
      legacy: { model: 'OperationalState', sourceId: state._id.toString() },
    });
  }

  const users = await User.find();
  for (const user of users) {
    const mapping = accountMapping(user.role);
    if (!user.publicId && mapping.domain) user.publicId = await nextPublicId(mapping.domain);
    user.accountType = mapping.accountType;
    user.accountStatus = mapping.status;
    user.isActive = mapping.status === AccountStatus.ACTIVE;
    user.scopeType = mapping.accountType === AccountType.STAFF ? ScopeType.GLOBAL : ScopeType.SELF;
    user.refreshToken = undefined;
    user.migratedFrom = user.migratedFrom || { model: 'User', sourceId: user.id, migratedAt: new Date() };

    if (mapping.accountType === AccountType.STAFF) {
      const roleKey = user.role === UserRole.SUPER_ADMIN
        ? 'SUPER_ADMIN'
        : user.role === UserRole.ADMIN ? 'OPERATIONS_LEAD' : 'CUSTOMER_SUPPORT_OFFICER';
      const role = roleByKey.get(roleKey);
      if (role) user.roleIds = [role._id.toString()];
      const stateIds = [];
      if (user.operationalStateCode) {
        const state = await OperationState.findOne({ code: user.operationalStateCode }).lean();
        if (state) stateIds.push(state._id.toString());
      }
      await StaffProfile.updateOne(
        { accountId: user.id },
        {
          $setOnInsert: {
            publicId: user.publicId,
            accountId: user.id,
            roleIds: user.roleIds,
            scopeType: user.role === UserRole.SUPER_ADMIN ? ScopeType.GLOBAL : stateIds.length ? ScopeType.SINGLE_STATE : ScopeType.GLOBAL,
            stateIds,
            hubIds: [],
            status: 'active',
          },
        },
        { upsert: true },
      );
    }
    await user.save();
  }

  const agents = await FieldAgent.find().lean();
  for (const agent of agents) {
    const user = await User.findById(agent.agentId);
    if (!user) continue;
    if (!user.publicId) {
      user.publicId = await nextPublicId('runner');
      await user.save();
    }
    const state = agent.stateCode ? await OperationState.findOne({ code: agent.stateCode }).lean() : null;
    await RunnerProfile.updateOne(
      { accountId: user.id },
      {
        $setOnInsert: {
          publicId: user.publicId,
          accountId: user.id,
          stateIds: state ? [state._id.toString()] : [],
          hubIds: [],
          availability: agent.isActive ? 'available' : 'unavailable',
          status: agent.isActive ? 'active' : 'suspended',
          performance: agent.stats,
          legacy: {
            model: 'FieldAgent',
            sourceId: agent._id.toString(),
            assignedMarketText: agent.assignedMarket,
            assignmentReviewRequired: true,
          },
        },
      },
      { upsert: true },
    );
  }

  await AccountSession.updateMany(
    { revokedAt: { $exists: false } },
    { $set: { revokedAt: new Date(), revocationReason: 'phase_02_identity_migration' } },
  );

  // Ensure no legacy Vendor or internal Driver identity remains active.
  await User.updateMany(
    { role: { $in: [UserRole.VENDOR, UserRole.EV_DRIVER] } },
    { $set: { isActive: false, accountStatus: AccountStatus.DISABLED }, $unset: { accountType: 1, refreshToken: 1 } },
  );

  // Keep old logs untouched and add one migration marker to the new domain.
  if (!await PlatformAuditLog.exists({ action: 'migration.phase_02.completed' })) {
    await PlatformAuditLog.create({
      publicId: await nextPublicId('audit'),
      actorType: 'system',
      actorId: 'phase-02-migration',
      action: 'migration.phase_02.completed',
      entityType: 'platform',
      requestId: `migration-${Date.now()}`,
      reason: 'Phase 2 foundation migration',
      after: { completedAt: new Date().toISOString() },
    });
  }
}

async function main() {
  const mode = modeFromArgs();
  await connectDatabase();
  const before = await buildSummary(mode);
  console.log(JSON.stringify({ stage: 'preflight', ...before }, null, 2));
  if (mode === 'execute') {
    if (process.env.PHASE_02_MIGRATION_CONFIRMED !== 'true') {
      throw new Error('Set PHASE_02_MIGRATION_CONFIRMED=true only after a verified backup');
    }
    await seedPhase2Foundation();
    console.log(JSON.stringify({ stage: 'verified', ...(await buildSummary(mode)) }, null, 2));
  }
  await disconnectDatabase();
}

if (require.main === module) {
  main().catch(async (error) => {
    console.error('Phase 2 migration failed');
    console.error(error);
    await disconnectDatabase().catch(() => undefined);
    process.exit(1);
  });
}
