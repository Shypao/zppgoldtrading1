import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Gold cashflow display reads the Central Hub master', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(app, /CENTRAL_CASHFLOW_URL = 'https:\/\/centralhub\.zpmetals\.co\/api\/cashflow'/);
  assert.match(app, /Central Hub master cashflow/);
  assert.match(app, /CENTRAL_CASHFLOW_URL\}\?date=/);
});
