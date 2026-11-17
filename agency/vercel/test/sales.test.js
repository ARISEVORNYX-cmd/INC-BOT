'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const sales = require('../api/sales');

const ENV_KEYS = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEY', 'ARI_ALLOWED_EMAIL', 'ARI_ALLOWED_ORIGIN', 'NODE_ENV'];
const OWNER_ID = '6dbe2e9e-b674-40ac-a192-8c7de8542091';

async function withEnv(callback) {
  const saved = Object.fromEntries(ENV_KEYS.map(key => [key, process.env[key]]));
  Object.assign(process.env, {
    SUPABASE_URL: 'https://ari-test.supabase.co',
    SUPABASE_ANON_KEY: 'test-public-key',
    ARI_ALLOWED_EMAIL: 'owner@example.com',
    ARI_ALLOWED_ORIGIN: 'https://ari.example',
    NODE_ENV: 'production'
  });
  try { return await callback(); }
  finally {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

async function withFetch(mock, callback) {
  const saved = global.fetch;
  global.fetch = mock;
  try { return await callback(); }
  finally { global.fetch = saved; }
}

function response(status, payload) {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
}

function resStub() {
  return {
    headers: {}, statusCode: 200,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
    end() { this.ended = true; return this; }
  };
}

async function invoke({ method = 'POST', body = {}, query = {}, authenticated = true } = {}) {
  const req = { method, body, query, headers: { host: 'ari.example', origin: 'https://ari.example', 'x-forwarded-proto': 'https', cookie: authenticated ? 'ari_access=owner-access-token' : '' } };
  const res = resStub();
  await sales(req, res);
  return res;
}

function ownerFetch(url) {
  if (String(url).endsWith('/auth/v1/user')) return response(200, { id: OWNER_ID, email: 'owner@example.com' });
  throw new Error(`Unexpected request ${String(url)}`);
}

test('sales role listing is behind the owner session', async () => {
  await withEnv(() => withFetch(async url => ownerFetch(url), async () => {
    const signedOut = await invoke({ method: 'GET', authenticated: false });
    assert.equal(signedOut.statusCode, 401);
    const allowed = await invoke({ method: 'GET', query: { view: 'departments' } });
    assert.equal(allowed.statusCode, 200);
    assert.equal(allowed.payload.count, 56);
  }));
});

test('sales preview stays draft-only and never persists or sends supplied leads', async () => {
  await withEnv(() => withFetch(async url => ownerFetch(url), async () => {
    const res = await invoke({
      method: 'POST',
      body: {
        goal: 'Qualify an opted-in lead',
        leads: [{ id: 'lead-1', name: 'Sam', company: 'Example Co', title: 'Ops lead', source: 'user supplied', intent: 'exploring', email: 'sam@example.com', email_opt_in: true }],
        channel: 'email'
      }
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.status, 'draft_ready');
    assert.deepEqual(res.payload.external_actions_performed, []);
    assert.ok(res.payload.actions.outreach.every(item => item.sent === false));
    assert.ok(res.payload.actions.crm_operations.every(item => item.applied === false));
  }));
});
