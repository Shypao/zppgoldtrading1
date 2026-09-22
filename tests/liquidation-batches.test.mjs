import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

async function loadInventoryApi() {
  const source = (await readFile(new URL('../public/app.js', import.meta.url), 'utf8'))
    .replace(/initializeAuth\(\);\s*$/, '');
  const appended = [];
  const document = {
    body: { appendChild(element) { appended.push(element); } },
    createElement() {
      return {
        addEventListener() {},
        querySelector() { return { focus() {} }; },
        remove() {}
      };
    },
    getElementById() { return null; }
  };
  const context = vm.createContext({ console, document, appended, setTimeout() { return 0; }, clearTimeout() {} });
  vm.runInContext(`${source}\n;globalThis.inventoryTestApi = {
    activeInventoryRecord,
    cashflowCardMarkup,
    toggleCashflowCard,
    cashflowDetailSnapshot,
    ensureShape,
    renderBuying,
    renderCustomers,
    renderFeaturedBox,
    renderInventory,
    renderLiquidation,
    renderRefining,
    renderRetail,
    renderRates,
    customerSalesLeaderboard(month, year, rankBy) {
      return JSON.parse(JSON.stringify(customerSalesLeaderboard(month, year, rankBy)));
    },
    toggleCustomerSalesLeaderboard() {
      const originalRender = render;
      render = () => '';
      try {
        toggleCustomerSalesLeaderboard();
        return renderCustomers();
      } finally {
        render = originalRender;
      }
    },
    matchingBuyingCustomerNames(query) {
      return Array.from(matchingBuyingCustomers(query), customer => customer.name);
    },
    rateSheetGoldGradeKeys() {
      const grades = typeof rateSheetGoldGrades === 'function'
        ? rateSheetGoldGrades()
        : GOLD_GRADES.filter(grade => grade.key !== '24K' && grade.key !== '18K-BUO');
      return Array.from(grades, grade => grade.key);
    },
    rateSheetSectionMargins() {
      return { desktop: rateSheetSectionMargin(false), phone: rateSheetSectionMargin(true) };
    },
    prepareLiquidationBatches(items) {
      let message = '';
      const originalToast = toast;
      toast = value => { message = value; };
      pendingInventoryMove = null;
      pendingLiquidationBatchSetup = null;
      openInventoryMoveReview(items, { total: items.length, automatic: false });
      if (pendingInventoryMove) {
        changeInventoryMoveDestination('new');
        confirmInventoryMoveToLiquidation();
      }
      toast = originalToast;
      return JSON.parse(JSON.stringify({ pending: pendingLiquidationBatchSetup, message }));
    },
    prepareSelectedPools(poolIds, weights = {}) {
      inventoryMoveSelection.clear();
      inventoryPoolRowSelection.clear();
      poolIds.forEach(id => inventoryPoolRowSelection.add(id));
      pendingInventoryMove = null;
      pendingLiquidationBatchSetup = null;
      appended.length = 0;
      moveCheckedInventoryToLiquidation();
      const reviewHtml = appended.at(-1)?.innerHTML || '';
      if (pendingInventoryMove) {
        changeInventoryMoveDestination('new');
        pendingInventoryMove.poolWeights = { ...(pendingInventoryMove.poolWeights || {}), ...weights };
        confirmInventoryMoveToLiquidation();
      }
      return JSON.parse(JSON.stringify({ pending: pendingLiquidationBatchSetup, reviewHtml, html: appended.at(-1)?.innerHTML || '' }));
    },
    appendPreparedMoveToBatch(batchId) {
      const batch = db.liquidationBatches.find(record => record.id === batchId);
      const group = pendingLiquidationBatchSetup?.groups?.[0];
      const result = typeof appendInventoryMoveGroupToBatch === 'function' && group
        ? appendInventoryMoveGroupToBatch(batch, group)
        : false;
      return JSON.parse(JSON.stringify({ result, batch, stock: db.stock, pools: db.inventoryPools, batchCount: db.liquidationBatches.length }));
    },
    returnBatchLine(batchId, lineIndex) {
      const batch = db.liquidationBatches.find(record => record.id === batchId);
      const result = typeof detachLiquidationBatchLine === 'function'
        ? detachLiquidationBatchLine(batch, lineIndex)
        : false;
      return JSON.parse(JSON.stringify({ result, batch, stock: db.stock, pools: db.inventoryPools, batches: db.liquidationBatches }));
    },
    stagePoolMoves(poolIds) {
      const batch = { id: 'LB-MULTI-POOL', name: 'Multi pool batch', buyer: 'Buyer', metal: 'Mixed', lines: [] };
      const moves = poolIds.map(id => prepareEntirePoolMove(db.inventoryPools.find(pool => pool.id === id)));
      const result = appendPoolMovesToLiquidationBatch(batch, moves);
      return JSON.parse(JSON.stringify({ result, batch, pools: db.inventoryPools, stock: db.stock }));
    },
    openSaleModal(id) {
      appended.length = 0;
      openCompleteLiquidationBatch(id);
      return appended.at(-1)?.innerHTML || '';
    },
    async completeBatch(batchId, totalSold = 10000) {
      const fields = {
        complete_batch_date: { value: '2026-09-18' },
        complete_batch_total: { value: String(totalSold) },
        complete_batch_payment: { value: 'Paid' },
        complete_batch_notes: { value: '' }
      };
      const originalGetElementById = document.getElementById;
      const originalSaveDB = saveDB;
      const originalRender = render;
      const originalToast = toast;
      document.getElementById = id => fields[id] || null;
      saveDB = async () => true;
      render = () => '';
      toast = () => {};
      try {
        await submitLiquidationBatch(batchId);
      } finally {
        document.getElementById = originalGetElementById;
        saveDB = originalSaveDB;
        render = originalRender;
        toast = originalToast;
      }
      return JSON.parse(JSON.stringify({ batches: db.liquidationBatches, liquidations: db.liquidations, pools: db.inventoryPools, stock: db.stock }));
    },
    openBatchEdit(id) {
      appended.length = 0;
      openLiquidationBatchEdit(id);
      return appended.at(-1)?.innerHTML || '';
    },
    openPoolEdit(id) {
      appended.length = 0;
      openInventoryPoolEdit(id);
      return appended.at(-1)?.innerHTML || '';
    },
    openPoolLiquidation(id) {
      appended.length = 0;
      openPoolLiquidationModal(id);
      return appended.at(-1)?.innerHTML || '';
    },
    openPoolMerge(poolIds) {
      appended.length = 0;
      inventoryPoolRowSelection.clear();
      poolIds.forEach(id => inventoryPoolRowSelection.add(id));
      if (typeof openInventoryPoolMergeModal === 'function') openInventoryPoolMergeModal();
      return appended.at(-1)?.innerHTML || '';
    },
    mergePools(poolIds, name = 'Merged pool') {
      inventoryPoolRowSelection.clear();
      poolIds.forEach(id => inventoryPoolRowSelection.add(id));
      const pools = typeof inventoryPoolMergeSelection === 'function'
        ? inventoryPoolMergeSelection().pools
        : poolIds.map(id => db.inventoryPools.find(pool => pool.id === id)).filter(Boolean);
      const result = typeof mergeInventoryPoolRecords === 'function'
        ? mergeInventoryPoolRecords(pools, name)
        : null;
      return JSON.parse(JSON.stringify({ result, stock: db.stock, pools: db.inventoryPools, batches: db.liquidationBatches, liquidations: db.liquidations }));
    },
    returnPoolMembers(poolId, itemIds) {
      const pool = db.inventoryPools.find(record => record.id === poolId);
      const result = typeof detachInventoryPoolItems === 'function'
        ? detachInventoryPoolItems(pool, itemIds)
        : false;
      return JSON.parse(JSON.stringify({ result, stock: db.stock, pools: db.inventoryPools, batches: db.liquidationBatches, liquidations: db.liquidations }));
    },
    prepareRetailSale(itemId, weight) {
      const item = db.stock.find(record => record.id === itemId);
      const result = typeof prepareRetailSaleAllocation === 'function'
        ? prepareRetailSaleAllocation(item, weight)
        : null;
      return JSON.parse(JSON.stringify(result));
    },
    applyRetailSale(itemId, weight, salePrice = 20000) {
      const item = db.stock.find(record => record.id === itemId);
      const prepared = typeof prepareRetailSaleAllocation === 'function'
        ? prepareRetailSaleAllocation(item, weight)
        : null;
      const result = typeof applyRetailSaleAllocation === 'function' && prepared
        ? applyRetailSaleAllocation(item, prepared, { buyer: 'Retail Buyer', date: '2026-09-18', salePrice })
        : null;
      return JSON.parse(JSON.stringify({ result, item, sales: db.retailSales }));
    },
    openInventoryEdit(id) {
      appended.length = 0;
      openInventoryEdit(id);
      return appended.at(-1)?.innerHTML || '';
    },
    openInventoryRefiningConfirmation(itemIds) {
      appended.length = 0;
      inventoryMoveSelection.clear();
      itemIds.forEach(id => inventoryMoveSelection.add(id));
      prepareInventoryForRefining();
      return JSON.parse(JSON.stringify({
        html: appended.at(-1)?.innerHTML || '',
        pendingIds: pendingInventoryRefiningIds,
        stock: db.stock
      }));
    },
    openExtendPool(poolId, itemIds) {
      appended.length = 0;
      inventoryMoveSelection.clear();
      inventoryPoolRowSelection.clear();
      inventoryPoolRowSelection.add(poolId);
      itemIds.forEach(id => inventoryMoveSelection.add(id));
      openManualInventoryPoolModal();
      return appended.at(-1)?.innerHTML || '';
    },
    openCombineDates() {
      appended.length = 0;
      openCombineLiquidationDateSelection();
      return appended.at(-1)?.innerHTML || '';
    },
    stageInventoryRefining(itemIds) {
      const items = itemIds.map(id => db.stock.find(item => item.id === id)).filter(Boolean);
      const result = stageInventoryForRefining(items);
      return JSON.parse(JSON.stringify({
        result,
        stock: db.stock,
        selectedIds: Array.from(refiningSelection)
      }));
    },
    openIndividualMove(id) {
      appended.length = 0;
      liquidateInventoryItem(id);
      return appended.at(-1)?.innerHTML || '';
    },
    preparePartialItem(id, weight, costBasis) {
      const item = db.stock.find(record => record.id === id);
      return JSON.parse(JSON.stringify(prepareInventoryItemAllocation(item, weight, costBasis)));
    },
    stagePartialItem(id, weight, costBasis) {
      const item = db.stock.find(record => record.id === id);
      const allocation = prepareInventoryItemAllocation(item, weight, costBasis);
      const batch = { id: 'LB-PARTIAL', name: 'Partial item', buyer: 'Buyer', metal: item.metal, lines: [] };
      const result = stageInventoryAllocationsForLiquidation(batch, [allocation]);
      return JSON.parse(JSON.stringify({ result, batch, item }));
    },
    appendToBatch(batchId, itemIds) {
      const batch = db.liquidationBatches.find(record => record.id === batchId);
      const items = itemIds.map(id => db.stock.find(item => item.id === id)).filter(Boolean);
      appendItemsToLiquidationBatch(batch, items);
      return JSON.parse(JSON.stringify({ batch, items, batchCount: db.liquidationBatches.length }));
    },
    allocatePool(itemIds, weight) {
      const items = itemIds.map(id => db.stock.find(item => item.id === id)).filter(Boolean);
      const prepared = preparePooledInventoryAllocation(items, weight);
      if (prepared) prepared.poolItems = items;
      const applied = applyPooledInventoryAllocation(prepared);
      return JSON.parse(JSON.stringify({ prepared, applied, items }));
    },
    preparePoolCost(itemIds, weight, costBasis) {
      const items = itemIds.map(id => db.stock.find(item => item.id === id)).filter(Boolean);
      return JSON.parse(JSON.stringify(preparePooledInventoryAllocation(items, weight, costBasis)));
    },
    restorePool(lines) {
      lines.forEach(restorePooledLiquidationLine);
      return JSON.parse(JSON.stringify(db.stock));
    },
    syncPool(id) {
      const pool = db.inventoryPools.find(item => item.id === id);
      const snapshot = syncInventoryPool(pool);
      return JSON.parse(JSON.stringify({ pool, snapshot }));
    },
    overridePoolEditCost(id, cost) {
      const pool = db.inventoryPools.find(item => item.id === id);
      applyInventoryPoolCostEdit(pool, cost);
      const snapshot = syncInventoryPool(pool);
      return JSON.parse(JSON.stringify({ pool, snapshot, items: inventoryPoolItems(pool) }));
    },
    stagePool(id, weight, details) {
      const pool = db.inventoryPools.find(item => item.id === id);
      const prepared = preparePooledInventoryAllocation(inventoryPoolItems(pool), weight);
      const result = prepared ? stagePoolLiquidationBatch(pool, prepared, details) : null;
      return JSON.parse(JSON.stringify({ result, pool, stock: db.stock, batches: db.liquidationBatches, liquidations: db.liquidations }));
    },
    renderPools() {
      return renderInventory();
    },
    selectedRefiningOutputPurity(purity, customPurity = '') {
      const fields = {
        rf_purity: { value: purity },
        rf_custom_purity: { value: customPurity }
      };
      const originalGetElementById = document.getElementById;
      document.getElementById = id => fields[id] || null;
      try {
        return selectedRefiningOutputPurity();
      } finally {
        document.getElementById = originalGetElementById;
      }
    },
    async clearBuyingDraftWithFields(fields) {
      const originalGetElementById = document.getElementById;
      const originalFetch = globalThis.fetch;
      document.getElementById = id => fields[id] || null;
      globalThis.fetch = async () => ({ ok: true });
      try {
        await clearBuyingDraft();
        return JSON.parse(JSON.stringify(fields));
      } finally {
        document.getElementById = originalGetElementById;
        globalThis.fetch = originalFetch;
      }
    },
    openCashflowResetModal() {
      appended.length = 0;
      if (typeof openCashflowResetConfirmation === 'function') openCashflowResetConfirmation();
      return appended.at(-1)?.innerHTML || '';
    },
    profitPreview(cost, total) {
      const elements = {
        complete_batch_total: { value: total },
        complete_batch_profit: { textContent: '', style: {} },
        complete_batch_profit_margin: { textContent: '', style: {} }
      };
      const originalGetElementById = document.getElementById;
      document.getElementById = id => elements[id] || null;
      updateCompleteLiquidationProfit(cost);
      document.getElementById = originalGetElementById;
      return JSON.parse(JSON.stringify({
        profit: elements.complete_batch_profit,
        margin: elements.complete_batch_profit_margin
      }));
    },
    setState(state) {
      db = state;
      currentUser = { role: 'admin', displayName: 'Admin' };
      inventoryMoveSelection.clear();
      inventoryPoolRowSelection.clear();
      refiningSelection.clear();
      pendingInventoryRefiningIds = [];
      inventorySelectedDate = 'All';
      inventorySearch = '';
      invFilter = { metal: 'All', karat: 'All', type: 'All', status: 'All' };
    },
    setCashflow(snapshot) {
      currentCashflow = snapshot;
      currentUser = { role: 'admin', displayName: 'Admin' };
    },
    setCashflowHistory(snapshot, date) {
      cashflowHistorySnapshot = snapshot;
      cashflowHistoryDate = date;
    },
    setBuyingDraft(form) {
      buyingDraftForm = form;
    },
    setPurchaseBatch(items) {
      purchaseBatch = JSON.parse(JSON.stringify(items));
    },
    updatePurchaseBatchItemRemarks(id, value) {
      updatePurchaseBatchItemRemarks(id, value);
      return JSON.parse(JSON.stringify(purchaseBatch));
    },
    renderPurchaseBatchPanelMarkup() {
      return renderPurchaseBatchPanelMarkup();
    },
    today() {
      return todayStr();
    },
    cashflowDate(value) {
      return typeof cashflowDateStr === 'function' ? cashflowDateStr(new Date(value)) : null;
    }
  };`, context);
  return context.inventoryTestApi;
}

