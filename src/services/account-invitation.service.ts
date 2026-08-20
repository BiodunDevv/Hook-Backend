import crypto from 'crypto';
import { AccountStatus, AccountType } from '@lib/constants';
import { hashPassword } from '@lib/security';
import { AccountInvitation } from '@models/platform/account-invitation.model';
import { HookPartner, RunnerProfile, StaffProfile } from '@models/platform/operations-accounts.model';
import { User } from '@models/users/user.model';
import { HttpError } from '@utils/http';
import { EmailService } from '@emails/email.service';
import { PlatformAuditLog } from '@models/platform/audit-log.model';
import { nextPublicId } from './public-id.service';

const email = new EmailService();
const invitationTtlHours = Number(process.env.ACCOUNT_INVITATION_TTL_HOURS || 48);

function tokenDigest(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function activationPath(accountType: AccountType) {
  if (accountType === AccountType.RUNNER) return '/runner/activate';
  if (accountType === AccountType.PARTNER) return '/partner/activate';
  if (accountType === AccountType.CUSTOMER) return '/customer/activate';
  return '/activate';
}

export async function issueAccountInvitation(input: {
  accountId: string;
  accountType: AccountType;
  email: string;
  name: string;
  invitedBy: string;
}) {
  await AccountInvitation.updateMany(
    { accountId: input.accountId, acceptedAt: { $exists: false }, revokedAt: { $exists: false } },
    { $set: { revokedAt: new Date() } },
  );
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + invitationTtlHours * 60 * 60 * 1000);
  await AccountInvitation.create({
    accountId: input.accountId,
    accountType: input.accountType,
    email: input.email,
    tokenHash: tokenDigest(token),
    expiresAt,
    invitedBy: input.invitedBy,
  });
  const baseUrl = (process.env.ADMIN_APP_URL || 'http://localhost:3000').replace(/\/$/, '');
  const activationUrl = `${baseUrl}${activationPath(input.accountType)}?token=${encodeURIComponent(token)}`;
  const delivery = await email.sendAccountInvitation({
    email: input.email,
    name: input.name,
    accountType: input.accountType,
    activationUrl,
    expiresInHours: invitationTtlHours,
  }).catch((error) => {
    console.error(`[account-invitation] Delivery failed for account ${input.accountId}`, error);
    return { delivered: false, provider: 'error' };
  });
  return { expiresAt, delivery };
}

/**
 * Customer variant of issueAccountInvitation: same token/expiry mechanics,
 * but the email needs Partner/Market context a generic staff invitation
 * doesn't carry, so it uses its own template rather than sendAccountInvitation.
 */
export async function issueCustomerAccountSetup(input: {
  accountId: string;
  email: string;
  name: string;
  partnerName: string;
}) {
  await AccountInvitation.updateMany(
    { accountId: input.accountId, acceptedAt: { $exists: false }, revokedAt: { $exists: false } },
    { $set: { revokedAt: new Date() } },
  );
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + invitationTtlHours * 60 * 60 * 1000);
  await AccountInvitation.create({
    accountId: input.accountId,
    accountType: AccountType.CUSTOMER,
    email: input.email,
    tokenHash: tokenDigest(token),
    expiresAt,
    invitedBy: input.accountId,
  });
  const baseUrl = (process.env.ADMIN_APP_URL || 'http://localhost:3000').replace(/\/$/, '');
  const activationUrl = `${baseUrl}${activationPath(AccountType.CUSTOMER)}?token=${encodeURIComponent(token)}`;
  const delivery = await email.sendCustomerAccountSetup({
    email: input.email,
    name: input.name,
    partnerName: input.partnerName,
    activationUrl,
    expiresInHours: invitationTtlHours,
  }).catch((error) => {
    console.error(`[account-invitation] Customer setup email failed for account ${input.accountId}`, error);
    return { delivered: false, provider: 'error' };
  });
  return { expiresAt, delivery };
}

export async function revokeAccountInvitations(accountId: string) {
  const result = await AccountInvitation.updateMany(
    {
      accountId,
      acceptedAt: { $exists: false },
      revokedAt: { $exists: false },
    },
    { $set: { revokedAt: new Date() } },
  );
  return result.modifiedCount;
}

export async function acceptAccountInvitation(
  token: string,
  password: string,
  context?: { requestId?: string; ipAddress?: string; userAgent?: string },
) {
  const invitation = await AccountInvitation.findOne({
    tokenHash: tokenDigest(token),
    acceptedAt: { $exists: false },
    revokedAt: { $exists: false },
    expiresAt: { $gt: new Date() },
  });
  if (!invitation) {
    throw new HttpError(400, 'Invitation is invalid or has expired', undefined, 'TOKEN_INVALID');
  }
  const account = await User.findById(invitation.accountId);
  if (!account || !account.isActive) {
    throw new HttpError(409, 'Account cannot be activated', undefined, 'INVALID_STATE_TRANSITION');
  }
  /**
   * Staff/Runner/Partner invitees start life as INVITED. Customers created at
   * a Partner's counter start PENDING_PASSWORD instead (they already have a
   * usable account, they just need a password) — both are valid pre-activation
   * states for this endpoint, anything else means the account already moved on.
   */
  const acceptableStatus: AccountStatus[] =
    invitation.accountType === AccountType.CUSTOMER
      ? [AccountStatus.PENDING_PASSWORD, AccountStatus.INVITED]
      : [AccountStatus.INVITED];
  if (!acceptableStatus.includes(account.accountStatus ?? AccountStatus.ACTIVE)) {
    throw new HttpError(409, 'Account cannot be activated', undefined, 'INVALID_STATE_TRANSITION');
  }

  const acceptedAt = new Date();
  account.password = await hashPassword(password);
  account.passwordChangedAt = acceptedAt;
  account.isEmailVerified = true;
  account.accountStatus = AccountStatus.ACTIVE;
  await account.save();
  await AccountInvitation.updateOne({ _id: invitation._id }, { $set: { acceptedAt } });

  const profileUpdate = { $set: { status: AccountStatus.ACTIVE } };
  if (invitation.accountType === AccountType.STAFF) {
    await StaffProfile.updateOne({ accountId: account.id }, profileUpdate);
  } else if (invitation.accountType === AccountType.RUNNER) {
    await RunnerProfile.updateOne({ accountId: account.id }, profileUpdate);
  } else if (invitation.accountType === AccountType.PARTNER) {
    await HookPartner.updateOne({ accountId: account.id }, profileUpdate);
  }
  await PlatformAuditLog.create({
    publicId: await nextPublicId('audit'),
    actorType: invitation.accountType,
    actorId: account.id,
    actorPublicId: account.publicId,
    action: 'account.invitation_accepted',
    entityType: invitation.accountType,
    entityId: account.id,
    entityPublicId: account.publicId,
    requestId: context?.requestId || 'invitation-activation',
    ipAddress: context?.ipAddress,
    userAgent: context?.userAgent,
  });
  return { activated: true, accountType: invitation.accountType };
}
