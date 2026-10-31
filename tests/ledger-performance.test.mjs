import assert from 'node:assert/strict';
import test from 'node:test';

process.env.ZPP_UPSTREAM_URL = 'http://unused.invalid';
const { ledgerDeltaStatements } = await import('../src/server.ts');

function fixture(count = 1232) {
  const stock = Array.from({ length: count }, (_, index) => ({ id: `stock-${index}`, metal: 'Gold', currentWeight: 1, cost: 8000 }));
  return {
    state: { customers: [], stock, inventoryPools: [], liquidationBatches: [], liquidations: [], refiningBatches: [], retailSales: [], pricingHistory: [], pricing: null },
    rows: stock.map(record => ({ store: 'stock', id: record.id, data: JSON.stringify(record) }))
  };
}

test('one new receipt item writes only its new record with 1,232 existing purchases', () => {
  const { state, rows } = fixture();
  state.stock.push({ id: 'new-receipt-item', metal: 'Gold', currentWeight: 2, cost: 16000 });
  const statements = ledgerDeltaStatements(state, rows);
  assert.equal(statements.length, 1);
  assert.match(statements[0].sql, /INSERT INTO inventory/);
  assert.equal(statements[0].args[0], 'new-receipt-item');
  assert.equal(rows.length, 1232);
});

test('unchanged ledger produces no record writes', () => {
  const { state, rows } = fixture();
  assert.deepEqual(ledgerDeltaStatements(state, rows), []);
});

test('edited and deleted records do not rewrite unrelated history', () => {
  const { state, rows } = fixture();
  state.stock[0].currentWeight = 0.5;
  state.stock.splice(1, 1);
  const statements = ledgerDeltaStatements(state, rows);
  assert.equal(statements.length, 2);
  assert.equal(statements[0].args[0], 'stock-0');
  assert.equal(statements[1].sql, 'DELETE FROM inventory WHERE id = ?');
  assert.deepEqual(statements[1].args, ['stock-1']);
});