test('cashflow day rolls over at 4:00 AM Manila time', async () => {
  const api = await loadInventoryApi();
  assert.equal(api.cashflowDate('2026-09-12T19:59:59.000Z'), '2026-09-12');
  assert.equal(api.cashflowDate('2026-09-12T20:00:00.000Z'), '2026-09-13');
});

function stateFixture() {
  return {
    customers: [],
    stock: [
      { id: 'stock-on-hand', date: '2026-09-11', customerName: 'On Hand Seller', metal: 'Gold', karat: '18K', itemType: 'Jewelry', status: 'Available', currentWeight: 10, netWeight: 10, cost: 1000, remarks: '' },
      { id: 'stock-transit-a', date: '2026-09-11', customerName: 'Transit Seller A', metal: 'Gold', karat: '18K', itemType: 'Jewelry', status: 'For Liquidation', liquidationBatchId: 'LB-0001', currentWeight: 5, netWeight: 5, cost: 500, remarks: '' },
      { id: 'stock-transit-b', date: '2026-09-11', customerName: 'Transit Seller B', metal: 'Silver', karat: '925', itemType: 'Scrap', status: 'For Liquidation', liquidationBatchId: 'LB-0002', currentWeight: 20, netWeight: 20, cost: 800, remarks: '' }
    ],
    liquidationBatches: [
      { id: 'LB-0001', name: '18K batch', buyer: 'Gold Buyer', metal: 'Gold', buyerOffer: 650, createdAt: '2026-09-11T08:00:00.000Z', lines: [{ itemId: 'stock-transit-a', previousStatus: 'Available', weight: 5, cost: 500 }] },
      { id: 'LB-0002', name: 'Silver batch', buyer: 'Silver Buyer', metal: 'Silver', buyerOffer: 900, createdAt: '2026-09-11T09:00:00.000Z', lines: [{ itemId: 'stock-transit-b', previousStatus: 'For Refining', weight: 20, cost: 800 }] }
    ],
    inventoryPools: [],
    liquidations: [],
    refiningBatches: [],
    retailSales: [],
    pricingHistory: [],
    pricing: { gold: { base: 0, overrides: {} }, silver: { base: 0, overrides: {} }, platinum: { base: 0, overrides: {} }, auto: {}, gradeMultipliers: {}, dailyFormula: { baseRates: {} } }
  };
}

test('legacy For Selling inventory migrates to Available', async () => {
  const api = await loadInventoryApi();
  const state = stateFixture();
  state.stock[0].status = 'For Selling';
  api.setState(state);
  api.ensureShape();

  assert.equal(state.stock[0].status, 'Available');
});

test('Refine selected asks for confirmation before changing inventory status', async () => {
  const api = await loadInventoryApi();
  const state = stateFixture();
  api.setState(state);

  const preview = api.openInventoryRefiningConfirmation(['stock-on-hand']);

  assert.match(preview.html, /Move 1 item to Refining\?/);
  assert.match(preview.html, /automatically be classified as <strong>For Refining<\/strong>/);
  assert.match(preview.html, /Confirm &amp; open Refining/);
  assert.deepEqual(Array.from(preview.pendingIds), ['stock-on-hand']);
  assert.equal(state.stock[0].status, 'Available');
});

test('confirmed refining selection automatically stages checked inventory for Refining', async () => {
  const api = await loadInventoryApi();
  const state = stateFixture();
  state.stock[0].status = 'On Hold';
  api.setState(state);

  const staged = api.stageInventoryRefining(['stock-on-hand']);

  assert.equal(staged.result.metal, 'Gold');
  assert.deepEqual(Array.from(staged.result.itemIds), ['stock-on-hand']);
  assert.equal(staged.stock.find(item => item.id === 'stock-on-hand').status, 'For Refining');
  assert.deepEqual(Array.from(staged.selectedIds), ['stock-on-hand']);
});

test('Refine selected does not combine different metals into one refining selection', async () => {
  const api = await loadInventoryApi();
  const state = stateFixture();
  state.stock.push({ id: 'silver-on-hand', date: '2026-09-11', customerName: 'Silver Seller', metal: 'Silver', karat: '925', itemType: 'Scrap', status: 'Available', currentWeight: 5, netWeight: 5, cost: 500, remarks: '' });
  api.setState(state);

  const preview = api.openInventoryRefiningConfirmation(['stock-on-hand', 'silver-on-hand']);

  assert.equal(preview.html, '');
  assert.deepEqual(Array.from(preview.pendingIds), []);
  assert.equal(state.stock[0].status, 'Available');
  assert.equal(state.stock.at(-1).status, 'Available');
});

