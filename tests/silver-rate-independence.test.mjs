import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

async function loadSilverRates({ legacy = false, override925 } = {}) {
  const source = (await readFile(new URL('../public/app.js', import.meta.url), 'utf8')).replace(/initializeAuth\(\);\s*$/, '');
  let modal;
  const context = vm.createContext({
    console,
    document: {
      getElementById() { return null; },
      createElement() { return { innerHTML: '', addEventListener() {} }; },
      body: { appendChild(element) { modal = element; } }
    }
  });
  vm.runInContext(`${source}\nseedEmptyLedger(); ensureShape(); currentUser={role:'admin'};
    ${legacy ? 'delete db.pricing.dailyFormula.baseRates.Silver925;' : ''}
    ${override925 ? `db.pricing.silver.overrides['925']=${override925};` : ''}
    savePricingDB=async()=>true; render=()=>{}; toast=()=>{};
    globalThis.rates=()=>['999','925','900','800','750','600'].map(key=>metalRate('Silver',key));
    globalThis.change999=value=>setBase('Silver',value);
    globalThis.change925=setSilver925Base; globalThis.openEditor=openDailyBaseEditor;`, context);
  context.modalHtml = () => modal?.innerHTML || '';
  return context;
}

test('changing Silver 999 preserves the 925 basis and automatic lower grades', async () => {
  const api = await loadSilverRates({ legacy: true });
  const before = Array.from(api.rates());
  await api.change999(200);
  assert.equal(api.rates()[0], 200);
  assert.deepEqual(Array.from(api.rates()).slice(1), before.slice(1));
});

test('changing the Silver 925 basis recalculates 900 and below while preserving 999', async () => {
  const api = await loadSilverRates();
  await api.change925(120);
  assert.deepEqual(Array.from(api.rates()), [105, 120, 117, 104, 97, 78]);
  await api.change999(200);
  assert.deepEqual(Array.from(api.rates()), [200, 120, 117, 104, 97, 78]);
});

test('a legacy Silver 925 override remains the lower-grade basis after editing 999', async () => {
  const api = await loadSilverRates({ legacy: true, override925: 90 });
  const before = Array.from(api.rates());
  await api.change999(150);
  assert.deepEqual(Array.from(api.rates()).slice(1), before.slice(1));
});

test('manual Silver editor opens with independent 999 and 925 inputs and no live-price controls', async () => {
  const api = await loadSilverRates();
  api.openEditor('Silver');
  const html = api.modalHtml();
  assert.match(html, /id="formula_base_rate"[^>]*value="105"/);
  assert.match(html, /id="formula_silver_925_rate"[^>]*value="95"/);
  assert.doesNotMatch(html, /Live PHP base rate|Use live PHP base/);
});
