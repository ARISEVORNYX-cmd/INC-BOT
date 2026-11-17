'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { test } = require('node:test');
const auth = require('../_lib/private-auth');
const handler = require('../api/auth');

const ENV_KEYS = [
  'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEY',
  'ARI_ALLOWED_EMAIL', 'ARI_ALLOWED_ORIGIN', 'NODE_ENV'
];
const USER_A_ID = '6dbe2e9e-b674-40ac-a192-8c7de8542091';
const USER_B_ID = 'cdb6f671-89b2-49be-a419-44b7672078e0';

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
  const body = status === 204 || status === 304 ? null : payload === null ? '' : JSON.stringify(payload);
  return new Response(body, { status, headers: { 'content-type': 'application/json' } });
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
  return {
    method, query, body,
    headers: { cookie, host: 'ari.example', origin: 'https://ari.example', 'x-forwarded-proto': 'https', ...headers }
  };
}

function baseEnv() {
  return {
    SUPABASE_URL: 'https://ari-test.supabase.co',
    SUPABASE_ANON_KEY: 'test-public-key',
    // Legacy allowlist is deliberately set to a different address; it must not block free accounts.
    ARI_ALLOWED_EMAIL: 'owner@example.com',
    ARI_ALLOWED_ORIGIN: 'https://ari.example',
    NODE_ENV: 'production'
  };
}

const userA = { id: USER_A_ID, email: 'a@example.net', email_confirmed_at: '2026-11-15T00:00:00Z' };
const userB = { id: USER_B_ID, email: 'b@example.net', email_confirmed_at: '2026-11-15T00:00:00Z' };

test('protected auth fails closed when Supabase public configuration is missing', async () => {
  await withEnv({}, async () => {
    const res = responseStub();
    const user = await auth.requireUser(reqStub({ cookie: 'ari_access=anything' }), res);
    assert.equal(user, null);
    assert.equal(res.statusCode, 503);
    assert.equal(res.payload.error, 'private_auth_not_configured');
  });
});

test('protected APIs reject signed-out requests before contacting Supabase', async () => {
  await withEnv(baseEnv(), async () => withFetch(async () => {
    assert.fail('No auth cookie must not cause an upstream request');
  }, async () => {
    const res = responseStub();
    const user = await auth.requireUser(reqStub(), res);
    assert.equal(user, null);
    assert.equal(res.statusCode, 401);
    assert.equal(res.payload.error, 'unauthenticated');
    assert.equal(res.headers['Cache-Control'], 'no-store, max-age=0');
  }));
});

test('any verified Supabase user identity is accepted; the old owner-email variable is ignored', async () => {
  await withEnv(baseEnv(), async () => withFetch(async (url, options) => {
    assert.equal(String(url), 'https://ari-test.supabase.co/auth/v1/user');
    assert.equal(options.headers.apikey, 'test-public-key');
    assert.equal(options.headers.Authorization, 'Bearer valid-access-token');
    return response(200, userA);
  }, async () => {
    const res = responseStub();
    const user = await auth.requireUser(reqStub({ cookie: 'ari_access=valid-access-token' }), res);
    assert.deepEqual({ id: user.id, email: user.email }, { id: USER_A_ID, email: 'a@example.net' });
    assert.equal(user.accessToken, 'valid-access-token');
  }));
});

test('invalid authenticated identity fails closed and clears session cookies', async () => {
  await withEnv(baseEnv(), async () => withFetch(async () => response(200, {
    id: 'not-a-user-id', email: 'someone@example.net'
  }), async () => {
    const res = responseStub();
    const user = await auth.requireUser(reqStub({ cookie: 'ari_access=bad-identity-token; ari_refresh=refresh-token' }), res);
    assert.equal(user, null);
    assert.equal(res.statusCode, 401);
    assert.equal(res.payload.error, 'unauthenticated');
    assert.equal(res.headers['Set-Cookie'].length, 2);
    assert.ok(res.headers['Set-Cookie'].every(line => /Max-Age=0/.test(line)));
  }));
});