test('refining output accepts a custom karat or purity without changing preset options', async () => {
  const api = await loadInventoryApi();
  api.setState(stateFixture());

  const html = api.renderRefining();
  assert.match(html, /<option value="__custom__">Custom karat \/ purity<\/option>/);
  assert.match(html, /id="rf_custom_purity"/);
  assert.equal(api.selectedRefiningOutputPurity('24K'), '24K');
  assert.equal(api.selectedRefiningOutputPurity('__custom__', '23K'), '23K');
  assert.equal(api.selectedRefiningOutputPurity('__custom__', ' 99.9% '), '99.9%');
});

test('individual liquidation movement accepts a configurable partial weight', async () => {
  const api = await loadInventoryApi();
  const state = stateFixture();
  Object.assign(state.stock[0], { currentWeight: 2.47, netWeight: 2.47, cost: 15339 });
  api.setState(state);

  const modal = api.openIndividualMove('stock-on-hand');
  const allocation = api.preparePartialItem('stock-on-hand', 1);

  assert.match(modal, /Enter the exact weight to move/);
  assert.match(modal, /id="inventory_move_weight_stock-on-hand"/);
  assert.match(modal, /of 2\.47 g available/);
  assert.match(modal, /Select a liquidation destination/);
  assert.match(modal, /id="inventory_move_continue"[^>]*disabled/);
  assert.match(modal, /Create new liquidation batch/);
  assert.match(modal, /Add to existing open batch · LB-0001/);
  assert.match(modal, /Cost basis \(PHP\)/);
  assert.match(modal, /Reset automatic cost/);
  assert.doesNotMatch(modal, /id="inventory_move_cost_stock-on-hand"[^>]*max=/);
  assert.equal(allocation.weight, 1);
  assert.equal(allocation.cost, 6210.12);
  assert.equal(allocation.partialAllocation, true);
  assert.equal(allocation.pooledAllocation, true);
});

test('a single inventory liquidation can use an overridden cost basis', async () => {
  const api = await loadInventoryApi();
  const state = stateFixture();
  Object.assign(state.stock[0], { currentWeight: 4, netWeight: 4, cost: 40000 });
  api.setState(state);

  const partial = api.preparePartialItem('stock-on-hand', 1.5, 18000);
  const entire = api.preparePartialItem('stock-on-hand', 4, 44000);

  assert.equal(partial.automaticCost, 15000);
  assert.equal(partial.cost, 18000);
  assert.equal(partial.remainingCost, 22000);
  assert.equal(partial.costBasisOverridden, true);
  assert.equal(entire.cost, 44000);
  assert.equal(entire.costBasisOverridden, true);
  assert.equal(api.preparePartialItem('stock-on-hand', 1, 40001), null);

  const stagedEntire = api.stagePartialItem('stock-on-hand', 4, 44000);
  assert.equal(stagedEntire.result, true);
  assert.equal(stagedEntire.batch.lines[0].cost, 44000);
  assert.equal(stagedEntire.item.cost, 44000);
  assert.equal(stagedEntire.item.status, 'For Liquidation');
});

test('staging a partial item keeps its proportional balance in current inventory', async () => {
  const api = await loadInventoryApi();
  const state = stateFixture();
  Object.assign(state.stock[0], { currentWeight: 2.47, netWeight: 2.47, cost: 15339 });
  api.setState(state);

  const staged = api.stagePartialItem('stock-on-hand', 1);

  assert.equal(staged.result, true);
  assert.equal(staged.batch.lines[0].weight, 1);
  assert.equal(staged.batch.lines[0].cost, 6210.12);
  assert.equal(staged.item.currentWeight, 1.47);
  assert.equal(staged.item.cost, 9128.88);
  assert.equal(staged.item.status, 'Available');
  assert.equal(staged.item.liquidationBatchId, undefined);
});

test('retail jewelry can be sold by partial weight with proportional inventory cost', async () => {
  const api = await loadInventoryApi();
  const state = stateFixture();
  Object.assign(state.stock[0], { itemType: 'Jewelry', currentWeight: 4, netWeight: 4, cost: 40000 });
  state.retailSales = [];
  api.setState(state);

  const retailHtml = api.renderRetail();
  assert.match(retailHtml, /id="rt_weight"/);
  assert.match(retailHtml, /Cost basis \(automatic\)/);
  assert.match(retailHtml, /updateRetailSalePreview\(\)/);

  const prepared = api.prepareRetailSale('stock-on-hand', 1.5);
  assert.equal(prepared.weight, 1.5);
  assert.equal(prepared.cost, 15000);
  assert.equal(prepared.remainingWeight, 2.5);
  assert.equal(prepared.remainingCost, 25000);

  const applied = api.applyRetailSale('stock-on-hand', 1.5, 18000);
  assert.equal(applied.result.weight, 1.5);
  assert.equal(applied.result.cost, 15000);
  assert.equal(applied.result.margin, 3000);
  assert.equal(applied.result.partialAllocation, true);
  assert.equal(applied.item.currentWeight, 2.5);
  assert.equal(applied.item.cost, 25000);
  assert.equal(applied.item.status, 'Available');
  assert.equal(applied.sales.length, 1);
});

test('For Liquidation records are excluded from Current Inventory', async () => {
  const api = await loadInventoryApi();
  const state = stateFixture();
  api.setState(state);

  assert.equal(api.activeInventoryRecord(state.stock[0]), true);
  assert.equal(api.activeInventoryRecord(state.stock[1]), false);
  const html = api.renderInventory();
  assert.match(html, /On Hand Seller/);
  assert.doesNotMatch(html, /Transit Seller A/);
  assert.doesNotMatch(html, /Transit Seller B/);
  assert.match(html, />1<\/div><div class="sub">active records across all dates/);
});

test('Liquidation view renders independent batches and their totals', async () => {
  const api = await loadInventoryApi();
  api.setState(stateFixture());
  const html = api.renderLiquidation();

  assert.match(html, /18K batch/);
  assert.match(html, /Gold Buyer/);
  assert.match(html, /Silver batch/);
  assert.match(html, /Silver Buyer/);
  assert.match(html, /Total inventory cost/);
  assert.doesNotMatch(html, /Buyer offer/i);
  assert.match(html, /PHP 500/);
  assert.match(html, /PHP 800/);
});

test('a mixed Gold and Silver selection stays in one liquidation batch', async () => {
  const api = await loadInventoryApi();
  const state = stateFixture();
  const gold = state.stock[0];
  const silver = { ...state.stock[0], id: 'stock-on-hand-silver', metal: 'Silver', karat: '999', customerName: 'Silver Seller' };
  state.stock = [gold, silver];
  state.liquidationBatches = [];
  api.setState(state);

  const result = api.prepareLiquidationBatches([gold, silver]);

  assert.equal(result.message, '');
  assert.deepEqual(JSON.parse(JSON.stringify(result.pending.groups)), [
    { metal: 'Mixed', ids: ['stock-on-hand', 'stock-on-hand-silver'] }
  ]);
});

test('editing a batch offers available inventory from other metals', async () => {
  const api = await loadInventoryApi();
  const state = stateFixture();
  state.stock.push({ id: 'stock-silver-new', date: '2026-09-12', customerName: 'New Silver Seller', metal: 'Silver', karat: '925', itemType: 'Scrap', status: 'Available', currentWeight: 4, netWeight: 4, cost: 300 });
  api.setState(state);

  const html = api.openBatchEdit('LB-0001');

  assert.match(html, /\+ Add New Item/);
  assert.match(html, /Current batch items/);
  assert.match(html, /returnLiquidationBatchItem\('LB-0001',0\)/);
  assert.match(html, />Return to Inventory</);
  assert.match(html, /New Silver Seller/);
  assert.match(html, /Available individual inventory and pooled inventory/);
});

test('returning a normal liquidation batch item restores it and closes an empty batch', async () => {
  const api = await loadInventoryApi();
  const state = stateFixture();
  api.setState(state);

  const result = api.returnBatchLine('LB-0001', 0);

  assert.equal(result.result, true);
  assert.equal(result.stock.find(item => item.id === 'stock-transit-a').status, 'Available');
  assert.equal(result.stock.find(item => item.id === 'stock-transit-a').liquidationBatchId, undefined);
  assert.equal(result.batches.some(batch => batch.id === 'LB-0001'), false);
});

test('returning one pooled batch line restores its pool balance and keeps other batch items', async () => {
  const api = await loadInventoryApi();
  const state = stateFixture();
  state.stock = [
    { id: 'pool-a', date: '2026-09-18', customerName: 'Seller', metal: 'Gold', karat: '21K', itemType: 'Scrap', status: 'Available', inventoryPoolId: 'POOL-21', netWeight: 1, currentWeight: 0, cost: 0 },
    { id: 'pool-b', date: '2026-09-18', customerName: 'Seller', metal: 'Gold', karat: '21K', itemType: 'Scrap', status: 'Available', inventoryPoolId: 'POOL-21', netWeight: 1, currentWeight: 0, cost: 0 }
  ];
  state.inventoryPools = [{ id: 'POOL-21', name: '21K pool', metal: 'Gold', karat: '21K', itemIds: ['pool-a', 'pool-b'], originalWeight: 2, originalCost: 2, remainingWeight: 0, remainingCost: 0, onHold: false, status: 'FULLY LIQUIDATED' }];
  state.liquidationBatches = [{ id: 'LB-POOL', name: 'Pool batch', buyer: 'Buyer', metal: 'Gold', lines: [
    { itemId: 'pool-a', previousStatus: 'Available', weight: 1, cost: 1, pooledAllocation: true, sourcePoolId: 'POOL-21' },
    { itemId: 'pool-b', previousStatus: 'Available', weight: 1, cost: 1, pooledAllocation: true, sourcePoolId: 'POOL-21' }
  ] }];
  api.setState(state);

  const result = api.returnBatchLine('LB-POOL', 0);

  assert.equal(result.result, true);
  assert.equal(result.batch.lines.length, 1);
  assert.equal(result.stock.find(item => item.id === 'pool-a').currentWeight, 1);
  assert.equal(result.stock.find(item => item.id === 'pool-a').cost, 1);
  assert.equal(result.pools[0].remainingWeight, 1);
  assert.equal(result.pools[0].remainingCost, 1);
  assert.equal(result.pools[0].status, 'PARTIALLY LIQUIDATED');
});

