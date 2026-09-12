import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createReleaseRefresh } from '../../Hook-App/lib/release-refresh';

test('publish events during a request trigger a follow-up instead of being lost', async () => {
  let finish: (() => void) | undefined;
  let calls = 0;
  const scheduler = createReleaseRefresh(async () => { calls++; if (calls === 1) await new Promise<void>((resolve) => { finish = resolve; }); });
  const first = scheduler.check(true);
  const publish = scheduler.check(true);
  scheduler.check(true);
  finish!();
  await Promise.all([first, publish]);
  assert.equal(calls, 2);
});
test('foreground and reconnect force fresh policy even within the normal throttle', async () => {
  let calls = 0;
  const scheduler = createReleaseRefresh(async () => { calls++; }, () => 1000);
  await scheduler.check(true);
  await scheduler.check();
  assert.equal(calls, 1);
  await scheduler.check(true);
  assert.equal(calls, 2);
  scheduler.stop();
  await scheduler.check(true);
  assert.equal(calls, 2);
});
