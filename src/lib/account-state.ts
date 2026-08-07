import { AccountStatus } from '@lib/constants';

/**
 * Legacy records created before accountStatus was introduced may omit the
 * field. Their existing isActive flag is the compatibility source of truth;
 * explicit non-active statuses always win.
 */
export function isActiveAccount(account: {
  isActive?: boolean;
  accountStatus?: AccountStatus | string;
}) {
  return account.isActive === true && (
    account.accountStatus === undefined ||
    account.accountStatus === null ||
    account.accountStatus === AccountStatus.ACTIVE
  );
}

export function isActiveStaffProfile(profile: {
  status?: string;
}) {
  return profile.status === undefined || profile.status === 'active';
}