test('adding Silver to a Gold batch converts it to Mixed and preserves both lines', async () => {
  const api = await loadInventoryApi();
  const state = stateFixture();
  state.stock.push({ id: 'stock-silver-new', date: '2026-09-12', customerName: 'Silver Seller', metal: 'Silver', karat: '925', itemType: 'Scrap', status: 'Available', currentWeight: 4, netWeight: 4, cost: 300 });
  api.setState(state);

  const result = api.appendToBatch('LB-0001', ['stock-silver-new']);

  assert.equal(result.batch.metal, 'Mixed');
  assert.deepEqual(JSON.parse(JSON.stringify(result.batch.lines.map(line => line.itemId))), ['stock-transit-a', 'stock-silver-new']);
  assert.equal(result.items[0].status, 'For Liquidation');
  assert.equal(result.items[0].liquidationBatchId, 'LB-0001');
});

test('partial pooled Silver liquidation uses mean cost and keeps the running balance', async () => {
  const api = await loadInventoryApi();
  const state = stateFixture();
  state.stock = [
    { id: 'silver-a', date: '2026-09-10', customerName: 'Seller A', metal: 'Silver', karat: '925', itemType: 'Scrap', status: 'Available', netWeight: 1000, currentWeight: 1000, payout: 95000, cost: 95000 },
    { id: 'silver-b', date: '2026-09-11', customerName: 'Seller B', metal: 'Silver', karat: '925', itemType: 'Scrap', status: 'Available', netWeight: 1440, currentWeight: 1440, payout: 149194, cost: 149194 }
  ];
  state.liquidationBatches = [];
  api.setState(state);

  const result = api.allocatePool(['silver-a', 'silver-b'], 1000);

  assert.equal(result.applied, true);
  assert.equal(result.prepared.totalWeight, 2440);
  assert.equal(result.prepared.totalCost, 244194);
  assert.equal(result.prepared.weight, 1000);
  assert.equal(result.prepared.cost, 100079.51);
  assert.equal(result.prepared.remainingWeight, 1440);
  assert.equal(result.prepared.remainingCost, 144114.49);
  assert.equal(result.items.reduce((sum, item) => sum + item.currentWeight, 0), 1440);
  assert.equal(result.items.reduce((sum, item) => sum + item.cost, 0), 144114.49);
  assert.equal(result.items.reduce((sum, item) => sum + item.netWeight, 0), 2440);
  assert.equal(result.items.reduce((sum, item) => sum + item.payout, 0), 244194);

  const restored = api.restorePool(result.prepared.allocations);
  assert.equal(restored.reduce((sum, item) => sum + item.currentWeight, 0), 2440);
  assert.equal(restored.reduce((sum, item) => sum + item.cost, 0), 244194);
});

test('pool liquidation can use an overridden cost basis while preserving the remaining balance', async () => {
  const api = await loadInventoryApi();
  const state = stateFixture();
  state.stock = [
    { id: 'silver-a', metal: 'Silver', karat: '925', itemType: 'Scrap', status: 'Available', inventoryPoolId: 'POOL-SILVER', netWeight: 1000, currentWeight: 1000, payout: 100000, cost: 100000 },
    { id: 'silver-b', metal: 'Silver', karat: '925', itemType: 'Scrap', status: 'Available', inventoryPoolId: 'POOL-SILVER', netWeight: 1000, currentWeight: 1000, payout: 100000, cost: 100000 }
  ];
  api.setState(state);

  const prepared = api.preparePoolCost(['silver-a', 'silver-b'], 500, 60000);

  assert.equal(prepared.weight, 500);
  assert.equal(prepared.automaticCost, 50000);
  assert.equal(prepared.cost, 60000);
  assert.equal(prepared.remainingWeight, 1500);
  assert.equal(prepared.remainingCost, 140000);
  assert.equal(prepared.costBasisOverridden, true);
  assert.equal(api.preparePoolCost(['silver-a', 'silver-b'], 500, 200001), null);
  const entire = api.preparePoolCost(['silver-a', 'silver-b'], 2000, 220000);
  assert.equal(entire.cost, 220000);
  assert.equal(entire.remainingWeight, 0);
  assert.equal(entire.remainingCost, 0);
});

test('a manually created On Hold pool stays On Hold after partial liquidation', async () => {
  const api = await loadInventoryApi();
  const state = stateFixture();
  state.stock = [
    { id: 'pool-a', date: '2026-09-10', metal: 'Silver', karat: '925', itemType: 'Scrap', status: 'Available', inventoryPoolId: 'POOL-0001', netWeight: 1000, currentWeight: 1000, payout: 100000, cost: 100000 },
    { id: 'pool-b', date: '2026-09-11', metal: 'Silver', karat: '925', itemType: 'Scrap', status: 'Available', inventoryPoolId: 'POOL-0001', netWeight: 2000, currentWeight: 2000, payout: 200000, cost: 200000 }
  ];
  state.inventoryPools = [{ id: 'POOL-0001', name: 'Silver reserve', metal: 'Silver', karat: '925', itemIds: ['pool-a', 'pool-b'], originalWeight: 3000, originalCost: 300000, onHold: true }];
  state.liquidationBatches = [];
  api.setState(state);

  const allocation = api.allocatePool(['pool-a', 'pool-b'], 1000);
  const result = api.syncPool('POOL-0001');

  assert.equal(allocation.prepared.cost, 100000);
  assert.equal(result.pool.status, 'ON HOLD');
  assert.equal(result.pool.remainingWeight, 2000);
  assert.equal(result.pool.remainingCost, 200000);
  assert.match(api.renderPools(), /Silver reserve/);
  assert.match(api.renderPools(), /On Hold/);
  assert.match(api.renderPools(), /Liquidate Pool/);
});

test('manual pools remain independent when one pool is partially liquidated', async () => {
  const api = await loadInventoryApi();
  const state = stateFixture();
  state.stock = [
    { id: 'a-1', metal: 'Silver', karat: '925', itemType: 'Scrap', status: 'Available', inventoryPoolId: 'POOL-0001', netWeight: 3000, currentWeight: 3000, payout: 300000, cost: 300000 },
    { id: 'a-2', metal: 'Silver', karat: '925', itemType: 'Scrap', status: 'Available', inventoryPoolId: 'POOL-0001', netWeight: 1, currentWeight: 1, payout: 100, cost: 100 },
    { id: 'b-1', metal: 'Silver', karat: '925', itemType: 'Scrap', status: 'Available', inventoryPoolId: 'POOL-0002', netWeight: 1000, currentWeight: 1000, payout: 100000, cost: 100000 },
    { id: 'b-2', metal: 'Silver', karat: '925', itemType: 'Scrap', status: 'Available', inventoryPoolId: 'POOL-0002', netWeight: 500, currentWeight: 500, payout: 50000, cost: 50000 }
  ];
  state.inventoryPools = [
    { id: 'POOL-0001', name: 'Pool A', metal: 'Silver', karat: '925', itemIds: ['a-1', 'a-2'], originalWeight: 3001, originalCost: 300100, onHold: true },
    { id: 'POOL-0002', name: 'Pool B', metal: 'Silver', karat: '925', itemIds: ['b-1', 'b-2'], originalWeight: 1500, originalCost: 150000, onHold: false }
  ];
  state.liquidationBatches = [];
  api.setState(state);

  api.allocatePool(['a-1', 'a-2'], 1000);
  const poolA = api.syncPool('POOL-0001');
  const poolB = api.syncPool('POOL-0002');

  assert.equal(poolA.pool.remainingWeight, 2001);
  assert.equal(poolB.pool.remainingWeight, 1500);
  assert.equal(poolB.pool.remainingCost, 150000);
  assert.equal(poolB.pool.status, 'ACTIVE');
});

test('two selected pools are prepared together in one liquidation batch', async () => {
  const api = await loadInventoryApi();
  const state = stateFixture();
  state.stock = [
    { id: '21-a', date: '2026-09-17', customerName: 'Pool 21K', metal: 'Gold', karat: '21K', itemType: 'Scrap', status: 'Available', inventoryPoolId: 'POOL-21', netWeight: 1, currentWeight: 1, cost: 5000 },
    { id: '21-b', date: '2026-09-17', customerName: 'Pool 21K', metal: 'Gold', karat: '21K', itemType: 'Scrap', status: 'Available', inventoryPoolId: 'POOL-21', netWeight: 2, currentWeight: 2, cost: 10000 },
    { id: '22-a', date: '2026-09-17', customerName: 'Pool 22K', metal: 'Gold', karat: '22K', itemType: 'Scrap', status: 'Available', inventoryPoolId: 'POOL-22', netWeight: 3, currentWeight: 3, cost: 18000 },
    { id: '22-b', date: '2026-09-17', customerName: 'Pool 22K', metal: 'Gold', karat: '22K', itemType: 'Scrap', status: 'Available', inventoryPoolId: 'POOL-22', netWeight: 4, currentWeight: 4, cost: 24000 }
  ];
  state.inventoryPools = [
    { id: 'POOL-21', name: '21K pool', metal: 'Gold', karat: '21K', itemIds: ['21-a', '21-b'], originalWeight: 3, originalCost: 15000, remainingWeight: 3, remainingCost: 15000, onHold: false, status: 'ACTIVE' },
    { id: 'POOL-22', name: '22K pool', metal: 'Gold', karat: '22K', itemIds: ['22-a', '22-b'], originalWeight: 7, originalCost: 42000, remainingWeight: 7, remainingCost: 42000, onHold: false, status: 'ACTIVE' }
  ];
  state.liquidationBatches = [];
  api.setState(state);

  const { pending } = api.prepareSelectedPools(['POOL-21', 'POOL-22']);
  assert.equal(pending.groups.length, 1);
  assert.equal(pending.groups[0].metal, 'Gold');
  assert.deepEqual(Array.from(pending.groups[0].poolMoves, move => move.poolId), ['POOL-21', 'POOL-22']);

  const staged = api.stagePoolMoves(['POOL-21', 'POOL-22']);
  assert.equal(staged.result, true);
  assert.equal(staged.batch.lines.length, 4);
  assert.equal(staged.batch.metal, 'Gold');
  assert.equal(staged.stock.reduce((sum, item) => sum + item.currentWeight, 0), 0);
  assert.equal(staged.pools.every(pool => pool.status === 'FULLY LIQUIDATED'), true);
});

