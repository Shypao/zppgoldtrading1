import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../sites/zpp-public-website/', import.meta.url);
const html = await readFile(new URL('website.html', root), 'utf8');
const css = await readFile(new URL('website.css', root), 'utf8');
const js = await readFile(new URL('website.js', root), 'utf8');
const facebook = 'https://web.facebook.com/profile.php?id=61593068612385';

test('approved ZP brand and supplied Facebook account are used throughout the public site', () => {
  assert.match(html, /<title>ZP Gold Trading/);
  assert.doesNotMatch(html, /ZPP Gold Trading|parengzp|m\.me\//);
  for (const match of html.matchAll(/href="([^"]*(?:facebook\.com|m\.me)[^"]*)"/g)) assert.equal(match[1], facebook);
  assert.match(html, /Phone: <span>\[PHONE\]<\/span>/);
  assert.doesNotMatch(html, /href="tel:/);
});

test('rates are first after the hero and estimator and tables share one pricing section', () => {
  const ids = [...html.matchAll(/<section[^>]*\bid="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(ids, ['rates', 'services', 'process', 'gallery', 'xrf', 'location']);
  assert.equal((html.match(/<tbody data-rate-table=/g) || []).length, 3);
  assert.equal((html.match(/<caption /g) || []).length, 3);
  assert.ok(html.indexOf('id="estimate"') < html.indexOf('id="services"'));
  assert.match(html, /<ol class="selling-steps">/);
  assert.match(css, /\.estimate\s*\{[^}]*order: -1/);
});

test('copy uses real shop vocabulary, one italic heading, and no invented reputation claims', () => {
  assert.equal((html.match(/<em>/g) || []).length, 1);
  assert.match(html, /Saudi and Japan gold/);
  assert.match(html, /Papel de ahensya/);
  assert.doesNotMatch(html, /friendly|transparent|straightforward|seamless|hassle-free|premium|we’ve got you|no hidden costs/i);
  assert.doesNotMatch(html, /aggregateRating|reviewCount|years in business|Free valuation/);
  assert.doesNotMatch(html, /class="svc-icon|role="tablist/);
});

test('estimator disclaimer is inside the result and error messages are associated with inputs', () => {
  assert.match(html, /class="estimate-result">[\s\S]*id="estimate-disclaimer"[\s\S]*?<\/div>/);
  assert.match(html, /id="estimate-grams"[^>]*aria-describedby="estimate-error estimate-disclaimer"/);
  for (const name of ['contact', 'message']) {
    assert.match(html, new RegExp(`id="inquiry-${name}"[^>]*aria-describedby="${name}-error"`));
    assert.match(html, new RegExp(`id="${name}-error"`));
  }
  assert.match(html, /<a class="skip-link" href="#rates"/);
  assert.match(css, /:focus-visible/);
});

test('all images reserve dimensions and the map and gallery are lazy loaded', async () => {
  for (const [tag] of html.matchAll(/<img\b[^>]*>/g)) {
    assert.match(tag, /width="\d+"/);
    assert.match(tag, /height="\d+"/);
    assert.match(tag, /\balt="[^"]*"/);
  }
  assert.match(html, /<iframe[^>]*title="[^"]+"[^>]*loading="lazy"/);
  assert.doesNotMatch(html, /we-buy-sell-square/);
  assert.doesNotMatch(css, /@import|fonts\.googleapis|@keyframes|infinite/);
  assert.ok((await stat(new URL('assets/zp-mark.png', root))).size < 20000);
});

test('SEO uses confirmed business facts without inventing a phone or exact save time', () => {
  assert.equal((html.match(/<h1\b/g) || []).length, 1);
  assert.match(html, /property="og:title"/);
  assert.match(html, /property="og:image"/);
  const data = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  assert.equal(data.name, 'ZP Gold Trading');
  assert.deepEqual(data.sameAs, [facebook]);
  assert.equal(data.address.addressLocality, 'Zamboanga City');
  assert.equal(data.openingHoursSpecification[0].opens, '10:30');
  assert.equal(data.openingHoursSpecification[0].closes, '18:00');
  assert.equal(data.telephone, undefined);
  assert.match(js, /Save time not recorded/);
});

test('gallery is paused by default and respects reduced motion, focus, and visibility', () => {
  assert.match(html, /data-gallery-toggle aria-pressed="false">Play slideshow/);
  assert.match(js, /reducedMotion\.matches/);
  assert.match(js, /reducedMotion\.addEventListener\('change', stopGallery\)/);
  assert.match(js, /addEventListener\('focusin', stopGallery\)/);
  assert.match(js, /ArrowLeft.*ArrowRight/);
  assert.match(js, /document\.hidden\) stopGallery/);
});

test('short contact form prepares text without sending data or opening an unapproved destination', () => {
  const form = html.match(/<form id="inquiry"[\s\S]*?<\/form>/)[0];
  assert.equal((form.match(/name="/g) || []).length, 3);
  assert.match(form, /Prepare Facebook message/);
  const contactCode = js.slice(js.indexOf('// This form only prepares text.'));
  assert.doesNotMatch(contactCode, /fetch\(|window\.open|FormData|formEndpoint/);
  assert.match(contactCode, /Message prepared, not sent/);
});

test('small-text theme combinations meet AA contrast, including gold on the warm panel', () => {
  const colors = Object.fromEntries([...css.matchAll(/--([a-z-]+):\s*(#[\da-f]{6});/g)].map(m => [m[1], m[2]]));
  const luminance = hex => hex.slice(1).match(/../g).map(v => parseInt(v, 16) / 255)
    .map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
    .reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i], 0);
  for (const [fg, bg] of [['gold', 'cream'], ['gold', 'warm'], ['muted', 'cream'], ['muted', 'paper'], ['gold-light', 'ink'], ['paper', 'ink'], ['error', 'paper']]) {
    const a = luminance(colors[fg]), b = luminance(colors[bg]);
    const contrast = (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
    assert.ok(contrast >= 4.5, `${fg} on ${bg}: ${contrast}`);
  }
});
