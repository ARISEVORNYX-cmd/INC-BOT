'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const chats = require('../api/chats');
const migration = require('node:fs').readFileSync(require('node:path').join(__dirname, '../../../supabase/migrations/20261116234854_create_ari_personal_memory.sql'), 'utf8');

const OWNER_ID = '6dbe2e9e-b674-40ac-a192-8c7de8542091';
const CONVERSATION_ID = 'c58be96e-197b-43dd-b92e-6718b322ee0f';
const ENV_KEYS = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEY', 'ARI_ALLOWED_EMAIL', 'ARI_ALLOWED_ORIGIN', 'NODE_ENV'];

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
  const body = status === 204 || status === 304 ? null : payload === null ? '' : JSON.stringify(payload);
  return new Response(body, { status, headers: { 'content-type': 'application/json' } });
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

function request({ method = 'GET', query = {}, body = {}, authenticated = true } = {}) {
  return {
    method, query, body,
    headers: {
      host: 'ari.example',
      'x-forwarded-proto': 'https',
      origin: 'https://ari.example',
      cookie: authenticated ? 'ari_access=owner-access-token' : ''
    }
  };
}

async function invoke(options = {}) {
  const res = resStub();
  await chats(request(options), res);
  return res;
}

function defaultFetch(url, options) {
  const target = String(url);
  if (target.endsWith('/auth/v1/user')) return response(200, { id: OWNER_ID, email: 'owner@example.com' });
  throw new Error(`Unexpected request ${target}`);
}

test('chat API rejects signed-out requests before touching private storage', async () => {
  await withEnv(() => withFetch(async () => {
    assert.fail('Signed-out callers must not reach Supabase');
  }, async () => {
    const res = await invoke({ authenticated: false });
    assert.equal(res.statusCode, 401);
    assert.equal(res.payload.error, 'unauthenticated');
  }));
});

test('conversation list is filtered to the verified owner and marked no-store', async () => {
  await withEnv(() => withFetch(async (url, options) => {
    if (String(url).endsWith('/auth/v1/user')) return defaultFetch(url, options);
    assert.match(String(url), /\/rest\/v1\/ari_conversations\?/);
    assert.match(String(url), /owner_id=eq\./);
    assert.equal(options.headers.Authorization, 'Bearer owner-access-token');
    assert.equal(options.headers.apikey, 'test-public-key');
    return response(200, [{ id: CONVERSATION_ID, title: 'My plan', created_at: '2026-11-15T00:00:00Z', updated_at: '2026-11-15T00:01:00Z' }]);
  }, async () => {
    const res = await invoke();
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.conversations.length, 1);
    assert.equal(res.payload.conversations[0].title, 'My plan');
    assert.equal(res.headers['Cache-Control'], 'no-store, max-age=0');
  }));
});

test('message history requires a UUID and only queries the signed-in owner conversation', async () => {
  await withEnv(() => withFetch(async (url, options) => {
    if (String(url).endsWith('/auth/v1/user')) return defaultFetch(url, options);
    assert.match(String(url), /\/rest\/v1\/ari_messages\?/);
    assert.match(String(url), /conversation_id=eq\./);
    assert.match(String(url), /owner_id=eq\./);
    assert.equal(options.headers.Authorization, 'Bearer owner-access-token');
    return response(200, [{ id: 'message-1', role: 'user', content: 'private question', created_at: '2026-11-15T00:01:00Z' }]);
  }, async () => {
    const bad = await invoke({ query: { id: 'not-a-uuid' } });
    assert.equal(bad.statusCode, 400);
    const good = await invoke({ query: { id: CONVERSATION_ID } });
    assert.equal(good.statusCode, 200);
    assert.equal(good.payload.messages[0].content, 'private question');
  }));
});

test('save turn creates one owner-scoped conversation and both messages; service role is never used', async () => {
  await withEnv(() => withFetch(async (url, options) => {
    const target = String(url);
    if (target.endsWith('/auth/v1/user')) return defaultFetch(url, options);
    assert.equal(options.headers.apikey, 'test-public-key');
    assert.equal(options.headers.Authorization, 'Bearer owner-access-token');
    assert.doesNotMatch(options.headers.Authorization, /service_role/i);
    if (target.includes('/rest/v1/ari_conversations?select=')) {
      assert.equal(options.method, 'POST');
      const body = JSON.parse(options.body);
      assert.equal(body.owner_id, OWNER_ID);
      assert.equal(body.title, 'Plan my new studio');
      return response(201, [{ id: CONVERSATION_ID, title: body.title, created_at: '2026-11-15T00:00:00Z', updated_at: '2026-11-15T00:00:00Z' }]);
    }
    if (target.endsWith('/rest/v1/ari_messages')) {
      const body = JSON.parse(options.body);
      assert.equal(body.length, 2);
      assert.deepEqual(body.map(item => item.role), ['user', 'assistant']);
      assert.ok(body.every(item => item.owner_id === OWNER_ID && item.conversation_id === CONVERSATION_ID));
      assert.equal(body[0].content, 'Plan my new studio');
      assert.equal(body[1].content, 'Start with a small brief.');
      return response(201, null);
    }
    if (target.includes('/rest/v1/ari_conversations?')) {
      assert.equal(options.method, 'PATCH');
      return response(204, null);
    }
    throw new Error(`Unexpected request ${target}`);
  }, async () => {
    const res = await invoke({
      method: 'POST',
      body: { action: 'save_turn', question: 'Plan my new studio', answer: 'Start with a small brief.', metadata: { model: 'openrouter/free', source: 'openrouter' } }
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.saved, true);
    assert.equal(res.payload.conversation.id, CONVERSATION_ID);
  }));
});

test('delete is owner-filtered and input/oversize validation happens before a database write', async () => {
  await withEnv(() => withFetch(async (url, options) => {
    if (String(url).endsWith('/auth/v1/user')) return defaultFetch(url, options);
    assert.match(String(url), /\/rest\/v1\/ari_conversations\?/);
    assert.match(String(url), /owner_id=eq\./);
    assert.equal(options.method, 'DELETE');
    return response(200, [{ id: CONVERSATION_ID }]);
  }, async () => {
    const invalid = await invoke({ method: 'POST', body: { action: 'delete', conversation_id: 'bad' } });
    assert.equal(invalid.statusCode, 400);
    const deleted = await invoke({ method: 'POST', body: { action: 'delete', conversation_id: CONVERSATION_ID } });
    assert.equal(deleted.statusCode, 200);
    assert.deepEqual(deleted.payload, { deleted: true });
    const oversized = await invoke({ method: 'POST', body: { action: 'save_turn', question: 'x'.repeat(4001), answer: 'ok' } });
    assert.equal(oversized.statusCode, 400);
  }));
});

test('private memory migration enables RLS and binds every policy to auth.uid()', () => {
  assert.match(migration, /alter table public\.ari_conversations enable row level security/i);
  assert.match(migration, /alter table public\.ari_messages enable row level security/i);
  assert.equal((migration.match(/owner_id = auth\.uid\(\)/g) || []).length, 8);
  assert.match(migration, /revoke all .* from anon, public, authenticated/i);
  assert.doesNotMatch(migration, /grant .* to anon/i);
  assert.match(migration, /references public\.ari_conversations\(id, owner_id\) on delete cascade/i);
});