test('selected pools accept independent partial weights before liquidation movement', async () => {
  const api = await loadInventoryApi();
  const state = stateFixture();
  state.stock.push(
    { id: '21-a', date: '2026-09-17', customerName: 'Pool 21K', metal: 'Gold', karat: '21K', itemType: 'Scrap', status: 'Available', inventoryPoolId: 'POOL-21', netWeight: 3, currentWeight: 3, cost: 15000 },
    { id: '22-a', date: '2026-09-17', customerName: 'Pool 22K', metal: 'Gold', karat: '22K', itemType: 'Scrap', status: 'Available', inventoryPoolId: 'POOL-22', netWeight: 4, currentWeight: 4, cost: 24000 }
  );
  state.inventoryPools = [
    { id: 'POOL-21', name: '21K pool', metal: 'Gold', karat: '21K', itemIds: ['21-a'], originalWeight: 3, originalCost: 15000, remainingWeight: 3, remainingCost: 15000, onHold: false, status: 'ACTIVE' },
    { id: 'POOL-22', name: '22K pool', metal: 'Gold', karat: '22K', itemIds: ['22-a'], originalWeight: 4, originalCost: 24000, remainingWeight: 4, remainingCost: 24000, onHold: false, status: 'ACTIVE' }
  ];
  api.setState(state);

  const { pending, reviewHtml, html } = api.prepareSelectedPools(['POOL-21', 'POOL-22'], { 'POOL-21': 1, 'POOL-22': 2 });

  assert.match(reviewHtml, /inventory_move_pool_weight_POOL-21/);
  assert.match(reviewHtml, /inventory_move_pool_weight_POOL-22/);
  assert.match(reviewHtml, /Select a liquidation destination/);
  assert.match(reviewHtml, /Create new liquidation batch/);
  assert.match(reviewHtml, /Add to existing open batch · LB-0001/);
  assert.match(html, /Add to existing open batch/);
  assert.equal(pending.groups[0].poolMoves[0].prepared.weight, 1);
  assert.equal(pending.groups[0].poolMoves[0].prepared.cost, 5000);
  assert.equal(pending.groups[0].poolMoves[1].prepared.weight, 2);
  assert.equal(pending.groups[0].poolMoves[1].prepared.cost, 12000);
});

test('inventory selection can append partial pools to an existing open batch', async () => {
  const api = await loadInventoryApi();
  const state = stateFixture();
  state.stock.push(
    { id: 'pool-21-a', date: '2026-09-17', customerName: '21K pool', metal: 'Gold', karat: '21K', itemType: 'Scrap', status: 'Available', inventoryPoolId: 'POOL-21', netWeight: 1.5, currentWeight: 1.5, cost: 7500 },
    { id: 'pool-21-b', date: '2026-09-17', customerName: '21K pool', metal: 'Gold', karat: '21K', itemType: 'Scrap', status: 'Available', inventoryPoolId: 'POOL-21', netWeight: 1.5, currentWeight: 1.5, cost: 7500 }
  );
  state.inventoryPools = [
    { id: 'POOL-21', name: '21K pool', metal: 'Gold', karat: '21K', itemIds: ['pool-21-a', 'pool-21-b'], originalWeight: 3, originalCost: 15000, remainingWeight: 3, remainingCost: 15000, onHold: false, status: 'ACTIVE' }
  ];
  api.setState(state);
  api.prepareSelectedPools(['POOL-21'], { 'POOL-21': 1 });

  const result = api.appendPreparedMoveToBatch('LB-0001');

  assert.equal(result.result, true);
  assert.equal(result.batchCount, 2);
  assert.equal(result.batch.lines.length, 2);
  assert.equal(result.batch.lines.at(-1).weight, 1);
  assert.equal(result.batch.lines.at(-1).cost, 5000);
  assert.equal(result.stock.filter(item => item.inventoryPoolId === 'POOL-21').reduce((sum, item) => sum + item.currentWeight, 0), 2);
  assert.equal(result.stock.filter(item => item.inventoryPoolId === 'POOL-21').reduce((sum, item) => sum + item.cost, 0), 10000);
  assert.equal(result.pools[0].remainingWeight, 2);
  assert.equal(result.pools[0].remainingCost, 10000);
});

test('Edit batch Add New Item lists available inventory pools', async () => {
  const api = await loadInventoryApi();
  const state = stateFixture();
  state.stock.push(
    { id: 'pool-21-a', date: '2026-09-17', customerName: 'Pool 21K', metal: 'Gold', karat: '21K', itemType: 'Scrap', status: 'Available', inventoryPoolId: 'POOL-21', netWeight: 1, currentWeight: 1, cost: 5000 },
    { id: 'pool-21-b', date: '2026-09-17', customerName: 'Pool 21K', metal: 'Gold', karat: '21K', itemType: 'Scrap', status: 'Available', inventoryPoolId: 'POOL-21', netWeight: 2, currentWeight: 2, cost: 10000 }
  );
  state.inventoryPools = [{ id: 'POOL-21', name: '21K pool', metal: 'Gold', karat: '21K', itemIds: ['pool-21-a', 'pool-21-b'], originalWeight: 3, originalCost: 15000, remainingWeight: 3, remainingCost: 15000, onHold: false, status: 'ACTIVE' }];
  api.setState(state);

  const modal = api.openBatchEdit('LB-0001');
  assert.match(modal, /Available individual inventory and pooled inventory/);
  assert.match(modal, /data-open-batch-add-id="pool:POOL-21"/);
  assert.match(modal, /21K pool/);
});

test('a manual pool may combine mixed metals and purities', async () => {
  const api = await loadInventoryApi();
  const state = stateFixture();
  state.stock = [
    { id: 'mixed-gold', metal: 'Gold', karat: '18K', itemType: 'Scrap', status: 'Available', inventoryPoolId: 'POOL-0003', netWeight: 100, currentWeight: 100, payout: 500000, cost: 500000 },
    { id: 'mixed-silver', metal: 'Silver', karat: '925', itemType: 'Scrap', status: 'Available', inventoryPoolId: 'POOL-0003', netWeight: 900, currentWeight: 900, payout: 90000, cost: 90000 }
  ];
  state.inventoryPools = [{ id: 'POOL-0003', name: 'Mixed reserve', metal: 'Mixed', karat: 'Mixed', itemIds: ['mixed-gold', 'mixed-silver'], originalWeight: 1000, originalCost: 590000, onHold: true }];
  api.setState(state);

  const allocation = api.allocatePool(['mixed-gold', 'mixed-silver'], 500);
  const result = api.syncPool('POOL-0003');

  assert.equal(allocation.prepared.cost, 295000);
  assert.equal(result.pool.remainingWeight, 500);
  assert.equal(result.pool.remainingCost, 295000);
  assert.match(api.renderPools(), /Mixed reserve/);
  assert.match(api.renderPools(), /metal-tag mixed/);
});

test('inventory offers manual Pool selected and the Combine dates liquidation action', async () => {
  const api = await loadInventoryApi();
  api.setState(stateFixture());
  const html = api.renderInventory();
  assert.match(html, /Pool selected/);
  assert.doesNotMatch(html, /Pool Gold \/ Silver/);
  assert.match(html, /openCombineLiquidationDateSelection\(\)[^>]*>Combine dates</);

  const modal = api.openCombineDates();
  assert.match(modal, /Select purchase dates/);
  assert.match(modal, /Review selected dates/);
});

test('inventory displays a pool as one available row with combined weight and cost', async () => {
  const api = await loadInventoryApi();
  const state = stateFixture();
  state.stock = [
    { id: 'pool-a', date: '2026-09-17', customerName: 'Seller A', metal: 'Silver', karat: '925', itemType: 'Scrap', status: 'Available', inventoryPoolId: 'POOL-0003', netWeight: 1000, currentWeight: 1000, payout: 100000, cost: 100000 },
    { id: 'pool-b', date: '2026-09-17', customerName: 'Seller B', metal: 'Silver', karat: '925', itemType: 'Scrap', status: 'Available', inventoryPoolId: 'POOL-0003', netWeight: 2000, currentWeight: 2000, payout: 200000, cost: 200000 }
  ];
  state.inventoryPools = [{ id: 'POOL-0003', name: 'Silver pool', metal: 'Silver', karat: '925', itemIds: ['pool-a', 'pool-b'], originalWeight: 3000, originalCost: 300000, onHold: false, status: 'ACTIVE', remainingWeight: 3000, remainingCost: 300000, createdAt: '2026-09-17T00:00:00.000Z' }];
  api.setState(state);

  const html = api.renderInventory();

  assert.equal((html.match(/>Silver pool</g) || []).length, 1, 'the pool should be rendered as one visible inventory row');
  assert.match(html, /POOL-0003/);
  assert.match(html, /3000\.00 g/);
  assert.match(html, /PHP 300,000/);
  assert.match(html, />Available</);
  assert.match(html, /Liquidate Pool/);
  assert.match(html, /openInventoryPoolEdit\('POOL-0003'\)[^>]*>Edit</);
  assert.match(html, /toggleInventoryPoolSelection\('POOL-0003',this\.checked\)/);
  assert.doesNotMatch(html, /Put On Hold/);
  assert.doesNotMatch(html, /Seller A|Seller B/);
  assert.doesNotMatch(html, /Inventory Pools/);
  assert.doesNotMatch(html, /Manage this item through/);

  const editModal = api.openPoolEdit('POOL-0003');
  assert.match(editModal, /Edit pooled inventory/);
  assert.match(editModal, /id="edit_pool_date"/);
  assert.match(editModal, /id="edit_pool_status"/);
  assert.match(editModal, /id="edit_pool_karat"/);
  assert.match(editModal, /<option value="925" selected>925<\/option>/);
  assert.match(editModal, /<option value="999"/);
  assert.match(editModal, /<option value="900"/);
  assert.match(editModal, /id="edit_pool_weight"/);
  assert.match(editModal, /id="edit_pool_cost"/);
  assert.match(editModal, /id="edit_pool_remarks"/);
  assert.match(editModal, /Pool items/);
  assert.match(editModal, /data-pool-return-item-id="pool-a"/);
  assert.match(editModal, /data-pool-return-item-id="pool-b"/);
  assert.match(editModal, /Return selected to Inventory/);

  const liquidationModal = api.openPoolLiquidation('POOL-0003');
  assert.match(liquidationModal, /Liquidation destination/);
  assert.match(liquidationModal, /Select a liquidation destination/);
  assert.match(liquidationModal, /Create new liquidation batch/);
  assert.match(liquidationModal, /Add to existing open batch/);
  assert.match(liquidationModal, /id="pool_liquidation_cost"/);
  assert.doesNotMatch(liquidationModal, /id="pool_liquidation_cost"[^>]*max=/);
  assert.match(liquidationModal, /Automatic from the pool mean cost\. You may override it\./);
  assert.match(liquidationModal, /Reset automatic cost/);
});

