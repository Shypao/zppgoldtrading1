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

test('58 mm receipts keep all text inside the VOZY P50 print-head boundary', async () => {
  const source = await readFile(appPath, 'utf8');

  assert.match(source, /const receiptWidth = paperWidth === 80 \? 72 : 48;/);
  assert.match(source, /const paperPadding = paperWidth === 80 \? 2 : 1;/);
  assert.match(
    source,
    /@page\{size:\$\{paperWidth\}mm \$\{receiptHeight\}mm;margin:0\}/,
    'the receipt page should use the full selected roll width and measured content height',
  );
  assert.match(
    source,
    /width:\$\{receiptWidth\}mm;[^}]*padding:\$\{paperPadding\}mm!important/,
    'the 58 mm profile should leave a 2 mm guard inside the 48 mm print head',
  );
  assert.match(
    source,
    /width:\$\{receiptWidth\}mm;[^}]*margin:0 auto!important/,
    'the printable receipt block should be centered on the paper roll',
  );
  assert.match(source, /\.receipt-items\{[^}]*font-size:\$\{paperWidth\s*===\s*80\s*\?\s*10\s*:\s*9\}px/);
  assert.match(source, /\.receipt-total\{[^}]*font-size:\$\{paperWidth\s*===\s*80\s*\?\s*14\s*:\s*13\}px/);
});

test('thermal receipt includes the complete POS structure', async () => {
  const source = await readFile(appPath, 'utf8');

  assert.match(source, /Transaction No\.:/);
  assert.match(source, /class="receipt-items"/);
  assert.match(source, /ITEM \/ DESCRIPTION/);
  assert.match(source, /class="receipt-item-detail">\$\{esc\(item\.itemType\)\}/);
  assert.match(source, /Rate: PHP \$\{receiptMoneyNumber\(item\.rate\)\}\/g/);
  assert.match(source, /<span>PAID:<\/span>/);
  assert.doesNotMatch(source, /<span>CHANGE:<\/span>/);
  assert.match(source, /<span>METHOD:<\/span>/);
  assert.match(source, /Thank you!/);
});

test('every printed receipt line uses larger heavy thermal typography', async () => {
  const source = await readFile(appPath, 'utf8');

  assert.match(source, /body\{font-family:"Courier New",Courier,monospace;font-size:\$\{paperWidth\s*===\s*80\s*\?\s*11\.5\s*:\s*10\.5\}px;font-weight:900;/);
  assert.match(source, /-webkit-text-stroke:\.24px #000/);
  assert.match(source, /\.thermal-receipt,\.thermal-receipt \*\{font-weight:900\}/);
  assert.match(source, /\.receipt-address\{[^}]*font-size:\$\{paperWidth\s*===\s*80\s*\?\s*10\.5\s*:\s*9\.5\}px/);
  assert.match(source, /\.receipt-items\{[^}]*font-size:\$\{paperWidth\s*===\s*80\s*\?\s*10\s*:\s*9\}px/);
  assert.match(source, /\.receipt-item-rate\{[^}]*font-size:\$\{paperWidth\s*===\s*80\s*\?\s*9\s*:\s*8\}px;font-weight:900/);
  assert.match(source, /\.receipt-quote\{[^}]*font-size:\$\{paperWidth\s*===\s*80\s*\?\s*9\s*:\s*8\}px;font-style:italic/);
});
