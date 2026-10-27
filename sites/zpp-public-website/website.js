/* ===== EDIT ME: contact settings. Leave a value empty ("") to hide that channel. ===== */
const ZPP = {
  messenger: 'parengzp',   // from facebook.com/parengzp
  phone: '',               // e.g. '+639XXXXXXXXX'
  whatsapp: '',            // e.g. '639XXXXXXXXX' (no + sign)
  email: '',               // e.g. 'hello@yourdomain.com'
  formEndpoint: ''         // e.g. a Formspree URL. Without it, the form cannot send on its own.
};

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
$('#year').textContent = new Date().getFullYear();

// Read-only public view of the daily rates edited in the internal software.
const PRICING_ENDPOINT = document.body.dataset.ratesApi || 'https://zppgoldtrading.vercel.app/api/public-pricing';
const rateFormatter = new Intl.NumberFormat('en-PH', { maximumFractionDigits: 0 });
let currentPublicRates = null;
let publicRatesLoading = false;
function orderedPublicGrades(metal, data = currentPublicRates) {
  const grades = Array.isArray(data?.rates?.[metal]) ? data.rates[metal] : [];
  const kind = grade => String(grade.label || grade.key || '').includes('%') ? 1 : 0;
  return [...grades].sort((a, b) => kind(a) - kind(b)
    || parseFloat(b.label || b.key) - parseFloat(a.label || a.key)
    || String(a.label || a.key).localeCompare(String(b.label || b.key)));
}
function publicRatesDateLabel(data) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(data.effectiveDate || '')
    ? new Date(`${data.effectiveDate}T00:00:00+08:00`) : null;
  if (!date || Number.isNaN(date.getTime())) return 'Publication date not recorded';
  const label = date.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'Asia/Manila' });
  return `Rates as of ${label} · Save time not recorded`;
}
function updateRatesAgeNote(data) {
  const note = $('#rates-age-note');
  if (!note) return;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const dated = /^\d{4}-\d{2}-\d{2}$/.test(data.effectiveDate || '');
  note.hidden = dated && data.effectiveDate >= today;
  note.textContent = 'Please confirm today’s rate with us before visiting. The published prices stay unchanged until the shop saves a new public rate sheet.';
}
function renderPublicRates(data) {
  currentPublicRates = data;
  ['Gold', 'Silver', 'Platinum'].forEach(metal => {
    const target = $(`[data-rate-table="${metal}"]`);
    const rates = orderedPublicGrades(metal, data);
    if (!target) return;
    const table = target.tagName === 'TBODY';
    if (!rates.length) {
      const row = document.createElement(table ? 'tr' : 'div');
      const message = document.createElement(table ? 'td' : 'p');
      if (table) message.colSpan = 2;
      message.textContent = 'No public rates published yet. Please contact us.';
      row.append(message);
      target.replaceChildren(row);
      return;
    }
    let lastGroup = '';
    const rows = [];
    rates.forEach(item => {
      const percentage = String(item.label || item.key || '').includes('%');
      const group = percentage ? 'Percentage purity' : metal === 'Gold' ? 'Karat grades' : 'Fineness grades';
      if (table && group !== lastGroup) {
        const groupRow = document.createElement('tr'); groupRow.className = 'rate-group';
        const heading = document.createElement('th'); heading.colSpan = 2; heading.scope = 'colgroup'; heading.textContent = group;
        groupRow.append(heading); rows.push(groupRow); lastGroup = group;
      }
      const row = document.createElement(table ? 'tr' : 'div'); row.className = 'rate-row';
      const label = document.createElement(table ? 'th' : 'span'); label.textContent = item.label || item.key || '';
      if (table) label.scope = 'row';
      const value = document.createElement(table ? 'td' : 'strong');
      value.textContent = Number(item.rate) > 0 ? `₱${rateFormatter.format(Number(item.rate))}` : 'Ask us';
      row.append(label, value); rows.push(row);
    });
    target.replaceChildren(...rows);
  });
  $('#rates-status').textContent = Object.values(data.rates).some(rates => rates.length)
    ? publicRatesDateLabel(data) : 'No public rates published yet. Please contact us.';
  updateRatesAgeNote(data);
}
function setupEstimateCalculator() {
  const metalInput = $('#estimate-metal'), purityInput = $('#estimate-purity'), gramsInput = $('#estimate-grams');
  const total = $('#estimate-total'), breakdown = $('#estimate-breakdown');
  if (!metalInput || !purityInput || !gramsInput || !total || !breakdown) return;
  const gradesFor = metal => orderedPublicGrades(metal);
  const renderPurities = () => {
    const grades = gradesFor(metalInput.value);
    const selected = purityInput.value;
    purityInput.replaceChildren(...grades.map((grade, index) => {
      const option = document.createElement('option');
      option.value = grade.label || grade.key || '';
      option.textContent = grade.label || grade.key || '';
      if (index === 0) option.selected = true;
      return option;
    }));
    if (grades.some(grade => (grade.label || grade.key) === selected)) purityInput.value = selected;
    calculate();
  };
  const calculate = () => {
    const grade = gradesFor(metalInput.value).find(item => (item.label || item.key) === purityInput.value);
    const grams = Number(gramsInput.value);
    const rate = Number(grade?.rate) || 0;
    const invalid = !!gramsInput.validity?.badInput || (gramsInput.value !== '' && (!Number.isFinite(grams) || grams <= 0 || !Number.isFinite(grams * rate)));
    const error = $('#estimate-error');
    gramsInput.setAttribute('aria-invalid', String(invalid));
    if (error) error.textContent = invalid ? 'Enter a valid weight greater than zero, for example 2.5 g.' : '';
    if (invalid) {
      total.textContent = '—';
      breakdown.textContent = 'Check the weight to calculate an estimate.';
      return;
    }
    const value = grams > 0 && rate > 0 ? grams * rate : 0;
    total.textContent = value > 0 ? `₱${rateFormatter.format(Math.round(value))}` : '₱0';
    breakdown.textContent = value > 0 ? `${grams.toLocaleString('en-PH', { maximumFractionDigits: 20 })} g × ₱${rateFormatter.format(rate)}/g`
      : rate > 0 ? `₱${rateFormatter.format(rate)}/g · Enter a weight to calculate.` : 'A published rate is needed to calculate an estimate.';
  };
  metalInput.addEventListener('change', renderPurities);
  purityInput.addEventListener('change', calculate);
  gramsInput.addEventListener('input', calculate);
  renderPurities();
  window.updateEstimateRates = () => { renderPurities(); calculate(); };
}
setupEstimateCalculator();
async function loadPublicRates() {
  if (publicRatesLoading) return;
  publicRatesLoading = true;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    // Read only the saved public sheet. Never derive prices from buying or market rates.
    const response = await fetch(PRICING_ENDPOINT, { cache: 'no-store', signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (!data || !data.rates || typeof data.rates !== 'object' || Array.isArray(data.rates)
      || Object.entries(data.rates).some(([metal, rates]) => !['Gold', 'Silver', 'Platinum'].includes(metal)
        || !Array.isArray(rates) || rates.some(item => !item || !Number.isFinite(Number(item.rate)) || Number(item.rate) <= 0))) {
      throw new Error('Invalid published rate sheet');
    }
    renderPublicRates(data);
    window.updateEstimateRates?.();
  } catch (_) {
    // An outage must not replace saved rates with fabricated or internal prices.
    if (currentPublicRates) {
      $('#rates-status').textContent = `${publicRatesDateLabel(currentPublicRates)} · Showing the last loaded public rates. Connection unavailable; retrying shortly.`;
      updateRatesAgeNote(currentPublicRates);
    } else {
      ['Gold', 'Silver', 'Platinum'].forEach(metal => {
        const target = $(`[data-rate-table="${metal}"]`);
        const table = target?.tagName === 'TBODY';
        const row = document.createElement(table ? 'tr' : 'div');
        const message = document.createElement(table ? 'td' : 'p');
        if (table) message.colSpan = 2;
        message.textContent = 'Rates temporarily unavailable. Please contact us.';
        row.append(message); target?.replaceChildren(row);
      });
      $('#rates-status').textContent = 'Unable to load published rates. Retrying shortly.';
    }
  } finally {
    clearTimeout(timeout);
    publicRatesLoading = false;
  }
}
loadPublicRates();
// Check for explicit public-editor saves; these reads never change any stored rates.
setInterval(() => { if (!document.hidden) loadPublicRates(); }, 30000);
window.addEventListener('focus', () => loadPublicRates());
document.addEventListener('visibilitychange', () => { if (!document.hidden) loadPublicRates(); });

// Scroll reveal
const io = 'IntersectionObserver' in window ? new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: .15 }) : null;
$$('.reveal').forEach(el => io ? io.observe(el) : el.classList.add('in'));

