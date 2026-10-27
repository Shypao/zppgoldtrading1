/* Public website presentation only. The rates endpoint and saved pricing are unchanged. */
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
  note.hidden = dated && data.effectiveDate === today;
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

// Scroll reveal is deliberately omitted: content stays visible without animation or JavaScript.
$('#estimate-form').addEventListener('submit', event => event.preventDefault());

// Shop photos: automatically advance while visible; manual navigation preserves playback intent.
const gallerySlides = $$('.gallery-slide');
const galleryDialog = $('#gallery-lightbox');
const galleryCarousel = $('.gallery-carousel');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
let galleryIndex = 0;
let galleryTimer = null;
let galleryInView = !('IntersectionObserver' in window);
function stopGallery() {
  if (galleryTimer !== null) clearInterval(galleryTimer);
  galleryTimer = null;
}
function syncGallery() {
  stopGallery();
  const imageFocused = galleryCarousel.contains(document.activeElement);
  const canPlay = !reducedMotion.matches && !document.hidden
    && !galleryDialog.open && !$('#cookie-dialog')?.open && galleryInView && !imageFocused;
  if (canPlay) galleryTimer = setInterval(() => showGallery(galleryIndex + 1), 4000);
  $('#gallery-playback-status').textContent = reducedMotion.matches ? 'Use arrows · Reduced motion enabled'
    : imageFocused || galleryDialog.open ? 'Auto-play resumes when you leave the photo viewer'
    : 'Automatic slideshow · Every 4 seconds';
}
function showGallery(index) {
  galleryIndex = (index + gallerySlides.length) % gallerySlides.length;
  gallerySlides.forEach((slide, i) => {
    slide.hidden = i !== galleryIndex;
    slide.classList.toggle('is-active', i === galleryIndex);
  });
}
function navigateGallery(index) { showGallery(index); syncGallery(); }
$('[data-gallery-prev]').addEventListener('click', () => navigateGallery(galleryIndex - 1));
$('[data-gallery-next]').addEventListener('click', () => navigateGallery(galleryIndex + 1));
galleryCarousel.addEventListener('focusin', syncGallery);
galleryCarousel.addEventListener('focusout', () => queueMicrotask(syncGallery));
$('.gallery-viewer').addEventListener('keydown', event => {
  if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
  event.preventDefault();
  const forward = event.key === 'ArrowRight';
  $(forward ? '[data-gallery-next]' : '[data-gallery-prev]').focus();
  navigateGallery(galleryIndex + (forward ? 1 : -1));
});
reducedMotion.addEventListener('change', syncGallery);
document.addEventListener('visibilitychange', syncGallery);
if ('IntersectionObserver' in window) {
  const galleryObserver = new IntersectionObserver(entries => {
    galleryInView = entries.some(entry => entry.isIntersecting);
    syncGallery();
  }, { threshold: 0.15 });
  galleryObserver.observe($('.gallery-card'));
}
$$('[data-gallery-src]').forEach(button => button.addEventListener('click', () => {
  const image = $('#gallery-lightbox-image');
  image.src = button.dataset.gallerySrc;
  image.alt = button.dataset.galleryAlt;
  $('#gallery-lightbox-caption').textContent = button.dataset.galleryAlt;
  galleryDialog.showModal();
  syncGallery();
}));
$('.lightbox-close').addEventListener('click', () => galleryDialog.close());
galleryDialog.addEventListener('close', syncGallery);
galleryDialog.addEventListener('click', event => {
  if (event.target !== galleryDialog) return;
  const bounds = galleryDialog.getBoundingClientRect();
  if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) galleryDialog.close();
});
syncGallery();

