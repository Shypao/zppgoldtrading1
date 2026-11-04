import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const indexPath = new URL('../public/index.html', import.meta.url);
const appPath = new URL('../public/app.js', import.meta.url);

async function androidReceiptHarness({ paperWidth = 58, blocked = false } = {}) {
  const source = await readFile(appPath, 'utf8');
  const receiptCode = source.slice(source.indexOf('function receiptWeightNumber('), source.indexOf('/* ============================= INVENTORY'));
  const calls = [];
  let html = '', releaseFonts;
  const fontsReady = new Promise(resolve => { releaseFonts = resolve; });
  const printWindow = {
    closed: false,
    document: {
      fonts: { ready: fontsReady },
      open() { calls.push('open-document'); },
      write(value) { html = value; calls.push('write'); },
      close() { calls.push('close-document'); }
    },
    setTimeout(callback) { calls.push('layout-ready'); callback(); },
    focus() { calls.push('focus'); },
    print() { calls.push('print'); }
  };
  const context = vm.createContext({
    navigator: { userAgent: 'Mozilla/5.0 (Linux; Android 14; POCO Pad) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36' },
    window: { open() { calls.push('open-window'); return blocked ? null : printWindow; }, print() { throw new Error('Android must not print the dashboard document'); } },
    document: { getElementById() { return null; } },
    db: { stock: [{ id: 'receipt-1', batchId: 'buy-1', metal: 'Gold', karat: '18K', itemType: 'Scrap', date: '2026-11-04', customerName: '<script>unsafe</script>', staff: 'Staff', netWeight: 1.5, rate: 6000, payout: 9000, paymentMethod: 'Cash' }] },
    val: () => String(paperWidth), roundMoney: value => value, fmtDate: value => value,
    gradeLabel: (_metal, grade) => grade,
    esc: value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
    toast: message => calls.push(message)
  });
  vm.runInContext(receiptCode + '\n globalThis.startPrint = () => printPurchaseReceipt("buy-1");', context);
  return { start: () => context.startPrint(), releaseFonts: () => releaseFonts(), calls, html: () => html };
}

test('Android printing opens a receipt-only document and waits for fonts and layout', async () => {
  for (const paperWidth of [58, 80]) {
    const harness = await androidReceiptHarness({ paperWidth });
    const completion = harness.start();
    assert.deepEqual(harness.calls, ['open-window', 'open-document', 'write', 'close-document']);
    const html = harness.html();
    assert.match(html, new RegExp(`@page\\{size:${paperWidth}mm \\d+mm;margin:0\\}`));
    assert.match(html, new RegExp(`html,body\\{width:${paperWidth}mm;`));
    assert.match(html, /<meta name="viewport" content="width=\d+,initial-scale=1">/);
    assert.match(html, /Gold 18K|9,000/);
    assert.match(html, /&lt;script&gt;unsafe&lt;\/script&gt;/);
    assert.doesNotMatch(html, /Buying receipt|receipt-preview-controls|appShell|<script>/);
    assert.match(html, /<button type="button" onclick="window.print\(\)">Print receipt<\/button>/);
    assert.match(html, /@media print\{\.receipt-print-tools\{display:none!important\}\}/);
    assert.match(html, /Share → Print\. Select Xprinter/);
    harness.releaseFonts();
    await completion;
    assert.deepEqual(harness.calls.slice(-3), ['layout-ready', 'focus', 'print']);
  }
});

test('Android blocked pop-up shows recovery instructions without printing the dashboard', async () => {
  const harness = await androidReceiptHarness({ blocked: true });
  harness.start();
  assert.equal(harness.html(), '');
  assert.match(harness.calls[1], /Allow pop-ups/);
  assert.ok(!harness.calls.includes('print'));
});

test('thermal receipt width includes its padding so printed totals are not clipped', async () => {
  const source = await readFile(indexPath, 'utf8');

  assert.match(
    source,
    /\.thermal-receipt\{[^}]*box-sizing:border-box;[^}]*width:58mm;[^}]*padding:5mm;/,
    'receipt padding must remain inside the selected thermal paper width',
  );
  assert.match(
    source,
    /body\.printing-thermal-receipt \.thermal-receipt,[\s\S]*?width:100%;[^}]*padding:1mm;/,
    'print layout should fill only the printable page area',
  );
});

