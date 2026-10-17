import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

async function loadDashboardReports() {
  const appPath = new URL('../public/app.js', import.meta.url);
  const source = (await readFile(appPath, 'utf8')).replace(/initializeAuth\(\);\s*$/, '');
  const context = vm.createContext({ console });
  vm.runInContext(`${source}\n;globalThis.dashboardReportsTestApi = {
    renderReports,
    renderDashboard,
    renderInventory,
    todayStr,
    shiftDateKey,
    todayPurchaseMetalSummary,
    dailyMetalPurityBreakdownMarkup,
    purchaseTotalsByPurity,
    setInventoryView(date, metal = 'All') {
      inventoryWeekOffset = 0;
      inventorySelectedDate = date;
      invFilter = { metal, karat: 'All', type: 'All', status: 'All' };
    },
    setState(state) {
      db = state.db;
      currentUser = state.currentUser;
      dashboardReportPanel = state.dashboardReportPanel;
    }
  };`, context);
  return context.dashboardReportsTestApi;
}

function testState(stock, dashboardReportPanel = '') {
  return {
    currentUser: { role: 'admin' },
    dashboardReportPanel,
    db: {
      stock,
      customers: [],
      liquidations: [],
      refiningBatches: [],
      retailSales: [],
      pricingHistory: []
    }
  };
}

test('closed dashboard reports do not format hidden purchase rows', async () => {
  const api = await loadDashboardReports();
  let formattedRows = 0;
  const purchase = {
    id: 'stock-1',
    date: '2026-09-10',
    sourceRefiningBatchId: null,
    currentWeight: 0,
    payout: 100,
    netWeight: 1,
    metal: 'Gold',
    karat: '18K',
    itemType: 'Jewelry',
    status: 'Sold',
    staff: 'Staff',
    batchId: 'batch-1',
    get customerName() {
      formattedRows += 1;
      return 'Example seller';
    }
  };

  api.setState(testState([purchase]));
  api.renderReports();

  assert.equal(formattedRows, 0);
});

test('opening purchase history formats its rows', async () => {
  const api = await loadDashboardReports();
  let formattedRows = 0;
  const purchase = {
    id: 'stock-1',
    date: '2026-09-10',
    sourceRefiningBatchId: null,
    currentWeight: 0,
    payout: 100,
    netWeight: 1,
    metal: 'Gold',
    karat: '18K',
    itemType: 'Jewelry',
    status: 'Sold',
    staff: 'Staff',
    batchId: 'batch-1',
    get customerName() {
      formattedRows += 1;
      return 'Example seller';
    }
  };

  api.setState(testState([purchase], 'purchases'));
  const html = api.renderReports();

  assert.ok(formattedRows > 0);
  assert.match(html, /Example seller/);
});

test('dashboard record labels use Purchase and Liquidation without the history suffix', async () => {
  const api = await loadDashboardReports();
  api.setState(testState([]));

  const html = api.renderReports();
  assert.match(html, /<span>Purchase<\/span>/);
  assert.match(html, /<span>Liquidation<\/span>/);
  assert.doesNotMatch(html, /<span>Purchase history<\/span>/);
  assert.doesNotMatch(html, /<span>Liquidation history<\/span>/);
});

test('dashboard groups only today purchases into clickable metal totals', async () => {
  const api = await loadDashboardReports();
  const today = api.todayStr();
  const stock = [
    { id: 'gold-1', date: today, metal: 'Gold', netWeight: 2.5, payout: 12000 },
    { id: 'gold-2', date: today, metal: 'Gold', netWeight: 1.25, payout: 6000 },
    { id: 'silver-1', date: today, metal: 'Silver', netWeight: 10, payout: 1000 },
    { id: 'old-gold', date: '2000-01-01', metal: 'Gold', netWeight: 100, payout: 999999 }
  ];
  api.setState(testState(stock));

  const html = api.renderDashboard();
  const gold = api.todayPurchaseMetalSummary(stock.filter(item => item.date === today), 'Gold');

  assert.equal(gold.count, 2);
  assert.equal(gold.weight, 3.75);
  assert.equal(gold.payout, 18000);
  assert.match(html, /openTodayMetalPurchases\('Gold'\)/);
  assert.match(html, /PHP 18,000/);
  assert.match(html, /PHP 1,000/);
  assert.doesNotMatch(html, /PHP 999,999/);
});

test('dashboard metal details include totals grouped by purity', async () => {
  const api = await loadDashboardReports();
  const html = api.dailyMetalPurityBreakdownMarkup([
    { metal: 'Gold', karat: '18K', netWeight: 2.5, currentWeight: 2, payout: 10000 },
    { metal: 'Gold', karat: '18K', netWeight: 1.5, currentWeight: 0, payout: 6000 },
    { metal: 'Gold', karat: '14K', netWeight: 3, currentWeight: 3, payout: 9000 }
  ], 'Gold');

  assert.match(html, /Gold totals by purity/);
  assert.match(html, /18K/);
  assert.match(html, /14K/);
  assert.match(html, /4\.00 g/);
  assert.match(html, /PHP 16,000/);
});

test('liquidation readiness defaults to two weeks and sorts newest purchases first', async () => {
  const api = await loadDashboardReports();
  const today = api.todayStr();
  const yesterday = api.shiftDateKey(today, -1);
  const older = api.shiftDateKey(today, -20);
  const readyItem = (id, date, metal) => ({ id, date, metal, karat: '999', itemType: 'Scrap', status: 'Available', currentWeight: 1 });
  api.setState(testState([
    readyItem('older', older, 'Platinum'),
    readyItem('yesterday', yesterday, 'Silver'),
    readyItem('today', today, 'Gold')
  ], 'readiness'));

  const html = api.renderReports();

  assert.match(html, /Last 2 weeks/);
  assert.ok(html.indexOf('Gold') < html.indexOf('Silver'));
  assert.doesNotMatch(html, /Platinum/);
  assert.match(html, /2 of 3 eligible items/);
});

