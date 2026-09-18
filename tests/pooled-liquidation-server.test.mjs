import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

function validate(state) {
  const script = `
    import { validateLedgerIntegrity } from './src/server.ts';
    try {
      validateLedgerIntegrity(${JSON.stringify(state)});
      process.stdout.write('ok');
    } catch (error) {
      process.stderr.write(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  `;
  return spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '--eval', script], {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8',
    env: { ...process.env, ZPP_UPSTREAM_URL: 'http://unused.invalid' }
  });
}

function emptyState() {
  return { customers: [], stock: [], inventoryPools: [], liquidationBatches: [], liquidations: [], refiningBatches: [], retailSales: [], pricingHistory: [], pricing: null };
}

test('server accepts a partial pooled liquidation while the source keeps its remaining balance', () => {
  const state = emptyState();
  state.stock.push({
    id: 'silver-source', metal: 'Silver', karat: '925', itemType: 'Scrap', status: 'Available',
    netWeight: 2440, currentWeight: 1440, payout: 244194, cost: 144114.49
  });
  state.liquidationBatches.push({
    id: 'LB-0001', name: '925 pooled batch', buyer: 'Silver Buyer', metal: 'Silver',
    lines: [{ itemId: 'silver-source', previousStatus: 'Available', weight: 1000, cost: 100079.51, pooledAllocation: true }]
  });

  const result = validate(state);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'ok');
});

test('server accepts one open liquidation batch containing multiple inventory pools', () => {
  const state = emptyState();
  state.stock.push(
    { id: 'gold-21-a', metal: 'Gold', karat: '21K', itemType: 'Scrap', status: 'Available', inventoryPoolId: 'POOL-21', netWeight: 1, currentWeight: 0, payout: 5000, cost: 0 },
    { id: 'gold-21-b', metal: 'Gold', karat: '21K', itemType: 'Scrap', status: 'Available', inventoryPoolId: 'POOL-21', netWeight: 2, currentWeight: 0, payout: 10000, cost: 0 },
    { id: 'gold-22-a', metal: 'Gold', karat: '22K', itemType: 'Scrap', status: 'Available', inventoryPoolId: 'POOL-22', netWeight: 3, currentWeight: 0, payout: 18000, cost: 0 },
    { id: 'gold-22-b', metal: 'Gold', karat: '22K', itemType: 'Scrap', status: 'Available', inventoryPoolId: 'POOL-22', netWeight: 4, currentWeight: 0, payout: 24000, cost: 0 }
  );
  state.inventoryPools.push(
    { id: 'POOL-21', name: '21K pool', metal: 'Gold', karat: '21K', itemIds: ['gold-21-a', 'gold-21-b'], originalWeight: 3, originalCost: 15000, remainingWeight: 0, remainingCost: 0, onHold: false, status: 'FULLY LIQUIDATED' },
    { id: 'POOL-22', name: '22K pool', metal: 'Gold', karat: '22K', itemIds: ['gold-22-a', 'gold-22-b'], originalWeight: 7, originalCost: 42000, remainingWeight: 0, remainingCost: 0, onHold: false, status: 'FULLY LIQUIDATED' }
  );
  state.liquidationBatches.push({
    id: 'LB-MULTI', name: '21K and 22K pools', buyer: 'Gold Buyer', metal: 'Gold',
    lines: [
      { itemId: 'gold-21-a', previousStatus: 'Available', weight: 1, cost: 5000, pooledAllocation: true, sourcePoolId: 'POOL-21' },
      { itemId: 'gold-21-b', previousStatus: 'Available', weight: 2, cost: 10000, pooledAllocation: true, sourcePoolId: 'POOL-21' },
      { itemId: 'gold-22-a', previousStatus: 'Available', weight: 3, cost: 18000, pooledAllocation: true, sourcePoolId: 'POOL-22' },
      { itemId: 'gold-22-b', previousStatus: 'Available', weight: 4, cost: 24000, pooledAllocation: true, sourcePoolId: 'POOL-22' }
    ]
  });

  const result = validate(state);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'ok');
});

