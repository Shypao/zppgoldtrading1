import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import test from 'node:test';
import { createPublicRatesBrowser } from './helpers/public-rates-browser.mjs';

const sheet = () => ({ effectiveDate: '2026-10-25', rates: {
  Gold: [{ key: '24K', label: '24K', rate: 7800 }, { key: '18K', label: '18K', rate: 5850 }],
  Silver: [{ key: '999', label: '999', rate: 90 }],
  Platinum: [{ key: '999', label: '999', rate: 2600 }]
} });
const response = data => ({ ok: true, json: async () => structuredClone(data) });

test('deployed public site fetches only the saved production public sheet, without caching or writes', async () => {
  const browser = await createPublicRatesBrowser(() => response(sheet()));
  assert.equal(browser.requests.length, 1);
  const { url, options } = browser.requests[0];
  assert.equal(url, 'https://zppgoldtrading.vercel.app/api/public-pricing');
  assert.equal(options.cache, 'no-store');
  assert.equal(options.method, undefined);
  assert.equal(options.body, undefined);
  assert.deepEqual(browser.table('Gold'), ['24K ₱7,800', '18K ₱5,850']);
  assert.deepEqual(browser.table('Silver'), ['999 ₱90']);
  assert.deepEqual(browser.table('Platinum'), ['999 ₱2,600']);
  assert.match(browser.elements['#rates-status'].textContent, /Published rates · Last saved/);
  assert.equal(browser.timeouts.size, 0);
});

test('saved prices stay fixed across checks and update only from a newly published sheet', async () => {
  let published = sheet();
  const browser = await createPublicRatesBrowser(() => response(published));
  const { elements } = browser;
  elements['#estimate-purity'].value = '18K';
  elements['#estimate-grams'].value = '2';
  await elements['#estimate-grams'].emit('input');
  assert.equal(elements['#estimate-total'].textContent, '₱11,700');
  await browser.refresh();
  assert.deepEqual(browser.table('Gold'), ['24K ₱7,800', '18K ₱5,850']);
  assert.equal(elements['#estimate-purity'].value, '18K');
  assert.equal(elements['#estimate-total'].textContent, '₱11,700');

  published.rates.Gold[1].rate = 6000;
  await browser.window.emit('focus');
  await browser.settle();
  assert.equal(elements['#estimate-purity'].value, '18K');
  assert.equal(elements['#estimate-grams'].value, '2');
  assert.equal(elements['#estimate-total'].textContent, '₱12,000');
  assert.deepEqual(browser.table('Gold'), ['24K ₱7,800', '18K ₱6,000']);
  assert.equal(browser.intervals[0].delay, 30000);
  browser.document.hidden = true;
  const count = browser.requests.length;
  browser.intervals[0].callback();
  assert.equal(browser.requests.length, count);
  browser.document.hidden = false;
  published.rates.Silver[0].rate = 95;
  await browser.document.emit('visibilitychange');
  await browser.settle();
  assert.deepEqual(browser.table('Silver'), ['999 ₱95']);
  published.rates.Platinum[0].rate = 2700;
  browser.intervals[0].callback();
  await browser.settle();
  assert.deepEqual(browser.table('Platinum'), ['999 ₱2,700']);
});

test('failed or invalid refresh keeps the last saved rates and estimate instead of falling back to old prices', async () => {
  let next = () => response(sheet());
  const browser = await createPublicRatesBrowser(() => next());
  browser.elements['#estimate-grams'].value = '2';
  await browser.elements['#estimate-grams'].emit('input');
  for (const bad of [() => { throw new Error('Offline'); }, () => ({ ok: false, status: 503 }),
    () => response({ rates: { Gold: [{ rate: 'invalid' }] } }), () => response({})]) {
    next = bad;
    await browser.refresh();
    assert.deepEqual(browser.table('Gold'), ['24K ₱7,800', '18K ₱5,850']);
    assert.equal(browser.elements['#estimate-total'].textContent, '₱15,600');
    assert.match(browser.elements['#rates-status'].textContent, /last loaded public rates/);
    assert.equal(browser.timeouts.size, 0);
  }
});

test('initial failure and unpublished sheet never invent prices; retry recovers', async () => {
  let next = () => { throw new Error('Offline'); };
  const browser = await createPublicRatesBrowser(() => next());
  assert.match(browser.table('Gold')[0], /temporarily unavailable/);
  assert.equal(browser.elements['#estimate-total'].textContent, '₱0');
  next = () => response({ effectiveDate: '', rates: {} });
  await browser.refresh();
  assert.match(browser.table('Gold')[0], /No public rates published/);
  next = () => response(sheet());
  await browser.refresh();
  assert.deepEqual(browser.table('Gold'), ['24K ₱7,800', '18K ₱5,850']);
});

test('preserved production design assets exist and source contains no localhost or hardcoded price sheet', async () => {
  const root = new URL('../sites/zpp-public-website/', import.meta.url);
  const html = await readFile(new URL('website.html', root), 'utf8');
  const js = await readFile(new URL('website.js', root), 'utf8');
  assert.match(html, /data-rates-api="https:\/\/zppgoldtrading.vercel.app\/api\/public-pricing"/);
  assert.doesNotMatch(js, /127\.0\.0\.1|localhost|PUBLISHED_RATES|\/api\/market/);
  for (const match of html.matchAll(/(?:src|href)="([^"#]+)"/g)) {
    if (!/^[a-z]+:/i.test(match[1])) await access(new URL(match[1].split('?')[0], root));
  }
});
