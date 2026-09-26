import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('pricing updates only through the manual refresh action', async () => {
  const source = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');

  assert.doesNotMatch(source, /LIVE_SYNC_INTERVAL_MS/);
  assert.doesNotMatch(source, /startAutomaticPricing/);
  assert.doesNotMatch(source, /Update automatically every hour/);
  assert.doesNotMatch(source, /refreshPhilippineRates\(true\)/);
  assert.match(source, /Refresh &amp; apply now/);
  assert.doesNotMatch(source, /Automatic 5-second internet update/);
});

test('daily rate setup has no separate rate-sheet save action', async () => {
  const source = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');

  assert.doesNotMatch(source, /Save today's rate sheet/);
  assert.doesNotMatch(source, /Save rate sheet/);
  assert.doesNotMatch(source, /savePricingSnapshot/);
});

test('buying draft loads only after the Buying page is opened', async () => {
  const source = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const loadDatabase = source.match(/async function loadDB\(\) \{([\s\S]*?)\n\}\nfunction isAdmin/)?.[1] || '';
  const switchTab = source.match(/function goTab\(id\) \{([\s\S]*?)\n\}\nfunction render/)?.[1] || '';

  assert.doesNotMatch(loadDatabase, /loadBuyingDraft\(\)/);
  assert.match(switchTab, /if \(id === 'buying'\) \{\s*syncCashflow\(\);\s*loadBuyingDraft\(\);\s*\}/);
});