test('daily inventory totals group every purchase by purity including liquidated items', async () => {
  const api = await loadDashboardReports();
  const today = api.todayStr();
  const stock = [
    { id: 'gold-active', date: today, metal: 'Gold', karat: '18K', itemType: 'Scrap', status: 'Available', netWeight: 2.5, currentWeight: 2.5, payout: 10000, cost: 10000 },
    { id: 'gold-liquidated', date: today, metal: 'Gold', karat: '18K', itemType: 'Jewelry', status: 'Liquidated', netWeight: 1.5, currentWeight: 0, payout: 6000, cost: 6000 },
    { id: 'silver-active', date: today, metal: 'Silver', karat: '925', itemType: 'Scrap', status: 'For Refining', netWeight: 10, currentWeight: 10, payout: 1000, cost: 1000 }
  ];
  api.setState(testState(stock));
  api.setInventoryView(today, 'Gold');

  const totals = api.purchaseTotalsByPurity(stock.filter(item => item.metal === 'Gold'));
  const html = api.renderInventory();

  assert.equal(totals.length, 1);
  assert.equal(totals[0].count, 2);
  assert.equal(totals[0].purchasedWeight, 4);
  assert.equal(totals[0].remainingWeight, 2.5);
  assert.equal(totals[0].payout, 16000);
  assert.match(html, /Purchase totals by purity/);
  assert.doesNotMatch(html, /End-of-day/);
  assert.match(html, /Today's All/);
  assert.match(html, /Today's Gold/);
  assert.match(html, /Today's Silver/);
  assert.match(html, /PHP 16,000/);
  assert.match(html, /4\.00 g/);
});

test('current stock breakdown renders distinct metal section headers', async () => {
  const api = await loadDashboardReports();
  api.setState(testState([
    { id: 'gold', date: '2026-09-10', metal: 'Gold', karat: '18K', itemType: 'Scrap', status: 'Available', currentWeight: 5, cost: 1000 },
    { id: 'silver', date: '2026-09-10', metal: 'Silver', karat: '925', itemType: 'Scrap', status: 'Available', currentWeight: 10, cost: 500 },
    { id: 'platinum', date: '2026-09-10', metal: 'Platinum', karat: '900', itemType: 'Scrap', status: 'Available', currentWeight: 2, cost: 800 }
  ]));
  api.setInventoryView('All');

  const html = api.renderInventory();

  assert.match(html, /class="inventory-breakdown-metal-header inventory-breakdown-metal-header--gold"/);
  assert.match(html, /class="inventory-breakdown-metal-header inventory-breakdown-metal-header--silver"/);
  assert.match(html, /class="inventory-breakdown-metal-header inventory-breakdown-metal-header--platinum"/);
});

test('inventory summary cards align with the full inventory content width', async () => {
  const indexPath = new URL('../public/index.html', import.meta.url);
  const source = await readFile(indexPath, 'utf8');

  assert.match(source, /\.low-karat-card\{[^}]*width:100%/);
  assert.match(source, /\.table-wrap\.inventory-breakdown\{width:100%;max-width:none/);
  assert.match(source, /\.inventory-breakdown-total\{width:100%/);
  assert.doesNotMatch(source, /\.low-karat-card\{[^}]*1080px/);
  assert.doesNotMatch(source, /\.inventory-breakdown-total\{width:min\(100%,1080px\)/);
});

test('inventory summary uses compact refining controls and aligned numeric columns', async () => {
  const indexPath = new URL('../public/index.html', import.meta.url);
  const source = await readFile(indexPath, 'utf8');

  assert.match(source, /\.low-karat-card\{[^}]*padding:10px 14px/);
  assert.match(source, /\.low-karat-card \.btn\{padding:8px 14px/);
  assert.match(source, /\.inventory-breakdown th\.num-head\{text-align:right/);
});

test('inventory breakdown groups its heading, table, and total into one card', async () => {
  const api = await loadDashboardReports();
  api.setState(testState([
    { id: 'gold', date: '2026-09-10', metal: 'Gold', karat: '18K', itemType: 'Scrap', status: 'Available', currentWeight: 5, cost: 1000 }
  ]));
  api.setInventoryView('All');

  const html = api.renderInventory();

  assert.match(html, /<div class="inventory-breakdown-card">/);
  assert.match(html, /inventory-breakdown-intro/);
  assert.match(html, /inventory-breakdown-card[\s\S]*inventory-breakdown[\s\S]*inventory-breakdown-total/);
});

test('stock records content uses the full inventory width', async () => {
  const indexPath = new URL('../public/index.html', import.meta.url);
  const source = await readFile(indexPath, 'utf8');

  assert.match(source, /\.inventory-stock-head\{width:100%;max-width:none/);
  assert.match(source, /\.inventory-action-panel\{width:100%;max-width:none/);
  assert.match(source, /#inventory_stock_list \.table-wrap\{width:100%;max-width:none/);
});

test('stock records table keeps its column headers visible while scrolling', async () => {
  const indexPath = new URL('../public/index.html', import.meta.url);
  const source = await readFile(indexPath, 'utf8');

  assert.match(source, /#inventory_stock_list \.table-wrap thead th\{[^}]*position:sticky/);
  assert.match(source, /#inventory_stock_list \.table-wrap thead th\{[^}]*top:0/);
});
