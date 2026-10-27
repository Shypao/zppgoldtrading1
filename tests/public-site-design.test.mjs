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
  assert.deepEqual(ids, ['rates', 'services', 'process', 'gallery', 'location']);
  assert.doesNotMatch(html, /XRF|id="xrf"|href="#xrf"|Photo to add/);
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
  assert.doesNotMatch(css, /@import|fonts\.googleapis/);
  assert.deepEqual([...css.matchAll(/@keyframes\s+([\w-]+)/g)].map(match => match[1]), ['karat-fill', 'karat-float', 'karat-flow']);
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

test('gallery autoplays with in-frame navigation and respects reduced motion, focus, and visibility', () => {
  assert.doesNotMatch(html, /data-gallery-toggle|data-gallery-current|data-gallery-total/);
  assert.match(js, /reducedMotion\.matches/);
  assert.match(js, /reducedMotion\.addEventListener\('change', syncGallery\)/);
  assert.match(js, /addEventListener\('focusin', syncGallery\)/);
  assert.match(js, /ArrowLeft.*ArrowRight/);
  assert.match(js, /!document\.hidden/);
  assert.match(js, /showGallery\(galleryIndex \+ 1\), 4000/);
  const gallery = html.match(/<section id="gallery"[\s\S]*?<\/section>/)[0];
  assert.doesNotMatch(gallery, /weighing counter|photo-request/i);
  assert.match(gallery, /class="gallery-viewer">[\s\S]*?data-gallery-prev[\s\S]*?data-gallery-next/);
  assert.doesNotMatch(gallery, /data-gallery-index|gallery-previews/);
  assert.match(css, /\.gallery-arrow\s*\{[^}]*position:\s*absolute/);
});

test('optional map is blocked until acceptance and uses our own accurate privacy notice', () => {
  const frame = html.match(/<iframe[^>]+>/)[0];
  assert.doesNotMatch(frame, /\ssrc=/);
  assert.match(frame, /data-src="https:\/\/www\.google\.com\/maps/);
  assert.match(frame, /\shidden/);
  assert.match(html, /Accept &amp; load map/);
  assert.match(html, /id="cookie-policy"/);
  assert.match(html, /<dialog id="cookie-dialog"[^>]*aria-labelledby="cookie-dialog-title"/);
  assert.match(html, /Continue without optional cookies/);
  assert.match(js, /cookieDialog\.showModal\(\)/);
  assert.doesNotMatch(html, /rsjewellers|consent to these cookies being used/);
  assert.doesNotMatch(js, /document\.cookie|sessionStorage|gtag\(|fbq\(/);
  assert.match(js, /const COOKIE_CHOICE_KEY = 'zp-cookie-consent-v1'/);
  assert.match(js, /if \(cookieChoice\) setMapConsent/);
  assert.match(js, /mapFrame\.removeAttribute\('src'\)/);
  assert.doesNotMatch(html.match(/<textarea id="inquiry-message"[^>]*>/)[0], /placeholder=/);
});

test('map link, official embed, and business metadata use the owner-supplied shop pin', () => {
  const listing = 'https://www.google.com/maps?q=ZP+Gold+and+Silver,+Barcelona+St,+Zamboanga+City,+7000+Zamboanga+del+Sur&ftid=0x325041c7ca6ca377:0xd44ae94991b61a0a';
  const mapLink = html.match(/href="(https:\/\/www\.google\.com\/maps[^\"]+)"[^>]*>Directions/)[1].replaceAll('&amp;', '&');
  assert.equal(mapLink, listing);
  const data = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  assert.equal(data.hasMap, listing);
  const frame = html.match(/<iframe[^>]+>/)[0];
  assert.match(frame, /title="Map of ZP Gold and Silver,/);
  const embed = new URL(frame.match(/data-src="([^\"]+)"/)[1]);
  assert.equal(embed.pathname, '/maps/embed');
  assert.match(embed.searchParams.get('pb'), /0x325041c7ca6ca377:0xd44ae94991b61a0a/);
  assert.match(embed.searchParams.get('pb'), /ZP Gold and Silver/);
  assert.doesNotMatch(mapLink, /g_ep=|skid=|lucs=|entry=gps/);
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

test('gallery displays whole portrait and landscape photos instead of cropping them', () => {
  const imageRule = css.match(/\.gallery-slide img\s*\{([^}]+)\}/)[1];
  assert.match(imageRule, /object-fit:\s*contain/);
  assert.match(imageRule, /object-position:\s*center/);
  assert.doesNotMatch(css, /\.gallery-slide img\s*\{[^}]*object-fit:\s*cover/);
  assert.match(css, /\.gallery-slide button\s*\{[^}]*height:\s*var\(--gallery-photo-height\)/);
  assert.match(imageRule, /height:\s*100%/);
});

test('laptop gallery has a compact stable frame and centered in-image navigation', () => {
  const gallery = css.match(/\.gallery\s*\{([^}]+)\}/)[1];
  const card = css.match(/\.gallery-card\s*\{([^}]+)\}/)[1];
  const arrow = css.match(/\.gallery-arrow\s*\{([^}]+)\}/)[1];
  assert.match(gallery, /max-width:\s*720px/);
  assert.match(card, /--gallery-photo-height:\s*clamp\(220px, 48vh, 380px\)/);
  assert.match(arrow, /top:\s*calc\(var\(--gallery-photo-height\) \/ 2\)/);
  assert.match(arrow, /width:\s*44px/);
  assert.match(css, /\.gallery-slide figcaption\s*\{[^}]*min-height:\s*3\.5rem/);
});

test('sections 02 and 03 share column alignment, have clear detail labels, and a full-width divider', () => {
  const accepted = css.match(/\.accepted\s*\{([^}]+)\}/)[1];
  const selling = css.match(/\.selling\s*\{([^}]+)\}/)[1];
  const columns = rule => rule.match(/grid-template-columns:\s*([^;]+)/)[1];
  assert.equal(columns(accepted), columns(selling));
  assert.match(accepted, /align-items:\s*start/);
  assert.match(selling, /align-items:\s*start/);
  assert.match(selling, /border-top:\s*1px solid var\(--line\)/);
  assert.match(html, /<h3>Items we accept<\/h3>/);
  assert.match(html, /<h3>How selling works<\/h3>/);
  assert.equal((html.match(/class="section-detail"/g) || []).length, 2);
  const numbers = css.match(/\.selling-steps li::before\s*\{([^}]+)\}/)[1];
  assert.match(numbers, /grid-column:\s*1/);
  assert.doesNotMatch(numbers, /position:\s*absolute/);
});

