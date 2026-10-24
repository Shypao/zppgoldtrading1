import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

// Minimal form controls with native select semantics: assigning an absent
// option clears the selection without replacing the available options.
function mountBuyingForm(html, elements) {
  elements.clear();
  for (const [, id, optionsHtml] of html.matchAll(/<select id="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g)) {
    const options = [...optionsHtml.matchAll(/<option([^>]*)>([^<]*)<\/option>/g)].map(([, attributes, label]) => ({
      value: attributes.match(/value="([^"]*)"/)?.[1] ?? label,
      selected: /\bselected\b/.test(attributes)
    }));
    let value = (options.find(option => option.selected) || options[0])?.value || '';
    elements.set(id, {
      options,
      get value() { return value; },
      set value(next) { value = options.some(option => option.value === next) ? next : ''; }
    });
  }
  for (const [, id, attributes] of html.matchAll(/<input id="([^"]+)"([^>]*)>/g)) {
    elements.set(id, { type: attributes.match(/type="([^"]*)"/)?.[1], value: attributes.match(/value="([^"]*)"/)?.[1] || '' });
  }
}

for (const metal of ['Silver', 'Platinum']) {
  test(`completing a ${metal} purchase resets to Gold karats without waiting for draft cleanup`, async () => {
    const source = (await readFile(new URL('../public/app.js', import.meta.url), 'utf8')).replace(/initializeAuth\(\);\s*$/, '');
    const elements = new Map();
    let finishCleanup;
    const cleanup = new Promise(resolve => { finishCleanup = resolve; });
    const context = vm.createContext({
      console, clearTimeout() {},
      document: { getElementById: id => elements.get(id) || null },
      mount: html => mountBuyingForm(html, elements),
      fetch: () => cleanup
    });
    vm.runInContext(`${source}\nseedEmptyLedger(); ensureShape(); currentUser={role:'admin',displayName:'Admin'};
      buyingDraftForm={b_metal:'${metal}',b_karat:'999',b_rate:'100',b_date:todayStr(),b_pay:'Cash',b_status:'Available'};
      purchaseBatch=[{id:'line-1',metal:'${metal}',karat:'999',itemType:'Scrap',netWeight:1,currentWeight:1,rate:100,payout:100}];
      render=()=>mount(renderBuying()); saveDB=async()=>true; syncCashflow=async()=>{}; toast=()=>{};
      render(); globalThis.commit=commitPurchaseBatch; globalThis.today=todayStr;`, context);
    assert.equal(elements.get('b_metal').value, metal);
    let completed = false;
    const commit = context.commit(false).then(() => { completed = true; });
    try {
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(completed, true, 'draft deletion must not block the next purchase');
      assert.equal(elements.get('b_metal').value, 'Gold');
      assert.equal(elements.get('b_karat').value, '24K');
      assert.ok(elements.get('b_karat').options.some(option => option.value === '18K'));
      assert.ok(!elements.get('b_karat').options.some(option => option.value === '925'));
      assert.equal(elements.get('b_rate').value, '8500');
      assert.equal(elements.get('b_date').value, context.today());
    } finally {
      finishCleanup({ ok: true });
      await commit;
    }
  });
}
