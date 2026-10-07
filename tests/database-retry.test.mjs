import assert from 'node:assert/strict';
import test from 'node:test';

test('transient database failures are retried before giving up', async () => {
  const { withTransientDatabaseRetry } = await import('../src/server.ts');
  let attempts = 0;
  const value = await withTransientDatabaseRetry(async () => {
    attempts += 1;
    if (attempts < 3) throw new Error('fetch failed');
    return 'saved';
  }, 3, 0);

  assert.equal(value, 'saved');
  assert.equal(attempts, 3);
});
