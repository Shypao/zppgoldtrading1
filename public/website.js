document.getElementById('year').textContent = new Date().getFullYear();

const ratesStatus = document.getElementById('public-rates-status');
const ratesGrid = document.getElementById('public-rates-grid');
const ratesDate = document.getElementById('public-rates-date');
const ratesRetry = document.getElementById('public-rates-retry');
const ratesApi = document.body.dataset.ratesApi || '/api/public-pricing';
const money = value => `PHP ${new Intl.NumberFormat('en-PH').format(Number(value))}/g`;

function renderPublicRates(payload) {
  const groups = Object.entries(payload.rates || {}).filter(([, rates]) => Array.isArray(rates) && rates.length);
  if (!groups.length) throw new Error('No published rates');
  ratesGrid.innerHTML = groups.map(([metal, rates]) => `<section class="public-rate-group"><h3>${metal}</h3><ul class="public-rate-list">${rates.map(rate => `<li class="public-rate-item"><span>${rate.label || rate.key}</span><strong>${money(rate.rate)}</strong></li>`).join('')}</ul></section>`).join('');
  ratesDate.textContent = payload.effectiveDate ? `Effective ${payload.effectiveDate}` : 'Published rate sheet';
  ratesGrid.hidden = false;
  ratesStatus.hidden = true;
}

async function loadPublicRates() {
  ratesRetry.hidden = true;
  ratesStatus.hidden = false;
  ratesStatus.classList.remove('is-error');
  ratesStatus.textContent = 'Loading current rates…';
  try {
    const response = await fetch(ratesApi, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    renderPublicRates(await response.json());
  } catch (error) {
    ratesGrid.hidden = true;
    ratesStatus.hidden = false;
    ratesStatus.classList.add('is-error');
    ratesStatus.textContent = 'Rates currently unavailable. Please try again later.';
    ratesRetry.hidden = false;
    console.error('Public rates unavailable', error);
  }
}

ratesRetry?.addEventListener('click', loadPublicRates);
if (ratesStatus && ratesGrid) loadPublicRates();