test('magic-link signup uses a per-request PKCE challenge and an HttpOnly same-browser verifier cookie', async () => {
  let challengeSent;
  await withEnv(baseEnv(), async () => withFetch(async (url, options) => {
    assert.equal(String(url), 'https://ari-test.supabase.co/auth/v1/otp?redirect_to=https%3A%2F%2Fari.example');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers.apikey, 'test-public-key');
    const body = JSON.parse(options.body);
    assert.equal(body.email, 'new.user@example.net');
    assert.equal(body.create_user, true);
    assert.equal(body.code_challenge_method, 's256');
    assert.match(body.code_challenge, /^[A-Za-z0-9_-]{43}$/);
    challengeSent = body.code_challenge;
    assert.equal(options.headers.Authorization, undefined);
    return response(200, {});
  }, async () => {
    const res = responseStub();
    await handler(reqStub({
      method: 'POST',
      body: { action: 'send_link', email: ' New.User@Example.net ' },
      headers: { origin: 'https://ari.example' }
    }), res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.sent, true);
    assert.match(res.payload.message, /same browser/i);
    assert.equal(JSON.stringify(res.payload).includes('test-public-key'), false);
    const cookie = res.headers['Set-Cookie'];
    assert.match(cookie, /^ari_pkce_verifier=/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /Secure/);
    assert.match(cookie, /SameSite=Lax/);
    assert.match(cookie, /Path=\/api\/auth/);
    const verifier = decodeURIComponent(cookie.match(/^ari_pkce_verifier=([^;]+)/)[1]);
    assert.match(verifier, /^[A-Za-z0-9_-]{43}$/);
    const expectedChallenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    assert.equal(expectedChallenge, challengeSent);
  }));
});

test('OAuth provider discovery exposes only enabled Google/Discord choices', async () => {
  await withEnv(baseEnv(), async () => withFetch(async (url, options) => {
    assert.equal(String(url), 'https://ari-test.supabase.co/auth/v1/settings');
    assert.equal(options.method, 'GET');
    assert.equal(options.headers.apikey, 'test-public-key');
    return response(200, {
      external: { google: true, discord: false, github: true },
      provider_client_secrets: { google: 'never return this' }
    });
  }, async () => {
    const res = responseStub();
    await handler(reqStub({ method: 'GET', query: { action: 'providers' } }), res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.payload, { providers: ['google'] });
    assert.equal(JSON.stringify(res.payload).includes('never return this'), false);
  }));
});