// Optional third-party map: no Google embed request until the visitor explicitly accepts.
$$('a[href="#cookie-policy"]').forEach(link => link.addEventListener('click', () => {
  if ($('#cookie-dialog').open) $('#cookie-dialog').close();
  $('#cookie-policy').open = true;
}));
if (window.location?.hash === '#cookie-policy') $('#cookie-policy').open = true;
const mapFrame = $('#shop-map');
const mapConsent = $('#map-consent');
const mapRevoke = $('#map-revoke');
const COOKIE_CHOICE_KEY = 'zp-cookie-consent-v1';
function savedCookieChoice() {
  try {
    const choice = localStorage.getItem(COOKIE_CHOICE_KEY);
    return ['accepted', 'declined'].includes(choice) ? choice : null;
  } catch { return null; }
}
function setMapConsent(accepted) {
  if (accepted) mapFrame.src = mapFrame.dataset.src;
  else mapFrame.removeAttribute('src');
  mapFrame.hidden = !accepted;
  mapConsent.hidden = accepted;
  mapRevoke.hidden = !accepted;
  try { localStorage.setItem(COOKIE_CHOICE_KEY, accepted ? 'accepted' : 'declined'); } catch { /* Browsers may block storage. */ }
}
$('#map-accept').addEventListener('click', () => {
  setMapConsent(true);
  mapRevoke.focus();
});
mapRevoke.addEventListener('click', () => {
  setMapConsent(false);
  $('#map-accept').focus();
});
const cookieDialog = $('#cookie-dialog');
$('#cookie-accept').addEventListener('click', () => { setMapConsent(true); cookieDialog.close(); });
$('#cookie-decline').addEventListener('click', () => { setMapConsent(false); cookieDialog.close(); });
cookieDialog.addEventListener('cancel', () => setMapConsent(false));
cookieDialog.addEventListener('close', syncGallery);
$('#cookie-settings').addEventListener('click', () => { cookieDialog.showModal(); syncGallery(); });
const cookieChoice = savedCookieChoice();
if (cookieChoice) setMapConsent(cookieChoice === 'accepted');
else cookieDialog.showModal();
syncGallery();

// This form only prepares text. It never submits customer data or claims delivery.
const inquiry = $('#inquiry');
const draftPanel = $('#message-draft');
const formStatus = $('#form-status');
function contactError(value) {
  if (!value.trim()) return '';
  return /^(\+?[\d ()-]{7,24}|[^@\s]+@[^@\s]+\.[^@\s]+)$/.test(value.trim())
    ? '' : 'Enter a phone number or email, or leave this optional field blank.';
}
function validateInquiryField(name) {
  const field = inquiry.elements[name];
  const error = name === 'contact' ? contactError(field.value)
    : field.value.trim().length >= 3 ? '' : 'Tell us about your item or question.';
  field.setAttribute('aria-invalid', String(!!error));
  $('#' + name + '-error').textContent = error;
  return !error;
}
['contact', 'message'].forEach(name => {
  inquiry.elements[name].addEventListener('blur', () => validateInquiryField(name));
});
inquiry.addEventListener('input', () => { draftPanel.hidden = true; formStatus.textContent = ''; });
inquiry.addEventListener('submit', event => {
  event.preventDefault();
  const invalid = ['contact', 'message'].filter(name => !validateInquiryField(name));
  if (invalid.length) {
    draftPanel.hidden = true;
    formStatus.textContent = 'Please check the highlighted field.';
    inquiry.elements[invalid[0]].focus();
    return;
  }
  const name = inquiry.elements.name.value.trim();
  const contact = inquiry.elements.contact.value.trim();
  $('#prepared-message').value = [
    'Hello ZP Gold Trading.',
    name ? 'My name is ' + name + '.' : '',
    inquiry.elements.message.value.trim(),
    contact ? 'You can reach me at ' + contact + '.' : ''
  ].filter(Boolean).join('\n\n');
  draftPanel.hidden = false;
  formStatus.textContent = 'Message prepared, not sent. Copy it and send it on Facebook.';
  $('#prepared-message').focus();
});
$('#copy-message').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('#prepared-message').value);
    formStatus.textContent = 'Copied, not sent. Open Facebook, paste the message, and press Send there.';
  } catch {
    $('#prepared-message').focus();
    $('#prepared-message').select();
    formStatus.textContent = 'Copy the selected message manually, then paste it on Facebook. Nothing has been sent.';
  }
});
