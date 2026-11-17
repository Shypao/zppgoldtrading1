import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('Gold Trading stores and applies per-account panel permissions', async () => {
  const server = await fs.readFile(new URL('../src/server.ts', import.meta.url), 'utf8');
  const app = await fs.readFile(new URL('../public/app.ts', import.meta.url), 'utf8');
  assert.match(server, /permissions TEXT NOT NULL/);
  assert.match(server, /permissions: string\[\]/);
  assert.match(server, /Array\.isArray\(body\.permissions\)/);
  assert.match(app, /tab\.permission/);
  assert.match(app, /currentUser\?\.permissions/);
});