test('editing a pool can raise its remaining cost for a later liquidation', async () => {
  const api = await loadInventoryApi();
  const state = stateFixture();
  state.stock = [
    { id: 'pool-a', date: '2026-09-19', customerName: 'Seller A', metal: 'Gold', karat: '21K', itemType: 'Scrap', status: 'Available', inventoryPoolId: 'POOL-OVERRIDE', netWeight: 40, currentWeight: 40, cost: 4000 },
    { id: 'pool-b', date: '2026-09-19', customerName: 'Seller B', metal: 'Gold', karat: '21K', itemType: 'Scrap', status: 'Available', inventoryPoolId: 'POOL-OVERRIDE', netWeight: 60, currentWeight: 60, cost: 6000 }
  ];
  state.inventoryPools = [{ id: 'POOL-OVERRIDE', name: '21K reserve', metal: 'Gold', karat: '21K', itemIds: ['pool-a', 'pool-b'], originalWeight: 100, originalCost: 10000, onHold: false }];
  api.setState(state);

  const result = api.overridePoolEditCost('POOL-OVERRIDE', 11000);

  assert.equal(result.items.reduce((sum, item) => sum + item.cost, 0), 11000);
  assert.equal(result.pool.originalCost, 11000);
  assert.equal(result.pool.remainingCost, 11000);
});

test('checked inventory pools can be reviewed and merged into one available pool', async () => {
  const api = await loadInventoryApi();
  const state = stateFixture();
  state.stock = [
    { id: 'pool-a', date: '2026-09-17', customerName: 'Seller A', metal: 'Gold', karat: '21K', itemType: 'Scrap', status: 'Available', inventoryPoolId: 'POOL-0001', netWeight: 2, currentWeight: 2, cost: 10000 },
    { id: 'pool-b', date: '2026-09-18', customerName: 'Seller B', metal: 'Gold', karat: '22K', itemType: 'Scrap', status: 'Available', inventoryPoolId: 'POOL-0002', netWeight: 3, currentWeight: 3, cost: 18000 }
  ];
  state.inventoryPools = [
    { id: 'POOL-0001', name: '21K pool', metal: 'Gold', karat: '21K', itemIds: ['pool-a'], originalItems: [{ itemId: 'pool-a', originalWeight: 2, originalCost: 10000 }], originalWeight: 2, originalCost: 10000, remainingWeight: 2, remainingCost: 10000, onHold: false, status: 'ACTIVE' },
    { id: 'POOL-0002', name: '22K pool', metal: 'Gold', karat: '22K', itemIds: ['pool-b'], originalItems: [{ itemId: 'pool-b', originalWeight: 3, originalCost: 18000 }], originalWeight: 3, originalCost: 18000, remainingWeight: 3, remainingCost: 18000, onHold: false, status: 'ACTIVE' }
  ];
  api.setState(state);

  const inventoryHtml = api.renderInventory();
  assert.match(inventoryHtml, /id="inventory_merge_pools"[^>]*disabled[^>]*>Merge selected pools</);

  const modalHtml = api.openPoolMerge(['POOL-0001', 'POOL-0002']);
  assert.match(modalHtml, /Merge 2 selected pools/);
  assert.match(modalHtml, /5\.00 g/);
  assert.match(modalHtml, /PHP 28,000/);
  assert.match(modalHtml, /Confirm merge/);
  assert.match(modalHtml, /POOL-0001 will remain as the pool ID/);

  const reverseSelection = api.mergePools(['POOL-0002', 'POOL-0001'], 'Reverse selection pool');
  assert.equal(reverseSelection.result.id, 'POOL-0002', 'the first checked pool ID must survive');
});

test('merging pools preserves stock history and remaps liquidation pool references', async () => {
  const api = await loadInventoryApi();
  const state = stateFixture();
  state.stock = [
    { id: 'pool-a', date: '2026-09-17', customerName: 'Seller A', metal: 'Gold', karat: '21K', itemType: 'Scrap', status: 'Available', inventoryPoolId: 'POOL-0001', netWeight: 2, currentWeight: 2, cost: 10000 },
    { id: 'pool-b', date: '2026-09-18', customerName: 'Seller B', metal: 'Gold', karat: '22K', itemType: 'Scrap', status: 'Available', inventoryPoolId: 'POOL-0002', netWeight: 4, currentWeight: 3, cost: 18000 }
  ];
  state.inventoryPools = [
    { id: 'POOL-0001', name: '21K pool', metal: 'Gold', karat: '21K', itemIds: ['pool-a'], originalItems: [{ itemId: 'pool-a', originalWeight: 2, originalCost: 10000 }], originalWeight: 2, originalCost: 10000, remainingWeight: 2, remainingCost: 10000, onHold: false, status: 'ACTIVE' },
    { id: 'POOL-0002', name: '22K pool', metal: 'Gold', karat: '22K', itemIds: ['pool-b'], originalItems: [{ itemId: 'pool-b', originalWeight: 4, originalCost: 24000 }], originalWeight: 4, originalCost: 24000, remainingWeight: 3, remainingCost: 18000, onHold: false, status: 'PARTIALLY LIQUIDATED' }
  ];
  state.liquidationBatches = [{ id: 'LB-POOL', name: 'Earlier pool move', buyer: 'Gold Buyer', metal: 'Gold', poolId: 'POOL-0002', poolIds: ['POOL-0002'], lines: [{ itemId: 'pool-b', sourcePoolId: 'POOL-0002', weight: 1, cost: 6000, pooledAllocation: true, previousStatus: 'Available' }] }];
  state.liquidations = [{ id: 'LQ-POOL', poolId: 'POOL-0002', poolIds: ['POOL-0002'], lines: [{ itemId: 'pool-b', sourcePoolId: 'POOL-0002', weight: 1, cost: 6000 }] }];
  api.setState(state);

  const merged = api.mergePools(['POOL-0001', 'POOL-0002'], 'Gold combined pool');

  assert.equal(merged.result.id, 'POOL-0001');
  assert.equal(merged.pools.length, 1);
  assert.equal(merged.pools[0].name, 'Gold combined pool');
  assert.deepEqual(Array.from(merged.pools[0].itemIds), ['pool-a', 'pool-b']);
  assert.deepEqual(Array.from(merged.pools[0].mergedFromPoolIds), ['POOL-0001', 'POOL-0002']);
  assert.deepEqual(Array.from(merged.pools[0].mergedPoolHistory, pool => pool.name), ['21K pool', '22K pool']);
  assert.equal(merged.pools[0].originalWeight, 6);
  assert.equal(merged.pools[0].originalCost, 34000);
  assert.equal(merged.pools[0].remainingWeight, 5);
  assert.equal(merged.pools[0].remainingCost, 28000);
  assert.equal(merged.pools[0].status, 'PARTIALLY LIQUIDATED');
  assert.equal(merged.stock.length, 2, 'original stock records must remain intact');
  assert.equal(merged.stock.every(item => item.inventoryPoolId === 'POOL-0001'), true);
  assert.equal(merged.batches[0].poolId, 'POOL-0001');
  assert.deepEqual(Array.from(merged.batches[0].poolIds), ['POOL-0001']);
  assert.equal(merged.batches[0].lines[0].sourcePoolId, 'POOL-0001');
  assert.equal(merged.batches[0].lines[0].originalSourcePoolId, 'POOL-0002');
  assert.equal(merged.liquidations[0].poolId, 'POOL-0001');

  const completed = await api.completeBatch('LB-POOL', 7000);
  const completedRecord = completed.liquidations.find(record => record.batchId === 'LB-POOL');
  assert.equal(completed.batches.length, 0);
  assert.equal(completedRecord.poolId, 'POOL-0001');
  assert.equal(completedRecord.originalPoolId, 'POOL-0002');
  assert.equal(completedRecord.lines[0].sourcePoolId, 'POOL-0001');
  assert.equal(completedRecord.lines[0].originalSourcePoolId, 'POOL-0002');
});

test('returning selected pool members keeps their remaining balances as available inventory', async () => {
  const api = await loadInventoryApi();
  const state = stateFixture();
  state.stock = [
    { id: 'pool-a', date: '2026-09-17', customerName: 'Seller A', metal: 'Silver', karat: '925', itemType: 'Scrap', status: 'On Hold', inventoryPoolId: 'POOL-0003', netWeight: 1000, currentWeight: 500, payout: 100000, cost: 50000 },
    { id: 'pool-b', date: '2026-09-17', customerName: 'Seller B', metal: 'Silver', karat: '925', itemType: 'Scrap', status: 'On Hold', inventoryPoolId: 'POOL-0003', netWeight: 2000, currentWeight: 2000, payout: 200000, cost: 200000 }
  ];
  state.inventoryPools = [{
    id: 'POOL-0003', name: 'Silver pool', metal: 'Silver', karat: '925', itemIds: ['pool-a', 'pool-b'],
    originalItems: [
      { itemId: 'pool-a', originalWeight: 1000, originalCost: 100000, statusAtPooling: 'Available' },
      { itemId: 'pool-b', originalWeight: 2000, originalCost: 200000, statusAtPooling: 'Available' }
    ],
    originalWeight: 3000, originalCost: 300000, onHold: true, status: 'ON HOLD', remainingWeight: 2500, remainingCost: 250000
  }];
  api.setState(state);

  const result = api.returnPoolMembers('POOL-0003', ['pool-a']);

  assert.equal(result.result, true);
  assert.equal(result.stock[0].inventoryPoolId, undefined);
  assert.equal(result.stock[0].status, 'Available');
  assert.equal(result.stock[0].currentWeight, 500);
  assert.equal(result.stock[0].cost, 50000);
  assert.deepEqual(Array.from(result.pools[0].itemIds), ['pool-b']);
  assert.equal(result.pools[0].originalWeight, 2000);
  assert.equal(result.pools[0].originalCost, 200000);
  assert.equal(result.pools[0].remainingWeight, 2000);
  assert.equal(result.pools[0].remainingCost, 200000);
});

