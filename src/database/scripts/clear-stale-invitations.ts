import { connectDatabase, disconnectDatabase } from '@config/data-source';
import { findStaleInvitations, purgeUnacceptedAccount } from '@services/stale-invitation.service';

const execute = process.argv.includes('--execute');

/**
 * Removes accounts that were invited but never accepted and are now dead: a user with no profile (a failed create) or
 * one whose invitation was cancelled. Their emails become free to invite again. Pending invitations still waiting on
 * a reply are left alone.
 */
async function main() {
  await connectDatabase();
  const stale = await findStaleInvitations();
  console.log(`${execute ? 'Removing' : 'Would remove'} ${stale.length} unaccepted account(s):`);
  for (const item of stale) console.log(`  ${item.kind}  ${item.email}  (${item.reason})`);
  if (!execute) return console.log('\nNo data changed. Run with --execute to apply.');
  let removed = 0;
  for (const item of stale) if (await purgeUnacceptedAccount(item.userId)) removed += 1;
  console.log(`\nRemoved ${removed}.`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => disconnectDatabase());
