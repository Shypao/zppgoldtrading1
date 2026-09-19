import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('live pricing and buying sync avoid five-second polling', async () => {
  const source = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');

  assert.match(source, /const LIVE_SYNC_INTERVAL_MS = 5 \* 60 \* 1000;/);
  assert.match(source, /\}, LIVE_SYNC_INTERVAL_MS\);/);
  assert.match(source, /currentTab === 'rates' \|\| currentTab === 'buying'/);
  assert.match(source, /Update automatically every 5 minutes/);
  assert.doesNotMatch(source, /Automatic 5-second internet update/);
});