// Store gallery lightbox
const galleryDialog = $('#gallery-lightbox');
const galleryImage = $('#gallery-lightbox-image');
const galleryCaption = $('#gallery-lightbox-caption');
const closeGallery = () => galleryDialog?.close();
$$('[data-gallery-src]').forEach(tile => tile.addEventListener('click', () => {
  if (!galleryDialog) return;
  galleryImage.src = tile.dataset.gallerySrc;
  galleryImage.alt = tile.dataset.galleryAlt || '';
  galleryCaption.textContent = tile.dataset.galleryAlt || '';
  galleryDialog.showModal();
}));
$('.lightbox-close')?.addEventListener('click', closeGallery);
galleryDialog?.addEventListener('click', event => {
  if (event.target === galleryDialog) closeGallery();
});
galleryDialog?.addEventListener('cancel', event => {
  event.preventDefault();
  closeGallery();
});

// Single-photo store carousel
const galleryTiles = $$('[data-gallery-src]');
const galleryCurrent = $('[data-gallery-current]');
const galleryTotal = $('[data-gallery-total]');
const galleryPrev = $('[data-gallery-prev]');
const galleryNext = $('[data-gallery-next]');
const galleryToggle = $('[data-gallery-toggle]');
let galleryIndex = 0;
let galleryTimer = null;
if (galleryTiles.length) {
  galleryTotal.textContent = galleryTiles.length;
  const setGallerySlide = (index, announce = true) => {
    galleryIndex = (index + galleryTiles.length) % galleryTiles.length;
    galleryTiles.forEach((tile, i) => {
      const active = i === galleryIndex;
      tile.classList.toggle('is-active', active);
      tile.setAttribute('aria-hidden', String(!active));
      tile.tabIndex = active ? 0 : -1;
    });
    galleryCurrent.textContent = galleryIndex + 1;
    if (announce) galleryCurrent.parentElement.setAttribute('aria-label', `Photo ${galleryIndex + 1} of ${galleryTiles.length}`);
  };
  const stopGallery = () => {
    clearInterval(galleryTimer);
    galleryTimer = null;
    galleryToggle.textContent = 'Play slideshow';
    galleryToggle.setAttribute('aria-pressed', 'false');
  };
  const startGallery = () => {
    clearInterval(galleryTimer);
    galleryTimer = setInterval(() => setGallerySlide(galleryIndex + 1), 5000);
    galleryToggle.textContent = 'Pause slideshow';
    galleryToggle.setAttribute('aria-pressed', 'true');
  };
  setGallerySlide(0, false);
  startGallery();
  galleryPrev.addEventListener('click', () => { setGallerySlide(galleryIndex - 1); startGallery(); });
  galleryNext.addEventListener('click', () => { setGallerySlide(galleryIndex + 1); startGallery(); });
  galleryToggle.addEventListener('click', () => galleryTimer ? stopGallery() : startGallery());
}