test('hero photo assets remain available after replacing the picture with a karat guide', async () => {
  assert.doesNotMatch(html, /class="hero-photo"/);
  assert.ok((await stat(new URL('assets/store-gallery/display-case-enhanced-v2.jpg', root))).size < 300000);
  assert.ok((await stat(new URL('assets/store-gallery/display-case.jpg', root))).size > 0);
  assert.ok((await stat(new URL('assets/store-gallery/storefront-800.jpg', root))).size > 0);
});

test('animated karat rings match nominal purity and do not replace the saved rates source', () => {
  const panel = html.match(/<aside class="karat-panel[\s\S]*?<\/aside>/)[0];
  assert.match(panel, /From our shop/);
  assert.match(panel, /Nominal karat guide, not a test result/);
  const rings = [...panel.matchAll(/data-karat="([\d.]+)" data-purity="([\d.]+)"/g)];
  assert.deepEqual(rings.map(match => Number(match[1])), [24, 22, 21, 18, 14]);
  for (const ring of rings) assert.equal(Number(ring[2]), Math.round(Number(ring[1]) / 24 * 1000) / 10);
  assert.equal((panel.match(/aria-hidden="true" focusable="false"/g) || []).length, 6);
  assert.doesNotMatch(panel, /<img|canvas|iframe/);
  assert.doesNotMatch(js, /karatReplay|karatMotionToggle|syncKaratMotion/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /animation: none !important/);
});

test('floating connected rings animate continuously without buttons and respect system reduced motion', () => {
  assert.match(html, /class="karat-connections" viewBox="0 0 360 350"/);
  const panel = html.match(/<aside class="karat-panel[\s\S]*?<\/aside>/)[0];
  assert.doesNotMatch(panel, /<button|karat-motion-toggle|karat-replay/);
  assert.match(css, /animation: karat-float[^;]+infinite/);
  assert.match(css, /animation: karat-flow[^;]+infinite/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.doesNotMatch(js, /karatMotion|karatReplay|syncKaratMotion/);
});
