import { AccountType } from '@lib/constants';
import { MarketAssociateMarketAssignment, MarketAssociateProfile, StaffProfile } from '@models/platform/operations-accounts.model';
import { User } from '@models/users/user.model';
import { revokeAccountInvitations } from '@services/account-invitation.service';

/**
 * An invited account that was never accepted has nothing worth keeping: no sign-in, no work, no history. Removing it
 * frees the email and phone for reuse and keeps it out of every list.
 */
export type StaleInvitation = { userId: string; email: string; kind: 'staff' | 'marketassociate'; reason: 'no-profile' | 'cancelled' | 'pending' };

const INVITED_TYPES = [AccountType.STAFF, AccountType.MARKETASSOCIATE];

/** True when the account never signed in and never set a password, so it is only an unfinished invitation. */
const neverUsed = (user: any) => !user.lastLoginAt && !user.password;

/** Deletes one unaccepted account and everything hanging off it. Returns false when it is not safe to remove. */
export async function purgeUnacceptedAccount(userId: string): Promise<boolean> {
  const user: any = await User.findById(userId).select('+password accountType lastLoginAt password accountStatus').lean();
  if (!user || !INVITED_TYPES.includes(user.accountType) || !neverUsed(user)) return false;
  const id = String(user._id);
  const marketAssociate = await MarketAssociateProfile.findOne({ accountId: id }).select('_id').lean();
  await revokeAccountInvitations(id).catch(() => undefined);
  await Promise.all([
    marketAssociate ? MarketAssociateMarketAssignment.deleteMany({ marketAssociateId: String((marketAssociate as any)._id) }) : Promise.resolve(),
    MarketAssociateProfile.deleteMany({ accountId: id }),
    StaffProfile.deleteMany({ accountId: id }),
    User.deleteOne({ _id: id }),
  ]);
  return true;
}

/** Called before creating an account: clears a leftover, unaccepted account that holds the same email or phone. */
export async function clearStaleInvitationFor(email?: string, phone?: string): Promise<void> {
  const or: Array<Record<string, string>> = [];
  if (email) or.push({ email: String(email).trim().toLowerCase() });
  if (phone) or.push({ phone: String(phone).trim() });
  if (!or.length) return;
  const found: any[] = await User.find({ $or: or, accountType: { $in: INVITED_TYPES } }).select('+password accountType lastLoginAt password accountStatus').lean();
  for (const user of found) {
    const pending = String(user.accountStatus).toLowerCase();
    // Only an account still waiting on its invitation, or one whose invitation was cancelled, may be cleared.
    if (['invited', 'disabled'].includes(pending) && neverUsed(user)) await purgeUnacceptedAccount(String(user._id));
  }
}

/** Every unaccepted account in the database, for the cleanup script. */
export async function findStaleInvitations(): Promise<StaleInvitation[]> {
  const users: any[] = await User.find({ accountType: { $in: INVITED_TYPES }, accountStatus: { $in: ['invited', 'disabled'] } } as any)
    .select('+password email accountType lastLoginAt password accountStatus').lean();
  const result: StaleInvitation[] = [];
  for (const user of users) {
    if (!neverUsed(user)) continue;
    const id = String(user._id);
    const [ma, staff] = await Promise.all([MarketAssociateProfile.findOne({ accountId: id }).select('status').lean(), StaffProfile.findOne({ accountId: id }).select('status').lean()]);
    const profile: any = ma || staff;
    const kind = user.accountType === AccountType.STAFF ? 'staff' : 'marketassociate';
    if (!profile) result.push({ userId: id, email: user.email, kind, reason: 'no-profile' });
    else if (String(profile.status).toLowerCase() === 'disabled') result.push({ userId: id, email: user.email, kind, reason: 'cancelled' });
  }
  return result;
}