// Service dialog
const SERVICES = {
  trading: ['We Buy Gold & Silver', 'Bring your gold or silver jewelry, bars, coins, or other precious metals. We’ll explain the process and prepare a clear, fair quote.', 'We Buy Gold & Silver'],
  quote: ['Get a clear quote', 'Visit the store for a friendly conversation and a straightforward quote for your item.', 'Get a quote'],
  xrf: ['XRF testing', 'XRF (X-ray fluorescence) helps identify the elements in a sample without damaging it. Ask us what it can show for your item.', 'XRF testing']
};
const dlg = $('#svc-dialog');
let dlgService = '';
$$('[data-service]').forEach(b => b.addEventListener('click', () => {
  const [t, p, s] = SERVICES[b.dataset.service];
  $('#svc-title').textContent = t; $('#svc-text').textContent = p; dlgService = s; dlg.showModal();
}));
$('#svc-close').onclick = () => dlg.close();
$('#svc-req').onclick = () => { dlg.close(); prefill(dlgService); };
$$('[data-request]').forEach(b => b.addEventListener('click', () => prefill(b.dataset.request.replace('&amp;', '&'))));
function prefill(service) {
  const sel = $('#inquiry [name=service]');
  [...sel.options].forEach(o => { if (o.textContent === service) sel.value = o.value || o.textContent; });
  $('#start').scrollIntoView({ behavior: 'smooth' });
  setTimeout(() => $('#inquiry [name=name]').focus({ preventScroll: true }), 500);
}

