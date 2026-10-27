import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../sites/zpp-public-website/website.js', import.meta.url), 'utf8');
const gallerySource = source.slice(source.indexOf('// Shop photos:'), source.indexOf('// Optional third-party map:'));
const mapSource = source.slice(source.indexOf('// Optional third-party map:'), source.indexOf('// This form only prepares text.'));

function fixture({ reduced = false, consent = null } = {}) {
  const storage = new Map(consent ? [['zp-cookie-consent-v1', consent]] : []);
  const intervals = new Map();
  const elements = new Map();
  let nextTimer = 0;
  const document = { hidden: false, activeElement: null };
  const element = selector => {
    if (elements.has(selector)) return elements.get(selector);
    const events = new Map();
    const el = {
      events, dataset: {}, attributes: {}, textContent: '', hidden: false,
      classList: { toggle() {} }, contains(node) { return node === this.focusChild; },
      setAttribute(key, value) { this.attributes[key] = value; },
      removeAttribute(key) { delete this[key]; delete this.attributes[key]; },
      addEventListener(name, fn) { if (!events.has(name)) events.set(name, []); events.get(name).push(fn); },
      emit(name, event = {}) { for (const fn of events.get(name) || []) fn(event); },
      focus() { document.activeElement = this; },
      showModal() { this.open = true; }, close() { this.open = false; this.emit('close'); }
    };
    elements.set(selector, el);
    return el;
  };
  Object.assign(document, element('document'));
  const media = Object.assign(element('media'), { matches: reduced });
  const slides = [0, 1, 2].map(i => element(`slide-${i}`));
  const previews = [0, 1, 2].map(i => Object.assign(element(`preview-${i}`), { dataset: { galleryIndex: String(i) } }));
  const photos = [0, 1, 2].map(i => Object.assign(element(`photo-${i}`), { dataset: { gallerySrc: `${i}.jpg`, galleryAlt: `Photo ${i}` } }));
  let observer;
  class IntersectionObserver {
    constructor(callback) { observer = callback; }
    observe() {}
  }
  const context = vm.createContext({
    $: element,
    $$: selector => ({ '.gallery-slide': slides, '[data-gallery-index]': previews, '[data-gallery-src]': photos, 'a[href="#cookie-policy"]': [element('privacy-link')] })[selector] || [],
    window: { matchMedia: () => media, IntersectionObserver }, document, IntersectionObserver, queueMicrotask,
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    setInterval(callback, delay) { const id = ++nextTimer; intervals.set(id, { callback, delay }); return id; },
    clearInterval(id) { intervals.delete(id); }
  });
  vm.runInContext(gallerySource, context);
  return {
    element, slides, previews, photos, media, document, intervals, context, storage,
    visible(value = true) { observer([{ isIntersecting: value }]); },
    tick() { [...intervals.values()].forEach(timer => timer.callback()); },
    current() { return String(slides.findIndex(slide => !slide.hidden) + 1); }
  };
}

test('gallery automatically advances every four seconds while visible and wraps all photos', () => {
  const f = fixture();
  assert.equal(f.intervals.size, 0);
  f.visible();
  assert.equal([...f.intervals.values()][0].delay, 4000);
  for (const expected of ['2', '3', '1']) { f.tick(); assert.equal(f.current(), expected); }
  assert.equal(f.slides.filter(slide => !slide.hidden).length, 1);
});

test('in-frame arrows keep automatic playback', () => {
  const f = fixture(); f.visible();
  f.element('[data-gallery-next]').emit('click');
  assert.equal(f.current(), '2');
  assert.equal(f.intervals.size, 1);
  f.element('[data-gallery-prev]').emit('click');
  assert.equal(f.current(), '1');
  f.tick(); assert.equal(f.current(), '2');
});

test('reduced motion, offscreen state, hidden page and lightbox temporarily suspend autoplay', () => {
  const f = fixture({ reduced: true }); f.visible();
  assert.equal(f.intervals.size, 0);
  f.media.matches = false; f.media.emit('change'); assert.equal(f.intervals.size, 1);
  f.visible(false); assert.equal(f.intervals.size, 0);
  f.visible(); assert.equal(f.intervals.size, 1);
  f.document.hidden = true; f.document.emit('visibilitychange'); assert.equal(f.intervals.size, 0);
  f.document.hidden = false; f.document.emit('visibilitychange'); assert.equal(f.intervals.size, 1);
  f.photos[0].emit('click'); assert.equal(f.intervals.size, 0);
  assert.equal(f.element('#gallery-lightbox-image').src, '0.jpg');
  f.element('#gallery-lightbox').close(); assert.equal(f.intervals.size, 1);
});

test('focused photo pauses without stealing focus and keyboard arrows preserve playback', async () => {
  const f = fixture(); f.visible();
  const carousel = f.element('.gallery-carousel');
  carousel.focusChild = f.photos[0]; f.document.activeElement = f.photos[0];
  carousel.emit('focusin'); assert.equal(f.intervals.size, 0);
  f.document.activeElement = null; carousel.emit('focusout');
  await Promise.resolve(); assert.equal(f.intervals.size, 1);
  let prevented = false;
  f.element('.gallery-viewer').emit('keydown', { key: 'ArrowRight', preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(f.current(), '2');
  assert.equal(f.document.activeElement, f.element('[data-gallery-next]'));
});

test('map connects only on acceptance and saves only the consent choice', () => {
  const f = fixture();
  const frame = f.element('#shop-map'); frame.dataset.src = 'https://www.google.com/maps?output=embed'; frame.hidden = true;
  vm.runInContext(mapSource, f.context);
  assert.equal(f.element('#cookie-dialog').open, true);
  assert.equal(frame.src, undefined);
  f.element('#cookie-decline').emit('click');
  assert.equal(f.element('#cookie-dialog').open, false);
  assert.equal(f.storage.get('zp-cookie-consent-v1'), 'declined');
  assert.equal(frame.src, undefined);
  f.element('privacy-link').emit('click');
  assert.equal(f.element('#cookie-policy').open, true);
  assert.equal(frame.src, undefined);
  f.element('#map-accept').emit('click');
  assert.equal(frame.src, frame.dataset.src);
  assert.equal(frame.hidden, false);
  assert.equal(f.element('#map-consent').hidden, true);
  f.element('#map-revoke').emit('click');
  assert.equal(frame.src, undefined);
  assert.equal(frame.hidden, true);
  assert.equal(f.element('#map-consent').hidden, false);
  f.element('#cookie-dialog').showModal();
  f.element('#cookie-accept').emit('click');
  assert.equal(frame.src, frame.dataset.src);
  assert.equal(f.element('#cookie-dialog').open, false);
  assert.equal(f.storage.get('zp-cookie-consent-v1'), 'accepted');
  assert.equal(f.storage.size, 1);
});

test('return visits remember either choice without repeating the pop-up', () => {
  for (const consent of ['accepted', 'declined']) {
    const f = fixture({ consent });
    f.element('#shop-map').dataset.src = 'https://www.google.com/maps?output=embed';
    vm.runInContext(mapSource, f.context);
    assert.notEqual(f.element('#cookie-dialog').open, true);
    assert.equal(f.element('#shop-map').hidden, consent !== 'accepted');
    f.element('#cookie-settings').emit('click');
    assert.equal(f.element('#cookie-dialog').open, true);
    f.element('#cookie-decline').emit('click');
    assert.equal(f.storage.get('zp-cookie-consent-v1'), 'declined');
    assert.equal(f.element('#shop-map').src, undefined);
  }
});