test('58 mm receipts use the proven centered VOZY P50 main-page print path', async () => {
  const source = await readFile(appPath, 'utf8');

  assert.match(source, /const receiptWidth = paperWidth === 80 \? 72 : 46;/);
  assert.match(source, /const paperPadding = paperWidth === 80 \? 2 : 2;/);
  assert.match(
    source,
    /@page\{size:\$\{paperWidth\}mm auto;margin:0\}/,
    'the main print page should use the selected continuous thermal roll width',
  );
  assert.match(
    source,
    /width:\$\{receiptWidth\}mm;max-width:\$\{receiptWidth\}mm;[^}]*margin:0!important;[^}]*padding:\$\{paperPadding\}mm!important/,
    'the 46 mm print block should rely on the VOZY driver alignment without a duplicate CSS offset',
  );
  assert.match(source, /document\.body\.classList\.add\('printing-thermal-receipt'\)/);
  assert.match(source, /window\.print\(\)/);
  assert.doesNotMatch(source, /window\.open\('',\s*'zpp_thermal_receipt'/);
  assert.match(source, /\.receipt-items\{[^}]*font-size:\$\{paperWidth\s*===\s*80\s*\?\s*10\s*:\s*9\}px/);
  assert.match(source, /\.receipt-total\{[^}]*font-size:\$\{paperWidth\s*===\s*80\s*\?\s*14\s*:\s*13\}px/);
});

test('thermal receipt includes the complete POS structure', async () => {
  const source = await readFile(appPath, 'utf8');

  assert.match(source, /Transaction No\.:/);
  assert.match(source, /class="receipt-items"/);
  assert.match(source, /<th>ITEM<\/th><th>WT<\/th><th>AMT<\/th>/);
  assert.doesNotMatch(source, /receipt-(?:col-)?qty|<th>QTY<\/th>/);
  assert.match(source, /\.receipt-items th\{[^}]*font-size:\$\{paperWidth\s*===\s*80\s*\?\s*10\s*:\s*9\.5\}px[^}]*white-space:nowrap/);
  assert.match(source, /class="receipt-item-detail">\$\{esc\(item\.itemType\)\}/);
  assert.match(source, /Rate: PHP \$\{receiptMoneyNumber\(item\.rate\)\}\/g/);
  assert.match(source, /<span>PAID:<\/span>/);
  assert.doesNotMatch(source, /<span>CHANGE:<\/span>/);
  assert.match(source, /<span>METHOD:<\/span>/);
  assert.match(source, /Thank you!/);
});

test('every printed receipt line uses larger heavy thermal typography', async () => {
  const source = await readFile(appPath, 'utf8');

  assert.match(source, /body\{font-family:Arial,Helvetica,sans-serif;font-size:\$\{paperWidth\s*===\s*80\s*\?\s*11\.5\s*:\s*10\.5\}px;font-weight:900;/);
  assert.match(source, /font-synthesis:weight;text-rendering:optimizeLegibility/);
  assert.match(source, /-webkit-text-stroke:\.24px #000/);
  assert.match(source, /\.thermal-receipt,\.thermal-receipt \*\{font-weight:900\}/);
  assert.match(source, /\.receipt-address\{[^}]*font-size:\$\{paperWidth\s*===\s*80\s*\?\s*10\.5\s*:\s*9\.5\}px/);
  assert.match(source, /\.receipt-items\{[^}]*font-size:\$\{paperWidth\s*===\s*80\s*\?\s*10\s*:\s*9\}px/);
  assert.match(source, /\.receipt-item-title,\.receipt-weight,\.receipt-amount\{[^}]*font-size:\$\{paperWidth\s*===\s*80\s*\?\s*11\s*:\s*10\}px;font-weight:900;[^}]*-webkit-text-stroke:\.16px #000/);
  assert.match(source, /\.receipt-item-rate\{[^}]*font-size:\$\{paperWidth\s*===\s*80\s*\?\s*10\s*:\s*9\}px;font-weight:900;[^}]*-webkit-text-stroke:\.12px #000/);
  assert.match(source, /\.receipt-quote\{[^}]*font-size:\$\{paperWidth\s*===\s*80\s*\?\s*9\s*:\s*8\}px;font-style:italic/);
});