// XRF steps
const STEPS = [
  'Ask us what we accept and what to prepare, then bring your item to the store or message us first. Questions are welcome.',
  'Your item is placed in the XRF analyzer. It uses X-rays to read which elements are present in the area being tested.',
  'We go over the reading with you and explain what it shows and what it doesn’t. You’re free to ask as many questions as you like.'
];
const tabs = $$('.steps button');
function showStep(i) { tabs.forEach((t, n) => t.setAttribute('aria-selected', n === i)); const b = $('#step-body'); b.style.animation = 'none'; b.offsetHeight; b.style.animation = ''; b.textContent = STEPS[i]; }
tabs.forEach((t, i) => t.addEventListener('click', () => showStep(i)));
showStep(0);

// Contact channels (only those configured)
const msgr = 'https://m.me/' + ZPP.messenger;
function channels() {
  const c = [];
  if (ZPP.messenger) c.push(['Facebook Messenger', msgr]);
  if (ZPP.whatsapp) c.push(['WhatsApp', 'https://wa.me/' + ZPP.whatsapp]);
  if (ZPP.phone) c.push(['Call us', 'tel:' + ZPP.phone]);
  if (ZPP.email) c.push(['Email us', 'mailto:' + ZPP.email]);
  c.push(['Website inquiry form', '#start']);
  return c;
}

