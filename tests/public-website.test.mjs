import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const html = fs.readFileSync(path.join(root, 'public', 'website.html'), 'utf8');

test('public website includes essential business information and accessible actions', () => {
  assert.match(html, /ZPP Gold Trading/i);
  assert.match(html, /Barcelona Street/i);
  assert.match(html, /Zamboanga City/i);
  assert.match(html, /10:30 AM\s*[–-]\s*6:00 PM/i);
  assert.doesNotMatch(html, /store-location\.png/i);
  assert.match(html, /zpp-logo\.png/i);
  assert.doesNotMatch(html, /<span class="brand-mark">Z<\/span>/i);
  assert.doesNotMatch(html, /価/);
  assert.match(html, /google\.com\/maps\?q=Barcelona\+Street\+Zamboanga\+City&output=embed/i);
  assert.match(html, /title="Google Maps location of ZPP Gold Trading"/i);
  assert.match(html, /href="https:\/\/www\.facebook\.com\/parengzp/i);
  assert.match(html, /name="viewport"/i);
  assert.doesNotMatch(html, /login-screen/i);
});
