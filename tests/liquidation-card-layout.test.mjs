import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const appPath = new URL('../public/app.js', import.meta.url);
const indexPath = new URL('../public/index.html', import.meta.url);

test('open liquidation cards show the compact purity summary from the classic layout', async () => {
  const [app, index] = await Promise.all([
    readFile(appPath, 'utf8'),
    readFile(indexPath, 'utf8'),
  ]);

  assert.match(app, /function toggleLiquidationBatchMinimized\(id\)/);
  assert.match(app, /const minimized = !expandedLiquidationBatches\.has\(batch\.id\)/);
  assert.match(app, /liquidation-batch-grade/);
  assert.match(app, /liquidation-batch-compact-summary/);
  assert.match(app, /Totals per karat \/ purity/);
  assert.match(app, />\$\{minimized \? 'Expand' : 'Minimize'\}<\/button>/);
  assert.match(index, /\.liquidation-batch-karat-totals/);
  assert.match(index, /\.liquidation-batch-card\.is-minimized/);
});

test('open liquidation batch summaries use the full card width without excess empty space', async () => {
  const stylesheet = await readFile(indexPath, 'utf8');

  assert.match(stylesheet, /\.liquidation-batch-card\{[^}]*padding:16px 18px 18px/);
  assert.match(stylesheet, /\.liquidation-batch-karat-totals>\.table-wrap\{width:100%;max-width:none/);
  assert.match(stylesheet, /\.liquidation-batch-compact-summary\{display:grid;grid-template-columns:repeat\(3,minmax\(0,1fr\)/);
});
