import test from 'node:test';
import assert from 'node:assert/strict';

const { publicPricingPayload, validatePublicDailyRates } = await import('../src/server.ts');

test('public pricing payload does not fall back to internal daily rates', () => {
  const payload = publicPricingPayload({
    dailyFormula: { effectiveDate: '2026-10-19', baseRates: { Gold: 8250 } },
    gold: { base: 8250 }
  });
  assert.deepEqual(payload, {
    effectiveDate: '',
    unit: 'PHP per gram',
    rates: {}
  });
});

test('public pricing payload returns only the independently published sheet', () => {
  const payload = publicPricingPayload({
    dailyFormula: { effectiveDate: '2026-10-19', baseRates: { Gold: 8250 } },
    publicDailyRates: {
      effectiveDate: '2026-10-18',
      rates: { Gold: { '24K': 9000 }, Silver: { '999': 120 }, Platinum: { '999': 3000 } }
    }
  });
  assert.equal(payload.effectiveDate, '2026-10-18');
  assert.deepEqual(payload.rates.Gold, [{ key: '24K', label: '24K', rate: 9000 }]);
});

test('public daily-rate validation rejects incomplete or non-positive sheets', () => {
  assert.equal(validatePublicDailyRates(null), false);
  assert.equal(validatePublicDailyRates({ effectiveDate: '2026-10-19', rates: {} }), false);
  assert.equal(validatePublicDailyRates({ effectiveDate: '2026-10-19', rates: { Gold: { '24K': 9000 } } }), false);
});

test('public daily-rate validation accepts a complete independent sheet', () => {
  assert.equal(validatePublicDailyRates({
    effectiveDate: '2026-10-19',
    rates: {
      Gold: { '24K': 9000, '18K': 6750 },
      Silver: { '999': 120, '925': 111 },
      Platinum: { '999': 3000, '900': 2850 }
    }
  }), true);
});
