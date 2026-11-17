'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const auth = require('../_lib/private-auth');
const handler = require('../api/auth');

const ENV_KEYS = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEY', 'ARI_ALLOWED_EMAIL', 'ARI_ALLOWED_ORIGIN', 'NODE_ENV'];
const OWNER_ID = '6dbe2e9e-b674-40ac-a192-8c7de8542091';

async function withEnv(values, callback) {
  const saved = Object.fromEntries(ENV_KEYS.map(key => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
  Object.assign(process.env, values);
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
  return new Response(payload === null ? '' : JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

function responseStub() {
  return {
    headers: {}, statusCode: 200,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
    end() { this.ended = true; return this; }
  };
}

function reqStub({ method = 'GET', query = {}, body = {}, cookie = '', headers = {} } = {}) {
  return { method, query, body, headers: { cookie, host: 'ari.example', origin: 'https://ari.example', 'x-forwarded-proto': 'https', ...headers } };
}

function baseEnv() {
  return {
    SUPABASE_URL: 'https://ari-test.supabase.co',
    SUPABASE_ANON_KEY: 'test-public-key',
    ARI_ALLOWED_EMAIL: 'Owner@Example.com',
    ARI_ALLOWED_ORIGIN: 'https://ari.example',
    NODE_ENV: 'production'
  };
}

test('protected API auth fails closed when Supabase or owner configuration is missing', async () => {
  await withEnv({}, async () => {
    const res = responseStub();
    const owner = await auth.requireOwner(reqStub({ cookie: 'ari_access=anything' }), res);
    assert.equal(owner, null);
    assert.equal(res.statusCode, 503);
    assert.equal(res.payload.error, 'private_auth_not_configured');
  });
});

test('protected API auth rejects missing cookies without contacting Supabase', async () => {
  await withEnv(baseEnv(), async () => withFetch(async () => {
    assert.fail('No auth cookie must not cause an upstream request');
  }, async () => {
    const res = responseStub();
    const owner = await auth.requireOwner(reqStub(), res);
    assert.equal(owner, null);
    assert.equal(res.statusCode, 401);
    assert.equal(res.payload.error, 'unauthenticated');
    assert.equal(res.headers['Cache-Control'], 'no-store, max-age=0');
  }));
});

test('protected API auth validates Supabase identity and exact owner email server-side', async () => {
  await withEnv(baseEnv(), async () => withFetch(async (url, options) => {
    assert.equal(String(url), 'https://ari-test.supabase.co/auth/v1/user');
    assert.equal(options.headers.apikey, 'test-public-key');
    assert.equal(options.headers.Authorization, 'Bearer valid-access-token');
    return response(200, { id: OWNER_ID, email: 'owner@example.com' });
  }, async () => {
    const res = responseStub();
    const owner = await auth.requireOwner(reqStub({ cookie: 'ari_access=valid-access-token' }), res);
    assert.deepEqual({ id: owner.id, email: owner.email }, { id: OWNER_ID, email: 'owner@example.com' });
    assert.equal(owner.accessToken, 'valid-access-token');
  }));
});

test('an authenticated non-owner is rejected and session cookies are cleared', async () => {
  await withEnv(baseEnv(), async () => withFetch(async () => response(200, {
    id: 'cdb6f671-89b2-49be-a419-44b7672078e0', email: 'other@example.com'
  }), async () => {
    const res = responseStub();
    const owner = await auth.requireOwner(reqStub({ cookie: 'ari_access=valid-access-token; ari_refresh=valid-refresh-token' }), res);
    assert.equal(owner, null);
    assert.equal(res.statusCode, 403);
    assert.equal(res.payload.error, 'owner_only');
    assert.equal(res.headers['Set-Cookie'].length, 2);
    assert.ok(res.headers['Set-Cookie'].every(line => /Max-Age=0/.test(line)));
  }));
});

test('magic sign-in link is sent only for the owner email and redirects to the same origin', async () => {
  await withEnv(baseEnv(), async () => withFetch(async (url, options) => {
    assert.equal(String(url), 'https://ari-test.supabase.co/auth/v1/otp?redirect_to=https%3A%2F%2Fari.example');
    assert.equal(options.headers.apikey, 'test-public-key');
    const body = JSON.parse(options.body);
    assert.deepEqual(body, { email: 'owner@example.com', create_user: true, code_challenge: null, code_challenge_method: null });
    return response(200, {});
  }, async () => {
    const res = responseStub();
    await handler(reqStub({
      method: 'POST',
      body: { action: 'send_link', email: ' Owner@Example.com ' },
      headers: { origin: 'https://ari.example' }
    }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.sent, true);
    assert.match(res.payload.message, /sign-in link/);
    assert.equal(JSON.stringify(res.payload).includes('test-public-key'), false);
    assert.equal(res.headers['Set-Cookie'], undefined);
  }));
});

test('unknown emails receive a generic success response without sending a link', async () => {
  await withEnv(baseEnv(), async () => withFetch(async () => {
    assert.fail('A non-owner email must not be sent a sign-in link');
  }, async () => {
    const res = responseStub();
    await handler(reqStub({ method: 'POST', body: { action: 'send_link', email: 'attacker@example.com' } }), res);
    assert.equal(res.statusCode, 200);
    assert.match(res.payload.message, /If this is the owner email/);
  }));
});

test('state-changing auth endpoint rejects cross-origin browser requests', async () => {
  await withEnv(baseEnv(), async () => withFetch(async () => {
    assert.fail('A cross-origin request must not reach Supabase');
  }, async () => {
    const res = responseStub();
    await handler(reqStub({
      method: 'POST',
      body: { action: 'send_link', email: 'owner@example.com' },
      headers: { origin: 'https://attacker.example' }
    }), res);
    assert.equal(res.statusCode, 403);
    assert.equal(res.payload.error, 'same_origin_required');
  }));
});

test('same-origin validation requires Origin and matches scheme, host, port, and configured origin', async () => {
  await withEnv(baseEnv(), async () => {
    const headers = { host: 'ari.example', 'x-forwarded-proto': 'https' };
    assert.equal(auth.requestIsSameOrigin({ headers }), false);
    assert.equal(auth.requestIsSameOrigin({ headers: { ...headers, origin: 'http://ari.example' } }), false);
    assert.equal(auth.requestIsSameOrigin({ headers: { ...headers, origin: 'https://attacker.example' } }), false);
    assert.equal(auth.requestIsSameOrigin({ headers: { ...headers, origin: 'https://ari.example' } }), true);
    assert.equal(auth.requestIsSameOrigin({ headers: { ...headers, origin: 'https://ari.example:8443' } }), false);
    assert.equal(auth.requestIsSameOrigin({ headers: { ...headers, origin: 'https://ari.example/path' } }), false);
  });
});

test('production same-origin validation fails closed without an exact allowed origin', async () => {
  const values = baseEnv();
  delete values.ARI_ALLOWED_ORIGIN;
  await withEnv(values, async () => {
    const headers = { host: 'ari.example', origin: 'https://ari.example', 'x-forwarded-proto': 'https' };
    assert.equal(auth.requestIsSameOrigin({ headers }), false);
    process.env.ARI_ALLOWED_ORIGIN = 'https://ari.example';
    assert.equal(auth.requestIsSameOrigin({ headers }), true);
    process.env.ARI_ALLOWED_ORIGIN = 'https://ari.example/path';
    assert.equal(auth.requestIsSameOrigin({ headers }), false);
  });
});

test('JSON body parser enforces UTF-8 byte caps and rejects malformed lengths and shapes', () => {
  assert.deepEqual(auth.parseJsonBody({ body: '{\"ok\":true}', headers: { 'content-length': '11' } }, 11), { body: { ok: true } });
  assert.equal(auth.parseJsonBody({ body: Buffer.from('{\"q\":\"🌐\"}') }, 10).error, 'body_too_large');
  assert.equal(auth.parseJsonBody({ body: { q: '🌐' } }, 11).error, 'body_too_large');
  assert.equal(auth.parseJsonBody({ body: '{\"ok\":true}', headers: { 'content-length': '12' } }, 11).error, 'body_too_large');
  assert.equal(auth.parseJsonBody({ body: '{}', headers: { 'content-length': 'many' } }, 11).error, 'invalid_content_length');
  assert.equal(auth.parseJsonBody({ body: '{bad' }, 11).error, 'invalid_json');
  assert.equal(auth.parseJsonBody({ body: [] }, 11).error, 'invalid_json');
});

test('magic-link callback verifies the owner and sets HttpOnly cookies without returning tokens', async () => {
  const secretAccess = 'access-token-test-secret-that-is-long-enough';
  const secretRefresh = 'refresh-token-test-secret-that-is-long-enough';
  await withEnv(baseEnv(), async () => withFetch(async (url, options) => {
    assert.equal(String(url), 'https://ari-test.supabase.co/auth/v1/user');
    assert.equal(options.headers.Authorization, `Bearer ${secretAccess}`);
    return response(200, { id: OWNER_ID, email: 'owner@example.com' });
  }, async () => {
    const res = responseStub();
    await handler(reqStub({
      method: 'POST',
      body: { action: 'exchange_link', access_token: secretAccess, refresh_token: secretRefresh },
      headers: { origin: 'https://ari.example' }
    }), res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.payload, { authenticated: true, user: { id: OWNER_ID, email: 'owner@example.com' } });
    assert.equal(JSON.stringify(res.payload).includes(secretAccess), false);
    assert.equal(JSON.stringify(res.payload).includes(secretRefresh), false);
    assert.equal(res.headers['Set-Cookie'].length, 2);
    assert.ok(res.headers['Set-Cookie'].every(line => /HttpOnly/.test(line) && /Secure/.test(line) && /SameSite=Strict/.test(line) && /Path=\//.test(line)));
  }));
});

test('expired access cookie is refreshed and rotated without revealing tokens', async () => {
  const newAccess = 'rotated-access-token';
  const newRefresh = 'rotated-refresh-token';
  await withEnv(baseEnv(), async () => withFetch(async (url, options) => {
    const target = String(url);
    if (target.endsWith('/auth/v1/user')) return response(401, { message: 'expired' });
    assert.equal(target, 'https://ari-test.supabase.co/auth/v1/token?grant_type=refresh_token');
    assert.deepEqual(JSON.parse(options.body), { refresh_token: 'old-refresh-token' });
    return response(200, {
      access_token: newAccess,
      refresh_token: newRefresh,
      expires_in: 3600,
      user: { id: OWNER_ID, email: 'owner@example.com' }
    });
  }, async () => {
    const res = responseStub();
    const owner = await auth.requireOwner(reqStub({ cookie: 'ari_access=expired-token; ari_refresh=old-refresh-token' }), res);
    assert.equal(owner.accessToken, newAccess);
    assert.equal(owner.email, 'owner@example.com');
    assert.ok(res.headers['Set-Cookie'].some(line => line.includes(encodeURIComponent(newAccess))));
    assert.ok(res.headers['Set-Cookie'].some(line => line.includes(encodeURIComponent(newRefresh))));
  }));
});