test('legacy zero-balance Pooled records do not block a modern pool move', () => {
  const state = emptyState();
  state.stock.push(
    { id: 'legacy-a', metal: 'Silver', karat: '925', itemType: 'Scrap', status: 'Pooled', netWeight: 100, currentWeight: 0, payout: 10000, cost: 0 },
    { id: 'legacy-b', metal: 'Silver', karat: '925', itemType: 'Scrap', status: 'Pooled', netWeight: 200, currentWeight: 0, payout: 20000, cost: 0 },
    { id: 'modern-a', metal: 'Silver', karat: '925', itemType: 'Scrap', status: 'Available', inventoryPoolId: 'POOL-0002', netWeight: 1000, currentWeight: 500, payout: 100000, cost: 50000 },
    { id: 'modern-b', metal: 'Silver', karat: '925', itemType: 'Scrap', status: 'Available', inventoryPoolId: 'POOL-0002', netWeight: 2000, currentWeight: 1500, payout: 200000, cost: 150000 }
  );
  state.inventoryPools.push(
    {
      id: 'POOL-0001', name: 'Legacy pool', metal: 'Silver', karat: '925', itemIds: ['legacy-a', 'legacy-b'],
      originalWeight: 300, originalCost: 30000, remainingWeight: 300, remainingCost: 30000, status: 'ACTIVE'
    },
    {
      id: 'POOL-0002', name: 'Modern pool', metal: 'Silver', karat: '925', itemIds: ['modern-a', 'modern-b'],
      originalWeight: 3000, originalCost: 300000, remainingWeight: 2000, remainingCost: 200000, onHold: false, status: 'PARTIALLY LIQUIDATED'
    }
  );
  state.liquidationBatches.push({
    id: 'LB-0001', name: 'Modern partial batch', buyer: 'Buyer', metal: 'Silver', poolId: 'POOL-0002',
    lines: [
      { itemId: 'modern-a', previousStatus: 'Available', weight: 500, cost: 50000, pooledAllocation: true },
      { itemId: 'modern-b', previousStatus: 'Available', weight: 500, cost: 50000, pooledAllocation: true }
    ]
  });

  const result = validate(state);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'ok');
});

test('server accepts a correctly labelled mixed-metal liquidation batch', () => {
  const state = emptyState();
  state.stock.push(
    { id: 'gold', metal: 'Gold', karat: '18K', itemType: 'Scrap', status: 'For Liquidation', liquidationBatchId: 'LB-0001', netWeight: 5, currentWeight: 5, payout: 500, cost: 500 },
    { id: 'silver', metal: 'Silver', karat: '925', itemType: 'Scrap', status: 'For Liquidation', liquidationBatchId: 'LB-0001', netWeight: 10, currentWeight: 10, payout: 800, cost: 800 }
  );
  state.liquidationBatches.push({
    id: 'LB-0001', name: 'Mixed batch', buyer: 'Buyer', metal: 'Mixed',
    lines: [
      { itemId: 'gold', previousStatus: 'Available', weight: 5, cost: 500 },
      { itemId: 'silver', previousStatus: 'Available', weight: 10, cost: 800 }
    ]
  });

  const result = validate(state);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'ok');
});

test('server validates an independent manual pool and its remaining balance', () => {
  const state = emptyState();
  state.stock.push(
    { id: 'a', metal: 'Silver', karat: '925', itemType: 'Scrap', status: 'Available', inventoryPoolId: 'POOL-0001', netWeight: 1000, currentWeight: 0, payout: 100000, cost: 0 },
    { id: 'b', metal: 'Silver', karat: '925', itemType: 'Scrap', status: 'Available', inventoryPoolId: 'POOL-0001', netWeight: 2000, currentWeight: 2000, payout: 200000, cost: 200000 }
  );
  state.inventoryPools.push({ id: 'POOL-0001', name: 'Silver reserve', metal: 'Silver', karat: '925', itemIds: ['a', 'b'], originalWeight: 3000, originalCost: 300000, remainingWeight: 2000, remainingCost: 200000, onHold: true, status: 'ON HOLD' });
  state.liquidations.push({ id: 'L-0001', poolId: 'POOL-0001', poolName: 'Silver reserve', metal: 'Silver', releasedWeight: 1000, cost: 100000, proceeds: 110000, lines: [{ itemId: 'a', weight: 1000, costPortion: 100000, pooledAllocation: true }] });

  const result = validate(state);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'ok');
});