test('returning every pool member deletes the empty pool without deleting inventory history', async () => {
  const api = await loadInventoryApi();
  const state = stateFixture();
  state.stock = [
    { id: 'pool-a', date: '2026-09-17', customerName: 'Seller A', metal: 'Silver', karat: '925', itemType: 'Scrap', status: 'Available', inventoryPoolId: 'POOL-EMPTY', netWeight: 1000, currentWeight: 500, payout: 100000, cost: 50000 },
    { id: 'pool-b', date: '2026-09-17', customerName: 'Seller B', metal: 'Silver', karat: '925', itemType: 'Scrap', status: 'Available', inventoryPoolId: 'POOL-EMPTY', netWeight: 2000, currentWeight: 2000, payout: 200000, cost: 200000 }
  ];
  state.inventoryPools = [{ id: 'POOL-EMPTY', name: 'Silver pool', metal: 'Silver', karat: '925', itemIds: ['pool-a', 'pool-b'], originalWeight: 3000, originalCost: 300000, remainingWeight: 2500, remainingCost: 250000, onHold: false, status: 'PARTIALLY LIQUIDATED' }];
  state.liquidationBatches = [{ id: 'LB-POOL', name: 'Pending pool sale', buyer: 'Buyer', metal: 'Silver', poolId: 'POOL-EMPTY', poolIds: ['POOL-EMPTY'], lines: [{ itemId: 'pool-a', sourcePoolId: 'POOL-EMPTY', weight: 500, cost: 50000, pooledAllocation: true, previousStatus: 'Available' }] }];
  state.liquidations = [{ id: 'LQ-POOL', poolId: 'POOL-EMPTY', poolIds: ['POOL-EMPTY'], lines: [{ itemId: 'pool-a', sourcePoolId: 'POOL-EMPTY', weight: 500, costPortion: 50000, pooledAllocation: true }] }];
  api.setState(state);

  const result = api.returnPoolMembers('POOL-EMPTY', ['pool-a', 'pool-b']);

  assert.equal(result.result, true);
  assert.equal(result.pools.length, 0);
  assert.equal(result.stock.length, 2);
  assert.equal(result.stock.every(item => item.inventoryPoolId === undefined), true);
  assert.equal(result.stock.every(item => item.status === 'Available'), true);
  assert.equal(result.batches[0].poolId, undefined);
  assert.equal(result.batches[0].originalPoolId, 'POOL-EMPTY');
  assert.equal(result.batches[0].lines[0].sourcePoolId, undefined);
  assert.equal(result.batches[0].lines[0].originalSourcePoolId, 'POOL-EMPTY');
  assert.equal(result.liquidations[0].poolId, undefined);
  assert.equal(result.liquidations[0].originalPoolId, 'POOL-EMPTY');
});

test('an existing pool can be checked with matching inventory and remains one pool', async () => {
  const api = await loadInventoryApi();
  const state = stateFixture();
  state.stock = [
    { id: 'pool-a', date: '2026-09-17', customerName: 'Seller A', metal: 'Silver', karat: '925', itemType: 'Scrap', status: 'Available', inventoryPoolId: 'POOL-0003', netWeight: 1000, currentWeight: 1000, payout: 100000, cost: 100000 },
    { id: 'new-silver', date: '2026-09-17', customerName: 'Seller B', metal: 'Silver', karat: '925', itemType: 'Scrap', status: 'Available', netWeight: 500, currentWeight: 500, payout: 50000, cost: 50000 }
  ];
  state.inventoryPools = [{ id: 'POOL-0003', name: 'Silver pool', metal: 'Silver', karat: '925', itemIds: ['pool-a'], originalItems: [], originalWeight: 1000, originalCost: 100000, onHold: false }];
  api.setState(state);

  const modal = api.openExtendPool('POOL-0003', ['new-silver']);

  assert.match(modal, /Add inventory to POOL-0003/);
  assert.match(modal, /New records<\/span><strong>1/);
  assert.match(modal, /1500\.00 g/);
  assert.match(modal, /PHP 150,000\.00/);
  assert.match(modal, />Add to Pool</);
});

test('inventory edit offers a metal-specific karat or purity selector', async () => {
  const api = await loadInventoryApi();
  const state = stateFixture();
  state.stock = [{ id: 'silver-edit', date: '2026-09-17', customerName: 'Seller', metal: 'Silver', karat: '925', itemType: 'Scrap', status: 'Available', netWeight: 113, currentWeight: 113, payout: 8927, cost: 8927 }];
  state.inventoryPools = [];
  api.setState(state);

  const modal = api.openInventoryEdit('silver-edit');

  assert.match(modal, /Edit purchase \/ inventory record/);
  assert.match(modal, /id="edit_inventory_karat"/);
  assert.match(modal, /<option value="999"/);
  assert.match(modal, /<option value="925" selected>925<\/option>/);
  assert.match(modal, /<option value="900"/);
  assert.match(modal, /<option value="800"/);
  assert.match(modal, /<option value="750"[^>]*>75%<\/option>/);
  assert.match(modal, /<option value="600"[^>]*>60%<\/option>/);
});

test('a same-metal pool with several purities keeps Mixed selected when edited', async () => {
  const api = await loadInventoryApi();
  const state = stateFixture();
  state.stock = [
    { id: 'silver-925', date: '2026-09-17', customerName: 'Seller A', metal: 'Silver', karat: '925', itemType: 'Scrap', status: 'Available', inventoryPoolId: 'POOL-0005', netWeight: 500, currentWeight: 500, payout: 50000, cost: 50000 },
    { id: 'silver-999', date: '2026-09-17', customerName: 'Seller B', metal: 'Silver', karat: '999', itemType: 'Scrap', status: 'Available', inventoryPoolId: 'POOL-0005', netWeight: 500, currentWeight: 500, payout: 60000, cost: 60000 }
  ];
  state.inventoryPools = [{ id: 'POOL-0005', name: 'Mixed silver pool', metal: 'Silver', karat: 'Mixed', itemIds: ['silver-925', 'silver-999'], originalWeight: 1000, originalCost: 110000, onHold: false }];
  api.setState(state);

  const modal = api.openPoolEdit('POOL-0005');

  assert.match(modal, /<option value="Mixed" selected>Mixed purities<\/option>/);
  assert.match(modal, /<option value="925"/);
  assert.match(modal, /<option value="999"/);
});

test('partial pool allocation moves to an open liquidation batch before recording a sale', async () => {
  const api = await loadInventoryApi();
  const state = stateFixture();
  state.stock = [
    { id: 'pool-a', date: '2026-09-17', customerName: 'Seller A', metal: 'Silver', karat: '925', itemType: 'Scrap', status: 'Available', inventoryPoolId: 'POOL-0004', netWeight: 1000, currentWeight: 1000, payout: 100000, cost: 100000 },
    { id: 'pool-b', date: '2026-09-17', customerName: 'Seller B', metal: 'Silver', karat: '925', itemType: 'Scrap', status: 'Available', inventoryPoolId: 'POOL-0004', netWeight: 2000, currentWeight: 2000, payout: 200000, cost: 200000 }
  ];
  state.inventoryPools = [{ id: 'POOL-0004', name: 'Silver pool', metal: 'Silver', karat: '925', itemIds: ['pool-a', 'pool-b'], originalWeight: 3000, originalCost: 300000, onHold: false, status: 'ACTIVE', remainingWeight: 3000, remainingCost: 300000 }];
  state.liquidationBatches = [];
  state.liquidations = [];
  api.setState(state);

  const staged = api.stagePool('POOL-0004', 1000, { name: 'Silver partial batch', buyer: 'Buyer A', notes: 'First release' });

  assert.equal(staged.result.batch.id, 'LB-0001');
  assert.equal(staged.result.batch.poolId, 'POOL-0004');
  assert.equal(staged.result.batch.lines.reduce((sum, line) => sum + line.weight, 0), 1000);
  assert.equal(staged.result.batch.lines.reduce((sum, line) => sum + line.cost, 0), 100000);
  assert.equal(staged.result.batch.lines.every(line => line.pooledAllocation === true), true);
  assert.equal(staged.pool.remainingWeight, 2000);
  assert.equal(staged.pool.remainingCost, 200000);
  assert.equal(staged.batches.length, 1);
  assert.equal(staged.liquidations.length, 0, 'moving to Liquidation must not record the final sale');
});

test('record sale modal shows live profit margin fields without buyer offer', async () => {
  const api = await loadInventoryApi();
  api.setState(stateFixture());

  const html = api.openSaleModal('LB-0001');

  assert.match(html, /Total sold \(PHP\)/);
  assert.match(html, /id="complete_batch_profit"/);
  assert.match(html, /id="complete_batch_profit_margin"/);
  assert.match(html, /Profit margin/);
  assert.doesNotMatch(html, /Buyer offer/i);
  assert.match(html, /id="complete_batch_total"[^>]*value=""/);

  const gain = api.profitPreview(500, '650');
  assert.equal(gain.profit.textContent, 'PHP 150');
  assert.equal(gain.margin.textContent, '30.00%');
  assert.equal(gain.profit.style.color, 'var(--sage)');

  const loss = api.profitPreview(500, '400');
  assert.equal(loss.profit.textContent, 'PHP -100');
  assert.equal(loss.margin.textContent, '-20.00%');
  assert.equal(loss.profit.style.color, 'var(--rust)');
});

test('cash-on-hand card never converts a missing synced balance into zero', async () => {
  const api = await loadInventoryApi();
  api.setCashflow({ date: api.cashflowDate(new Date().toISOString()), configured: true, cashOnHand: null, cashIn: 0, cashOut: 0 });

  assert.match(api.cashflowCardMarkup(), /<strong>Not set<\/strong>/);
});

test('admin can open a confirmation before resetting IN and OUT counters', async () => {
  const api = await loadInventoryApi();
  api.setCashflow({ date: api.cashflowDate(new Date().toISOString()), configured: true, cashOnHand: 0, cashIn: 66572, cashOut: 23043 });

  const card = api.cashflowCardMarkup();
  const modal = api.openCashflowResetModal();

  assert.match(card, /Reset IN \/ OUT/);
  assert.match(modal, /Reset IN and OUT to PHP 0/);
  assert.match(modal, /does not delete buying transactions/i);
  assert.match(modal, /Confirm reset/);
});

