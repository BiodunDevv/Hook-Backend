import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import dotenv from 'dotenv';
import { connectDatabase, disconnectDatabase } from '@config/data-source';
import { AccountStatus, AccountType, ScopeType, UserRole } from '@lib/constants';
import { comparePassword } from '@lib/security';
import { AccountInvitation } from '@models/platform/account-invitation.model';
import { PlatformAuditLog } from '@models/platform/audit-log.model';
import { StaffProfile } from '@models/platform/operations-accounts.model';
import { AccountSession } from '@models/platform/session.model';
import { User } from '@models/users/user.model';
import { acceptAccountInvitation } from '@services/account-invitation.service';
import { revokeAccountSessions } from '@services/account-session.service';
import { nextPublicId } from '@services/public-id.service';

dotenv.config({ quiet: true });

function digest(value: string) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

async function run() {
  const database = process.env.MONGODB_DB_NAME || '';
  if (!database.startsWith('hook_phase2_test_')) {
    throw new Error('MONGODB_DB_NAME must start with hook_phase2_test_');
  }
  await connectDatabase();
  try {
    const ids = await Promise.all(Array.from({ length: 25 }, () => nextPublicId('audit')));
    assert.equal(new Set(ids).size, ids.length, 'concurrent public IDs must be unique');
    assert.ok(ids.every((id) => /^AUD-\d{4}-\d{6}$/.test(id)), 'public ID format must be stable');

    const publicId = await nextPublicId('staff');
    const account = await User.create({
      publicId,
      accountType: AccountType.STAFF,
      accountStatus: AccountStatus.INVITED,
      email: 'phase2-invited@hook.test',
      phone: '+2348000000000',
      firstName: 'Phase',
      lastName: 'Two',
      role: UserRole.SUPPORT,
      scopeType: ScopeType.GLOBAL,
      isActive: true,
      isEmailVerified: false,
      isPhoneVerified: false,
    });
    await StaffProfile.create({
      publicId,
      accountId: account.id,
      roleIds: [],
      scopeType: ScopeType.GLOBAL,
      stateIds: [],
      hubIds: [],
      status: AccountStatus.INVITED,
    });
    const invitationToken = crypto.randomBytes(32).toString('base64url');
    await AccountInvitation.create({
      accountId: account.id,
      accountType: AccountType.STAFF,
      email: account.email,
      tokenHash: digest(invitationToken),
      expiresAt: new Date(Date.now() + 60_000),
      invitedBy: 'integration-test',
    });
    await acceptAccountInvitation(invitationToken, 'SecurePhase2Password!');
    const activated = await User.findById(account.id).select('+password').lean();
    const profile = await StaffProfile.findOne({ accountId: account.id }).lean();
    assert.equal(activated?.accountStatus, AccountStatus.ACTIVE);
    assert.equal(activated?.isEmailVerified, true);
    assert.equal(profile?.status, AccountStatus.ACTIVE);
    assert.ok(activated?.password && await comparePassword('SecurePhase2Password!', activated.password));
    await assert.rejects(
      () => acceptAccountInvitation(invitationToken, 'AnotherSecurePassword!'),
      /invalid or has expired/i,
      'an invitation must be single use',
    );

    await AccountSession.create({
      accountId: account.id,
      accountType: AccountType.STAFF,
      familyId: crypto.randomUUID(),
      refreshTokenHash: digest('phase-2-refresh-token'),
      expiresAt: new Date(Date.now() + 60_000),
      lastUsedAt: new Date(),
    });
    await revokeAccountSessions(account.id, 'integration_test', 'integration-test');
    assert.equal(await AccountSession.countDocuments({ accountId: account.id, revokedAt: { $exists: false } }), 0);

    const audit = await PlatformAuditLog.create({
      publicId: ids[0],
      actorType: 'system',
      actorId: 'integration-test',
      action: 'phase_02.integration',
      entityType: 'platform',
      requestId: crypto.randomUUID(),
    });
    await assert.rejects(
      () => PlatformAuditLog.updateOne({ _id: audit._id }, { $set: { action: 'tampered' } }),
      /append-only/i,
      'audit records must be immutable',
    );

    console.log(JSON.stringify({
      database,
      concurrentPublicIds: ids.length,
      invitationActivation: true,
      sessionRevocation: true,
      appendOnlyAudit: true,
    }, null, 2));
  } finally {
    await (await import('mongoose')).default.connection.dropDatabase();
    await disconnectDatabase();
  }
}

run().catch(async (error) => {
  console.error(error);
  await disconnectDatabase().catch(() => undefined);
  process.exit(1);
});
