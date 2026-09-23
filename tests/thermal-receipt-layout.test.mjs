import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const indexPath = new URL('../public/index.html', import.meta.url);
const appPath = new URL('../public/app.js', import.meta.url);

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
  assert.match(source, /<th>ITEM<\/th><th>QTY<\/th><th>WT \(g\)<\/th><th>AMOUNT<\/th>/);
  assert.doesNotMatch(source, /ITEM \/<br>DESCRIPTION/);
  assert.match(source, /class="receipt-item-detail">\$\{esc\(item\.itemType\)\}/);
  assert.doesNotMatch(source, /Rate: PHP \$\{receiptMoneyNumber\(item\.rate\)\}\/g/);
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
  assert.match(source, /\.receipt-item-title,\.receipt-qty,\.receipt-weight,\.receipt-amount\{[^}]*font-size:\$\{paperWidth\s*===\s*80\s*\?\s*11\s*:\s*10\}px;font-weight:900;[^}]*-webkit-text-stroke:\.16px #000/);
  assert.match(source, /\.receipt-quote\{[^}]*font-size:\$\{paperWidth\s*===\s*80\s*\?\s*9\s*:\s*8\}px;font-style:italic/);
});