test('Google OAuth start binds a same-origin redirect to an HttpOnly PKCE verifier cookie', async () => {
  await withEnv(baseEnv(), async () => withFetch(async (url, options) => {
    assert.equal(String(url), 'https://ari-test.supabase.co/auth/v1/settings');
    assert.equal(options.method, 'GET');
    return response(200, { external: { google: true, discord: true } });
  }, async () => {
    const res = responseStub();
    await handler(reqStub({
      method: 'POST',
      body: { action: 'start_oauth', provider: 'google', redirect_to: 'https://attacker.example' },
      headers: { origin: 'https://ari.example' }
    }), res);

    assert.equal(res.statusCode, 200);
    const authorizationUrl = new URL(res.payload.authorizationUrl);
    assert.equal(authorizationUrl.origin, 'https://ari-test.supabase.co');
    assert.equal(authorizationUrl.pathname, '/auth/v1/authorize');
    assert.equal(authorizationUrl.searchParams.get('provider'), 'google');
    assert.equal(authorizationUrl.searchParams.get('redirect_to'), 'https://ari.example');
    assert.equal(authorizationUrl.searchParams.get('code_challenge_method'), 's256');
    const challenge = authorizationUrl.searchParams.get('code_challenge');
    assert.match(challenge, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(res.payload.authorizationUrl.includes('test-public-key'), false);
    const cookie = res.headers['Set-Cookie'];
    assert.match(cookie, /^ari_pkce_verifier=/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /Secure/);
    assert.match(cookie, /SameSite=Lax/);
    assert.match(cookie, /Path=\/api\/auth/);
    const verifier = decodeURIComponent(cookie.match(/^ari_pkce_verifier=([^;]+)/)[1]);
    assert.equal(crypto.createHash('sha256').update(verifier).digest('base64url'), challenge);
  }));
});

test('Discord OAuth start uses the same PKCE callback while keeping its provider fixed', async () => {
  await withEnv(baseEnv(), async () => withFetch(async (url, options) => {
    assert.equal(String(url), 'https://ari-test.supabase.co/auth/v1/settings');
    assert.equal(options.method, 'GET');
    return response(200, { external: { google: false, discord: true } });
  }, async () => {
    const res = responseStub();
    await handler(reqStub({
      method: 'POST',
      body: { action: 'start_oauth', provider: 'discord' },
      headers: { origin: 'https://ari.example' }
    }), res);
    assert.equal(res.statusCode, 200);
    const authorizationUrl = new URL(res.payload.authorizationUrl);
    assert.equal(authorizationUrl.searchParams.get('provider'), 'discord');
    assert.equal(authorizationUrl.searchParams.get('redirect_to'), 'https://ari.example');
    assert.equal(authorizationUrl.searchParams.get('code_challenge_method'), 's256');
    assert.match(res.headers['Set-Cookie'], /^ari_pkce_verifier=/);
  }));
});

test('OAuth start fails closed for disabled providers and unsupported names', async () => {
  let settingsCalls = 0;
  await withEnv(baseEnv(), async () => withFetch(async () => {
    settingsCalls += 1;
    return response(200, { external: { google: true, discord: false } });
  }, async () => {
    const disabled = responseStub();
    await handler(reqStub({ method: 'POST', body: { action: 'start_oauth', provider: 'discord' } }), disabled);
    assert.equal(disabled.statusCode, 409);
    assert.equal(disabled.payload.error, 'oauth_provider_not_enabled');
    assert.equal(disabled.headers['Set-Cookie'], undefined);

    const unsupported = responseStub();
    await handler(reqStub({ method: 'POST', body: { action: 'start_oauth', provider: 'github' } }), unsupported);
    assert.equal(unsupported.statusCode, 400);
    assert.equal(unsupported.payload.error, 'unsupported_oauth_provider');
    assert.equal(settingsCalls, 1);
  }));
});

test('cross-origin OAuth starts are rejected before checking Supabase providers', async () => {
  await withEnv(baseEnv(), async () => withFetch(async () => {
    assert.fail('Cross-origin social sign-in must be rejected before Supabase');
  }, async () => {
    const res = responseStub();
    await handler(reqStub({
      method: 'POST',
      body: { action: 'start_oauth', provider: 'google' },
      headers: { origin: 'https://attacker.example' }
    }), res);
    assert.equal(res.statusCode, 403);
    assert.equal(res.payload.error, 'same_origin_required');
  }));
});

test('valid unknown emails are sent to Supabase with create_user and receive a non-enumerating response', async () => {
  let otpRequests = 0;
  await withEnv(baseEnv(), async () => withFetch(async (url, options) => {
    otpRequests += 1;
    assert.ok(String(url).includes('/auth/v1/otp'));
    assert.equal(JSON.parse(options.body).create_user, true);
    return response(200, {});
  }, async () => {
    const res = responseStub();
    await handler(reqStub({
      method: 'POST',
      body: { action: 'send_link', email: 'not-yet-registered@example.net' }
    }), res);
    assert.equal(otpRequests, 1);
    assert.equal(res.statusCode, 200);
    assert.match(res.payload.message, /If this email can receive sign-in/i);
  }));
});

test('malformed email and cross-origin requests do not call Supabase', async () => {
  await withEnv(baseEnv(), async () => withFetch(async () => {
    assert.fail('Invalid or cross-origin requests must be rejected before Supabase');
  }, async () => {
    const malformed = responseStub();
    await handler(reqStub({ method: 'POST', body: { action: 'send_link', email: 'bad' } }), malformed);
    assert.equal(malformed.statusCode, 400);
    assert.equal(malformed.payload.error, 'invalid_email');

    const crossOrigin = responseStub();
    await handler(reqStub({
      method: 'POST',
      body: { action: 'send_link', email: 'person@example.net' },
      headers: { origin: 'https://attacker.example' }
    }), crossOrigin);
    assert.equal(crossOrigin.statusCode, 403);
    assert.equal(crossOrigin.payload.error, 'same_origin_required');
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
  assert.deepEqual(auth.parseJsonBody({ body: '{"ok":true}', headers: { 'content-length': '11' } }, 11), { body: { ok: true } });
  assert.equal(auth.parseJsonBody({ body: Buffer.from('{"q":"🌐"}') }, 10).error, 'body_too_large');
  assert.equal(auth.parseJsonBody({ body: { q: '🌐' } }, 11).error, 'body_too_large');
  assert.equal(auth.parseJsonBody({ body: '{"ok":true}', headers: { 'content-length': '12' } }, 11).error, 'body_too_large');
  assert.equal(auth.parseJsonBody({ body: '{}', headers: { 'content-length': 'many' } }, 11).error, 'invalid_content_length');
  assert.equal(auth.parseJsonBody({ body: '{bad' }, 11).error, 'invalid_json');
  assert.equal(auth.parseJsonBody({ body: [] }, 11).error, 'invalid_json');
});

test('PKCE callback redeems code server-side, validates the user, and returns only HttpOnly cookies', async () => {
  const pair = auth.createPkcePair();
  const secretAccess = 'access-token-test-secret-that-is-long-enough';
  const secretRefresh = 'refresh-token-test-secret-that-is-long-enough';
  const cookies = `ari_pkce_verifier=${pair.verifier}`;
  let tokenCalls = 0;

  await withEnv(baseEnv(), async () => withFetch(async (url, options) => {
    const target = String(url);
    if (target.endsWith('/auth/v1/token?grant_type=pkce')) {
      tokenCalls += 1;
      assert.equal(options.method, 'POST');
      assert.equal(options.headers.apikey, 'test-public-key');
      assert.deepEqual(JSON.parse(options.body), {
        auth_code: 'single-use-code-1234567890',
        code_verifier: pair.verifier
      });
      return response(200, {
        access_token: secretAccess,
        refresh_token: secretRefresh,
        expires_in: 1800,
        user: userA
      });
    }
    if (target.endsWith('/auth/v1/user')) {
      assert.equal(options.headers.Authorization, `Bearer ${secretAccess}`);
      return response(200, userA);
    }
    throw new Error(`Unexpected request ${target}`);
  }, async () => {
    const res = responseStub();
    await handler(reqStub({
      method: 'POST',
      cookie: cookies,
      body: { action: 'exchange_link', code: 'single-use-code-1234567890' },
      headers: { origin: 'https://ari.example' }
    }), res);

    assert.equal(tokenCalls, 1);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.payload, { authenticated: true, user: { id: USER_A_ID, email: 'a@example.net' } });
    assert.equal(JSON.stringify(res.payload).includes(secretAccess), false);
    assert.equal(JSON.stringify(res.payload).includes(secretRefresh), false);
    assert.equal(res.headers['Set-Cookie'].length, 3);
    assert.ok(res.headers['Set-Cookie'].slice(0, 2).every(line => /HttpOnly/.test(line) && /Secure/.test(line) && /SameSite=Strict/.test(line) && /Path=\//.test(line)));
    assert.match(res.headers['Set-Cookie'][2], /ari_pkce_verifier=.*Max-Age=0/);
  }));
});

test('PKCE callback fails closed if the same-browser verifier cookie is missing', async () => {
  await withEnv(baseEnv(), async () => withFetch(async () => {
    assert.fail('A callback without its bound verifier must not reach Supabase');
  }, async () => {
    const res = responseStub();
    await handler(reqStub({
      method: 'POST',
      body: { action: 'exchange_link', code: 'single-use-code-1234567890' },
      headers: { origin: 'https://ari.example' }
    }), res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.payload.error, 'pkce_verifier_missing');
    assert.match(res.headers['Set-Cookie'], /Max-Age=0/);
  }));
});

test('temporary Auth outage leaves the PKCE verifier available for a retry', async () => {
  const pair = auth.createPkcePair();
  await withEnv(baseEnv(), async () => withFetch(async () => response(503, { error: 'temporarily_unavailable' }), async () => {
    const res = responseStub();
    await handler(reqStub({
      method: 'POST',
      cookie: `ari_pkce_verifier=${pair.verifier}`,
      body: { action: 'exchange_link', code: 'single-use-code-1234567890' },
      headers: { origin: 'https://ari.example' }
    }), res);
    assert.equal(res.statusCode, 503);
    assert.equal(res.payload.error, 'auth_service_unavailable');
    assert.equal(res.headers['Set-Cookie'], undefined);
  }));
});

test('legacy one-time link tokens still exchange during rollout without being returned to the browser', async () => {
  const secretAccess = 'legacy-access-token-test-secret-that-is-long-enough';
  const secretRefresh = 'legacy-refresh-token-test-secret-that-is-long-enough';
  await withEnv(baseEnv(), async () => withFetch(async (url, options) => {
    assert.equal(String(url), 'https://ari-test.supabase.co/auth/v1/user');
    assert.equal(options.headers.Authorization, `Bearer ${secretAccess}`);
    return response(200, userB);
  }, async () => {
    const res = responseStub();
    await handler(reqStub({
      method: 'POST',
      body: { action: 'exchange_link', access_token: secretAccess, refresh_token: secretRefresh },
      headers: { origin: 'https://ari.example' }
    }), res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.payload, { authenticated: true, user: { id: USER_B_ID, email: 'b@example.net' } });
    assert.equal(JSON.stringify(res.payload).includes(secretAccess), false);
    assert.equal(JSON.stringify(res.payload).includes(secretRefresh), false);
    assert.equal(res.headers['Set-Cookie'].length, 3);
  }));
});

test('expired access cookie refreshes and rotates for its authenticated account', async () => {
  const newAccess = 'rotated-access-token';
  const newRefresh = 'rotated-refresh-token';
  await withEnv(baseEnv(), async () => withFetch(async (url, options) => {
    const target = String(url);
    if (target.endsWith('/auth/v1/user')) {
      if (options.headers.Authorization === 'Bearer expired-token') return response(401, { message: 'expired' });
      assert.equal(options.headers.Authorization, `Bearer ${newAccess}`);
      return response(200, userB);
    }
    assert.equal(target, 'https://ari-test.supabase.co/auth/v1/token?grant_type=refresh_token');
    assert.deepEqual(JSON.parse(options.body), { refresh_token: 'old-refresh-token' });
    return response(200, {
      access_token: newAccess,
      refresh_token: newRefresh,
      expires_in: 3600,
      user: userB
    });
  }, async () => {
    const res = responseStub();
    const user = await auth.requireUser(reqStub({ cookie: 'ari_access=expired-token; ari_refresh=old-refresh-token' }), res);
    assert.equal(user.id, USER_B_ID);
    assert.equal(user.accessToken, newAccess);
    assert.equal(user.email, 'b@example.net');
    assert.ok(res.headers['Set-Cookie'].some(line => line.includes(encodeURIComponent(newAccess))));
    assert.ok(res.headers['Set-Cookie'].some(line => line.includes(encodeURIComponent(newRefresh))));
  }));
});

test('logout revokes the current session and clears all auth cookies', async () => {
  await withEnv(baseEnv(), async () => withFetch(async (url, options) => {
    assert.equal(String(url), 'https://ari-test.supabase.co/auth/v1/logout');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers.Authorization, 'Bearer current-access-token');
    return response(204, null);
  }, async () => {
    const res = responseStub();
    await handler(reqStub({
      method: 'POST',
      cookie: 'ari_access=current-access-token; ari_refresh=current-refresh-token; ari_pkce_verifier=old-verifier',
      body: { action: 'logout' },
      headers: { origin: 'https://ari.example' }
    }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.authenticated, false);
    assert.equal(res.headers['Set-Cookie'].length, 3);
    assert.ok(res.headers['Set-Cookie'].every(line => /Max-Age=0/.test(line)));
  }));
});
