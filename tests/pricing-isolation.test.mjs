import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { cp, mkdir, mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import test from 'node:test';
import vm from 'node:vm';

test('internal buying rates ignore published public rates for all metals and custom purity', async () => {
  const source = (await readFile(new URL('../public/app.js', import.meta.url), 'utf8')).replace(/initializeAuth\(\);\s*$/, '');
  const context = vm.createContext({ console });
  vm.runInContext(`${source}\nseedEmptyLedger(); ensureShape();
    db.pricing.publicDailyRates={effectiveDate:'2026-01-01',rates:{Gold:{'24K':9999,'18K':9999,'93%':9999},Silver:{'925':9999},Platinum:{'950':9999}}};
    globalThis.checkRates=()=>['Gold|24K','Gold|18K','Gold|93%','Silver|925','Platinum|950'].map(pair=>{
      const [metal,key]=pair.split('|'); return {actual:activeRate(metal,key).rate,expected:metalRate(metal,key)};
    });`, context);
  for (const rate of context.checkRates()) assert.equal(rate.actual, rate.expected);
});

test('public editor explicitly saves the public scope while ordinary rate saves use internal scope', async () => {
  const source = (await readFile(new URL('../public/app.js', import.meta.url), 'utf8')).replace(/initializeAuth\(\);\s*$/, '');
  const requests = [];
  const context = vm.createContext({
    console, structuredClone, location: { protocol: 'https:' },
    document: { getElementById() { return { value: '9000', remove() {} }; } },
    async fetch(url, options) { requests.push({ url, ...JSON.parse(options.body) }); return { ok: true, async json() { return { revision: 1 }; } }; }
  });
  vm.runInContext(`${source}\nseedEmptyLedger(); ensureShape(); currentUser={role:'admin'};
    render=()=>{}; toast=()=>{};
    if(typeof publicRatesDraft!=='undefined') publicRatesDraft={baseRates:{Gold:9000,Silver:120,Platinum:3000},overrides:{Gold:{},Silver:{},Platinum:{}},goldMultipliers:{}};
    globalThis.publish=savePublicDailyRates; globalThis.saveInternal=savePricingDB;`, context);
  await context.publish();
  assert.equal(requests[0].url, '/api/pricing');
  assert.equal(requests[0].scope, 'public');
  await context.saveInternal();
  assert.equal(requests[1].scope, 'internal');
});

test('pricing API saves public and internal rates independently, including stale ledger saves', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'goldtrading-pricing-isolation-'));
  await mkdir(path.join(directory, 'src'));
  await mkdir(path.join(directory, 'public'));
  await cp(new URL('../src/server.ts', import.meta.url), path.join(directory, 'src/server.ts'));
  await symlink(new URL('../node_modules', import.meta.url).pathname, path.join(directory, 'node_modules'), 'dir');
  const env = { ...process.env, ZPP_ADMIN_PASSWORD: 'IsolationTest@123', ZPP_STAFF_PASSWORD: 'StaffIsolation@123' };
  for (const key of ['VERCEL', 'TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN', 'ZPP_UPSTREAM_URL']) delete env[key];
  const child = spawn(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', `
    import http from 'node:http';
    import { requestHandler } from './src/server.ts';
    globalThis.fetch=()=>{throw new Error('Tests must not fetch internet market prices');};
    const server=http.createServer(requestHandler);
    server.listen(0,'127.0.0.1',()=>console.log('TEST_PORT='+server.address().port));
  `], { cwd: directory, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let errors = '';
  child.stderr.on('data', data => { errors += data; });
  t.after(async () => {
    if (child.exitCode === null) { child.kill(); await once(child, 'exit'); }
    await rm(directory, { recursive: true, force: true });
  });
  const lines = createInterface({ input: child.stdout });
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Test server timed out: ' + errors)), 10000);
    lines.on('line', line => { if (line.startsWith('TEST_PORT=')) { clearTimeout(timer); resolve(Number(line.slice(10))); } });
    child.once('exit', () => { clearTimeout(timer); reject(new Error(errors)); });
  });
  const base = `http://127.0.0.1:${port}`;
  const login = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'IsolationTest@123' }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  for (const method of ['GET', 'POST']) {
    const response = await fetch(base + '/api/market', { method, headers: { Cookie: cookie } });
    assert.equal(response.status, 410, 'internet pricing must remain disabled even for administrators');
  }
  async function api(url, body) {
    const response = await fetch(base + url, { method: body ? 'PUT' : 'GET', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result));
    return result;
  }
  const original = await api('/api/state');
  await api('/api/pricing', { pricing: original.pricing });
  const publicSheet = { effectiveDate: '2026-10-24', rates: { Gold: { '24K': 9000 }, Silver: { '999': 120 }, Platinum: { '999': 3000 } } };
  const publicCandidate = structuredClone(original.pricing);
  publicCandidate.dailyFormula.baseRates.Gold = 1;
  publicCandidate.publicDailyRates = publicSheet;
  await api('/api/pricing', { scope: 'public', pricing: publicCandidate });
  const afterPublic = await api('/api/state');
  const { publicDailyRates: ignoredOriginal, ...originalInternal } = original.pricing;
  const { publicDailyRates: ignoredPublic, ...afterPublicInternal } = afterPublic.pricing;
  assert.deepEqual(afterPublicInternal, originalInternal, 'publishing public rates must preserve every internal setting');
  assert.deepEqual(afterPublic.pricing.publicDailyRates, publicSheet);

  const internalCandidate = structuredClone(original.pricing);
  internalCandidate.dailyFormula.baseRates.Gold = 8000;
  await api('/api/pricing', { pricing: internalCandidate });
  const afterInternal = await api('/api/state');
  assert.equal(afterInternal.pricing.dailyFormula.baseRates.Gold, 8000);
  assert.deepEqual(afterInternal.pricing.publicDailyRates, publicSheet, 'internal saves must preserve the latest published sheet');
  assert.deepEqual((await api('/api/public-pricing')).rates.Gold, [{ key: '24K', label: '24K', rate: 9000 }]);

  afterInternal.pricing.publicDailyRates = null;
  await api('/api/state', afterInternal);
  assert.deepEqual((await api('/api/state')).pricing.publicDailyRates, publicSheet, 'saving a ledger must not overwrite public rates');
});