test('cashflow card can minimize its actions and daily stat blocks', async () => {
  const api = await loadInventoryApi();
  api.setState(stateFixture());

  assert.match(api.cashflowCardMarkup(), />Minimize</);
  assert.match(api.cashflowCardMarkup(), /cashflow-stats/);
  api.toggleCashflowCard();
  const minimized = api.cashflowCardMarkup();
  assert.match(minimized, /is-minimized/);
  assert.match(minimized, />Expand</);
  assert.doesNotMatch(minimized, /cashflow-stats/);
  assert.doesNotMatch(minimized, /View cash flow/);
  assert.match(minimized, /cashflow-flow-strip/);
});

test('cashflow details can use a retrieved historical daily snapshot', async () => {
  const api = await loadInventoryApi();
  api.setCashflow({ date: api.today(), configured: true, cashOnHand: 900 });
  api.setCashflowHistory({ date: '2026-09-09', configured: true, cashOnHand: 1250, transactions: [], adjustments: [] }, '2026-09-09');

  assert.equal(api.cashflowDetailSnapshot().date, '2026-09-09');
  assert.equal(api.cashflowDetailSnapshot().cashOnHand, 1250);
});

test('buying form replaces a legacy stale draft rate with the active daily rate', async () => {
  const api = await loadInventoryApi();
  const state = stateFixture();
  state.pricing.gold.base = 8000;
  state.pricing.dailyFormula = { effectiveDate: api.today(), baseRates: { Gold: 8500 } };
  api.setState(state);
  api.setBuyingDraft({ b_metal: 'Gold', b_karat: '18K', b_rate: '6000' });

  assert.match(api.renderBuying(), /id="b_rate"[^>]*value="6375"/);
});

test('buying form preserves an intentional per-item rate override', async () => {
  const api = await loadInventoryApi();
  const state = stateFixture();
  state.pricing.gold.base = 8000;
  state.pricing.dailyFormula = { effectiveDate: api.today(), baseRates: { Gold: 8500 } };
  api.setState(state);
  api.setBuyingDraft({ b_metal: 'Gold', b_karat: '18K', b_rate: '6200', b_rate_overridden: 'true' });

  const html=api.renderBuying();
  assert.match(html, /id="b_rate"[^>]*value="6200"/);
  assert.match(html, /class="buying-rate is-overridden"/);
});

test('downloadable rate sheets omit 73 percent without removing it from website grades', async () => {
  const api = await loadInventoryApi();
  api.setState(stateFixture());

  assert.equal(api.rateSheetGoldGradeKeys().includes('73%'), false);
  assert.match(api.renderBuying(), /73%/);
});

test('daily rate setup keeps the Gold karat multiplier editor visible to administrators', async () => {
  const api = await loadInventoryApi();
  api.setState(stateFixture());

  assert.match(api.renderRates(), /Edit Gold karat multipliers/);
});

test('clearing a completed buying payout also clears the seller name from the visible form', async () => {
  const api = await loadInventoryApi();
  const fields = {
    b_seller_name: { value: 'Irene Cerna' },
    b_date: { value: '2026-09-22' },
    b_pay: { value: 'GCash' },
    b_metal: { value: 'Silver' },
    b_itemtype: { value: 'Jewelry' },
    b_karat: { value: '925' },
    b_custom_purity: { value: '89' },
    b_gross: { value: '10' },
    b_ded: { value: '1' },
    b_rate: { value: '99' },
    b_payout: { value: '900' },
    b_staff: { value: 'Admin' },
    b_status: { value: 'On Hold' },
    b_remarks: { value: 'Old purchase' }
  };

  const cleared = await api.clearBuyingDraftWithFields(fields);
  assert.equal(cleared.b_seller_name.value, '');
  assert.equal(cleared.b_pay.value, 'Cash');
  assert.equal(cleared.b_metal.value, 'Gold');
  assert.equal(cleared.b_status.value, 'Available');
  assert.equal(cleared.b_remarks.value, '');
});

test('customer sales leaderboard ranks monthly and yearly customer totals', async () => {
  const api = await loadInventoryApi();
  const state = stateFixture();
  state.customers = [
    { id: 'cust-alice', name: 'Alice', contact: '', notes: '' },
    { id: 'cust-ben', name: 'Ben', contact: '', notes: '' }
  ];
  state.stock = [
    { id: 'alice-sep', batchId: 'buy-alice-sep', customerId: 'cust-alice', customerName: 'Alice', date: '2026-09-05', netWeight: 5, payout: 5000 },
    { id: 'alice-aug', batchId: 'buy-alice-aug', customerId: 'cust-alice', customerName: 'Alice', date: '2026-08-04', netWeight: 3, payout: 3000 },
    { id: 'ben-sep-a', batchId: 'buy-ben-sep', customerId: 'cust-ben', customerName: 'Ben', date: '2026-09-02', netWeight: 8, payout: 8000 },
    { id: 'ben-sep-b', batchId: 'buy-ben-sep', customerId: 'cust-ben', customerName: 'Ben', date: '2026-09-02', netWeight: 2, payout: 2000 },
    { id: 'ben-aug', batchId: 'buy-ben-aug', customerId: 'cust-ben', customerName: 'Ben', date: '2026-08-12', netWeight: 1, payout: 1000 },
    { id: 'ben-old', batchId: 'buy-ben-old', customerId: 'cust-ben', customerName: 'Ben', date: '2025-09-02', netWeight: 20, payout: 20000 }
  ];
  api.setState(state);

  const monthly = api.customerSalesLeaderboard('2026-09', '2026', 'monthly');
  assert.equal(monthly[0].customer.name, 'Ben');
  assert.equal(monthly[0].monthly.transactions, 1);
  assert.equal(monthly[0].monthly.items, 2);
  assert.equal(monthly[0].monthly.weight, 10);
  assert.equal(monthly[0].monthly.payout, 10000);
  assert.equal(monthly[0].yearly.transactions, 2);
  assert.equal(monthly[0].yearly.items, 3);
  assert.equal(monthly[0].yearly.weight, 11);
  assert.equal(monthly[0].yearly.payout, 11000);

  const yearly = api.customerSalesLeaderboard('2026-09', '2026', 'yearly');
  assert.equal(yearly[0].customer.name, 'Ben');
  assert.equal(yearly[1].customer.name, 'Alice');
  assert.equal(yearly[1].yearly.payout, 8000);
});

test('customer leaderboard monthly and yearly headers align with payout values', async () => {
  const api = await loadInventoryApi();
  const state = stateFixture();
  state.customers = [{ id: 'cust-alice', name: 'Alice', contact: '', notes: '' }];
  api.setState(state);

  const html = api.renderCustomers();
  assert.match(html, /customer-sales-rank-head/);
  assert.match(html, /customer-sales-rank/);
  assert.match(html, /<th class="num-head">Monthly ·/);
  assert.match(html, /<th class="num-head">Yearly ·/);
  assert.match(html, />Minimize</);
  const minimized = api.toggleCustomerSalesLeaderboard();
  assert.match(minimized, />Expand</);
  assert.doesNotMatch(minimized, /customer_sales_month/);
});

test('downloadable rate sheets add section spacing before Silver and Platinum', async () => {
  const api = await loadInventoryApi();
  const margins = api.rateSheetSectionMargins();

  assert.equal(margins.desktop, 30);
  assert.equal(margins.phone, 56);
});

test('featured buying range does not include customer selection', async () => {
  const api = await loadInventoryApi();
  const state = stateFixture();
  state.customers = [{ id: 'cust-1', name: 'Maria Santos', contact: '', notes: '' }];
  state.pricing.featured = null;
  api.setState(state);

  const html = api.renderFeaturedBox();

  assert.doesNotMatch(html, /fx_customer/);
  assert.doesNotMatch(html, /Customer name/);
  assert.doesNotMatch(html, /Maria Santos/);
});

test('Buying customer information uses a searchable custom suggestion list', async () => {
  const api = await loadInventoryApi();
  const state = stateFixture();
  state.customers = [{ id: 'cust-1', name: 'Maria Santos', contact: '', notes: '' }, { id: 'cust-2', name: 'Mario Reyes', contact: '', notes: '' }];
  api.setState(state);

  const html = api.renderBuying();

  assert.match(html, /Customer Information/);
  assert.match(html, /role="combobox"/);
  assert.match(html, /id="b_customer_suggestions"/);
  assert.match(html, /Leave blank for a walk-in seller/);
  assert.doesNotMatch(html, /<datalist|id="b_customer_choice"/);
  assert.equal(api.matchingBuyingCustomerNames('mari').join('|'), 'Maria Santos|Mario Reyes');
  assert.equal(api.matchingBuyingCustomerNames('unknown').length, 0);
});

test('current payout keeps editable remarks separately for every queued item', async () => {
  const api = await loadInventoryApi();
  api.setState(stateFixture());
  api.setPurchaseBatch([
    { id: 'line-a', metal: 'Gold', karat: '18K', itemType: 'Jewelry', netWeight: 2.5, rate: 6200, payout: 15500, remarks: 'Ring with stone' },
    { id: 'line-b', metal: 'Silver', karat: '925', itemType: 'Scrap', netWeight: 10, rate: 95, payout: 950, remarks: '' }
  ]);

  const html = api.renderPurchaseBatchPanelMarkup();
  assert.match(html, /Remarks for this item/);
  assert.match(html, /id="purchase_item_remarks_line-a"/);
  assert.match(html, /Ring with stone/);
  assert.match(html, /id="purchase_item_remarks_line-b"/);

  const items = api.updatePurchaseBatchItemRemarks('line-b', 'Separate silver lot');
  assert.equal(items[0].remarks, 'Ring with stone');
  assert.equal(items[1].remarks, 'Separate silver lot');
});

test('featured buying range still displays its saved remarks', async () => {
  const api = await loadInventoryApi();
  const state = stateFixture();
  state.pricing.featured = { metal: 'Gold', key: '18K', low: 6200, high: 6400, remarks: 'Clean items only' };
  api.setState(state);

  const html = api.renderFeaturedBox();

  assert.match(html, /Clean items only/);
  assert.doesNotMatch(html, /openFeaturedRemarksEditor/);
  assert.match(html, />Unpin</);
});
