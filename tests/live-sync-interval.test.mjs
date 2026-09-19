import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('live pricing refreshes hourly without idle cashflow polling', async () => {
  const source = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');

  assert.match(source, /const LIVE_SYNC_INTERVAL_MS = 60 \* 60 \* 1000;/);
  assert.match(source, /\}, LIVE_SYNC_INTERVAL_MS\);/);
  assert.match(source, /currentTab === 'rates' \|\| currentTab === 'buying'/);
  assert.match(source, /Update automatically every hour/);
  const automaticTimer = source.match(/automaticPricingTimer = setInterval\(\(\) => \{([\s\S]*?)\}, LIVE_SYNC_INTERVAL_MS\);/)?.[1] || '';
  assert.doesNotMatch(automaticTimer, /syncCashflow\(\)/);
  assert.doesNotMatch(source, /Automatic 5-second internet update/);
});

test('buying draft loads only after the Buying page is opened', async () => {
  const source = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const loadDatabase = source.match(/async function loadDB\(\) \{([\s\S]*?)\n\}\nfunction isAdmin/)?.[1] || '';
  const switchTab = source.match(/function goTab\(id\) \{([\s\S]*?)\n\}\nfunction render/)?.[1] || '';

  assert.doesNotMatch(loadDatabase, /loadBuyingDraft\(\)/);
  assert.match(switchTab, /if \(id === 'buying'\) \{\s*syncCashflow\(\);\s*loadBuyingDraft\(\);\s*\}/);
});