// Rule-based help guide (not a live or AI assistant)
const panel = $('#help-panel'), fab = $('#help-fab'), body = $('#help-body');
const link = (t, h) => { const a = document.createElement('a'); a.textContent = t; a.href = h; if (h[0] === '#') a.onclick = closeHelp; else if (h.startsWith('http')) { a.target = '_blank'; a.rel = 'noreferrer'; } return a; };
const btn = (t, fn) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = t; b.onclick = fn; return b; };
const TOPICS = {
  test: ['I want to have my gold tested.', 'We offer gold and silver trading, quotes, and XRF testing. Send us a short inquiry and we’ll guide you on next steps.', () => [link('Send an inquiry', '#start')]],
  xrf: ['I’d like to learn about XRF technology.', 'XRF uses X-rays to identify which elements are in a sample, without damaging it. It reads the tested area, so it doesn’t tell us everything about an item.', () => [link('See how it works', '#xrf')]],
  services: ['I want to know your services.', 'We buy gold and silver, offer clear quotes, and provide XRF testing.', () => [link('See our services', '#services')]],
  where: ['Where are you located?', 'Barcelona St, Zone II, Zamboanga City, near Puericulture Center and JW Gadgets. Open daily, 10:30 AM–6:00 PM.', () => [link('Show the location', '#location'), link('Get directions', 'https://www.google.com/maps/dir/?api=1&destination=6.9070538%2C122.0758178')]],
  question: ['I have a question.', 'Check our FAQ, or send us a message. We’ll reply as soon as we can.', () => [link('Read the FAQ', '#faq'), link('Message us on Messenger', msgr), link('Use the inquiry form', '#start')]],
  contact: ['I’d like to contact your team.', 'Here are the ways to reach us:', () => channels().map(([t, h]) => link(t, h))]
};
function home() {
  body.replaceChildren();
  const p = document.createElement('p'); p.textContent = 'Hi there! 👋 Welcome! What can we help you with today?';
  const o = document.createElement('div'); o.className = 'help-opts';
  Object.entries(TOPICS).forEach(([k, v]) => o.append(btn(v[0], () => topic(k))));
  body.append(p, o);
}
function topic(k) {
  const [, text, acts] = TOPICS[k];
  body.replaceChildren();
  const p = document.createElement('p'); p.textContent = text;
  const o = document.createElement('div'); o.className = 'help-opts';
  o.append(...acts(), btn('← Back to topics', home));
  body.append(p, o);
}
function openHelp(k) { panel.hidden = false; fab.setAttribute('aria-expanded', true); k ? topic(k) : home(); }
function closeHelp() { panel.hidden = true; fab.setAttribute('aria-expanded', false); }
fab.onclick = () => panel.hidden ? openHelp() : closeHelp();
$('#help-close').onclick = () => { closeHelp(); fab.focus(); };
$$('[data-open-help]').forEach(b => b.addEventListener('click', () => openHelp(b.dataset.topic)));
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !panel.hidden) { closeHelp(); fab.focus(); } });

// Inquiry form
const form = $('#inquiry'), status = $('#form-status');
const rules = {
  name: v => v.trim().length < 2 ? 'Please tell us your name.' : '',
  method: v => v ? '' : 'Please choose how we should reach you.',
  contact: v => (/^\+?[\d\s-]{7,15}$/.test(v.trim()) || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.trim())) ? '' : 'Enter a phone number or email we can use.'
};
function check(n) { const f = form.elements[n], m = rules[n](f.value); f.classList.toggle('invalid', !!m); f.setAttribute('aria-invalid', !!m); $(`[data-for=${n}]`).textContent = m; return !m; }
Object.keys(rules).forEach(n => form.elements[n].addEventListener('blur', () => check(n)));
form.addEventListener('submit', async e => {
  e.preventDefault();
  const ok = Object.keys(rules).map(check).every(Boolean);
  if (!ok) { status.className = 'wide bad'; status.textContent = 'Please fix the highlighted fields.'; return; }
  const data = Object.fromEntries(new FormData(form));
  const sb = $('button[type=submit]', form), lbl = $('.lbl', sb);
  sb.disabled = true; lbl.textContent = 'Sending…'; status.className = 'wide'; status.textContent = '';
  const text = `Hi ZPP! I'm ${data.name}. Service: ${data.service || 'not sure'}. Item: ${data.sample || 'not sure'}. Contact me by ${data.method}: ${data.contact}. ${data.message || ''}`.trim();
  try {
    if (ZPP.formEndpoint) {
      const r = await fetch(ZPP.formEndpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(data) });
      if (!r.ok) throw new Error(r.status);
      status.className = 'wide ok'; status.textContent = 'Thank you! We got your inquiry and will reach out using your preferred method.'; form.reset();
    } else {
      try { await navigator.clipboard.writeText(text); } catch (_) {}
      window.open(msgr + '?text=' + encodeURIComponent(text), '_blank', 'noopener');
      status.className = 'wide warn'; status.textContent = 'Your inquiry has not been sent yet. We opened Messenger with your message ready. Please press Send there so we receive it.';
    }
  } catch (_) {
    status.className = 'wide bad'; status.textContent = 'Sorry, that didn’t go through. Please try again, or message us on Facebook.';
  } finally { sb.disabled = false; lbl.textContent = 'Send my inquiry'; }
});