test('server accepts a manual pool containing mixed metals and purities', () => {
  const state = emptyState();
  state.stock.push(
    { id: 'gold', metal: 'Gold', karat: '18K', itemType: 'Scrap', status: 'Available', inventoryPoolId: 'POOL-MIXED', netWeight: 100, currentWeight: 100, payout: 500000, cost: 500000 },
    { id: 'silver', metal: 'Silver', karat: '925', itemType: 'Scrap', status: 'Available', inventoryPoolId: 'POOL-MIXED', netWeight: 900, currentWeight: 900, payout: 90000, cost: 90000 }
  );
  state.inventoryPools.push({ id: 'POOL-MIXED', name: 'Mixed reserve', metal: 'Mixed', karat: 'Mixed', itemIds: ['gold', 'silver'], originalWeight: 1000, originalCost: 590000, remainingWeight: 1000, remainingCost: 590000, onHold: true, status: 'ON HOLD' });

  const result = validate(state);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'ok');
});

test('server accepts a merged pool while original stock and liquidation trace remain linked', () => {
  const state = emptyState();
  state.stock.push(
    { id: 'gold-21', metal: 'Gold', karat: '21K', itemType: 'Scrap', status: 'Available', inventoryPoolId: 'POOL-0001', netWeight: 2, currentWeight: 2, payout: 10000, cost: 10000 },
    { id: 'gold-22', metal: 'Gold', karat: '22K', itemType: 'Scrap', status: 'Available', inventoryPoolId: 'POOL-0001', netWeight: 4, currentWeight: 3, payout: 24000, cost: 18000 }
  );
  state.inventoryPools.push({
    id: 'POOL-0001', name: 'Gold combined pool', metal: 'Gold', karat: 'Mixed', itemIds: ['gold-21', 'gold-22'],
    originalWeight: 6, originalCost: 34000, remainingWeight: 5, remainingCost: 28000, onHold: false, status: 'PARTIALLY LIQUIDATED',
    mergedFromPoolIds: ['POOL-0001', 'POOL-0002']
  });
  state.liquidations.push({
    id: 'LQ-MERGED', poolId: 'POOL-0001', originalPoolId: 'POOL-0002', metal: 'Gold', releasedWeight: 1, cost: 6000,
    lines: [{ itemId: 'gold-22', weight: 1, costPortion: 6000, pooledAllocation: true, sourcePoolId: 'POOL-0001', originalSourcePoolId: 'POOL-0002' }]
  });

  const result = validate(state);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'ok');
});

test('server accepts a pool with one remaining member after another item returns to inventory', () => {
  const state = emptyState();
  state.stock.push(
    { id: 'returned', metal: 'Gold', karat: '21K', itemType: 'Scrap', status: 'Available', netWeight: 1, currentWeight: 1, payout: 5000, cost: 5000 },
    { id: 'remaining', metal: 'Gold', karat: '21K', itemType: 'Scrap', status: 'Available', inventoryPoolId: 'POOL-ONE', netWeight: 2, currentWeight: 2, payout: 10000, cost: 10000 }
  );
  state.inventoryPools.push({ id: 'POOL-ONE', name: 'Remaining 21K pool', metal: 'Gold', karat: '21K', itemIds: ['remaining'], originalWeight: 2, originalCost: 10000, remainingWeight: 2, remainingCost: 10000, onHold: false, status: 'ACTIVE' });

  const result = validate(state);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'ok');
});
