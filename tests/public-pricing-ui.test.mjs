import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const source = fs.readFileSync(path.join(root, 'public', 'app.ts'), 'utf8');

test('admin daily-rate view exposes a dedicated public-rate editor button', () => {
  assert.match(source, /openPublicDailyRatesEditor\(\)/);
  assert.match(source, /Edit public daily rates/);
});

test('public-rate editor does not offer internal-rate fallback controls', () => {
  const editor = source.slice(source.indexOf('function openPublicDailyRatesEditor'), source.indexOf('let staffRateEditingToggleBusy'));
  assert.doesNotMatch(editor, /Use internal rates/);
  assert.doesNotMatch(editor, /resetPublicDailyRates/);
  assert.match(editor, /publicDailyRateValue\(metal,grade\.key\)/);
});

test('public-rate editor accepts blank values when no public sheet exists', () => {
  const editor = source.slice(source.indexOf('function openPublicDailyRatesEditor'), source.indexOf('let staffRateEditingToggleBusy'));
  assert.match(source, /return Number\.isFinite\(saved\)&&saved>0 \? roundPeso\(saved\) : ''/);
  assert.doesNotMatch(editor, /metalRate\(metal, key\)/);
});
