'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const twilioWhatsApp = require('../_lib/twilio-whatsapp');
const { createHandler } = require('../api/whatsapp');

const ACCOUNT_SID = `AC${'a'.repeat(32)}`;
const API_KEY_SID = `SK${'b'.repeat(32)}`;
const API_KEY_SECRET = 'twilio-secret-for-test-only';
const ENV_KEYS = [
  'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEY', 'ARI_ALLOWED_ORIGIN',
  'TWILIO_ACCOUNT_SID', 'TWILIO_API_KEY_SID', 'TWILIO_API_KEY_SECRET', 'TWILIO_WHATSAPP_FROM'
];

async function withEnv(values, callback) {
  const saved = Object.fromEntries(ENV_KEYS.map(key => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) process.env[key] = value;
  }
  try {
    return await callback();
  } finally {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

function twilioEnv(overrides = {}) {
  return {
    TWILIO_ACCOUNT_SID: ACCOUNT_SID,
    TWILIO_API_KEY_SID: API_KEY_SID,
    TWILIO_API_KEY_SECRET: API_KEY_SECRET,
    ...overrides
  };
}

function makeResponse() {
  return {
    headers: {},
    statusCode: 200,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
    end() { this.ended = true; return this; }
  };
}

async function invoke(handler, { method = 'GET', body = {}, authenticated = true, sameOrigin = true } = {}) {
  const res = makeResponse();
  const savedFetch = global.fetch;
  global.fetch = async input => {
    if (String(input).endsWith('/auth/v1/user')) {
      if (!authenticated) return new Response(JSON.stringify({ message: 'invalid token' }), { status: 401 });
      return new Response(JSON.stringify({ id: '6dbe2e9e-b674-40ac-a192-8c7de8542091', email: 'owner@example.com' }), { status: 200 });
    }
    throw new Error('Unexpected network request in unit test');
  };
  try {
    await handler({
      method,
      body,
      headers: {
        host: 'ari.example',
        origin: sameOrigin ? 'https://ari.example' : 'https://attacker.example',
        'x-forwarded-proto': 'https',
        cookie: authenticated ? 'ari_access=test-access' : ''
      }
    }, res);
    return res;
  } finally {
    global.fetch = savedFetch;
  }
}

test('Twilio WhatsApp configuration requires server-side restricted API key credentials', () => {
  assert.equal(twilioWhatsApp.readConfig({}).error, 'twilio_not_configured');
  assert.equal(
    twilioWhatsApp.readConfig({ TWILIO_ACCOUNT_SID: ACCOUNT_SID }).error,
    'twilio_configuration_incomplete'
  );

  const configured = twilioWhatsApp.readConfig(twilioEnv());
  assert.equal(configured.ok, true);
  assert.equal(configured.config.whatsappFrom, twilioWhatsApp.DEFAULT_SANDBOX_SENDER);
  assert.equal(configured.config.apiKeySecret, API_KEY_SECRET);

  assert.equal(twilioWhatsApp.readConfig(twilioEnv({ TWILIO_API_KEY_SID: ACCOUNT_SID })).error, 'twilio_configuration_invalid');
  assert.equal(twilioWhatsApp.readConfig(twilioEnv({ TWILIO_WHATSAPP_FROM: '+14155238886' })).error, 'twilio_configuration_invalid');
});

test('public connection status never returns account or API credentials and advertises no sending', () => {
  const status = twilioWhatsApp.getPublicStatus(twilioEnv());
  assert.equal(status.provider, 'twilio');
  assert.equal(status.configured, true);
  assert.equal(status.mode, 'read_only_sandbox');
  assert.equal(status.outbound_messaging_enabled, false);
  assert.equal(JSON.stringify(status).includes(ACCOUNT_SID), false);
  assert.equal(JSON.stringify(status).includes(API_KEY_SID), false);
  assert.equal(JSON.stringify(status).includes(API_KEY_SECRET), false);
});

test('read-only connection check requests at most one WhatsApp Sandbox message and discards its content', async () => {
  let observed;
  let sends = 0;
  const result = await twilioWhatsApp.checkConnection({
    env: twilioEnv(),
    clientFactory: (sid, secret, options) => {
      observed = { sid, secret, options };
      return {
        messages: {
          async list(params) {
            assert.deepEqual(params, { from: twilioWhatsApp.DEFAULT_SANDBOX_SENDER, limit: 1 });
            return [{ body: 'private message body', to: 'whatsapp:+15555550123' }];
          },
          async create() { sends++; throw new Error('send must never be called'); }
        }
      };
    }
  });

  assert.deepEqual(result, { connected: true });
  assert.equal(observed.sid, API_KEY_SID);
  assert.equal(observed.secret, API_KEY_SECRET);
  assert.equal(observed.options.accountSid, ACCOUNT_SID);
  assert.equal(observed.options.timeout, 7000);
  assert.equal(observed.options.autoRetry, false);
  assert.equal(sends, 0);
  assert.equal(JSON.stringify(result).includes('private message body'), false);
});

test('connection check fails closed without credentials and sanitizes provider errors', async () => {
  let calls = 0;
  const missing = await twilioWhatsApp.checkConnection({ clientFactory: () => { calls++; throw new Error('must not be called'); } });
  assert.deepEqual(missing, { connected: false, error: 'twilio_not_configured' });
  assert.equal(calls, 0);

  const invalidKey = await twilioWhatsApp.checkConnection({
    env: twilioEnv(),
    clientFactory: () => ({ messages: { async list() { const error = new Error(API_KEY_SECRET); error.status = 401; throw error; } } })
  });
  assert.deepEqual(invalidKey, { connected: false, error: 'twilio_credentials_invalid' });
  assert.equal(JSON.stringify(invalidKey).includes(API_KEY_SECRET), false);
});

test('Ari WhatsApp endpoint returns private read-only status and requires sign-in', async () => {
  const handler = createHandler();
  await withEnv({
    ...twilioEnv(),
    SUPABASE_URL: 'https://ari-test.supabase.co',
    SUPABASE_ANON_KEY: 'test-public-key',
    ARI_ALLOWED_ORIGIN: 'https://ari.example'
  }, async () => {
    const res = await invoke(handler, { method: 'GET' });
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.provider, 'twilio');
    assert.equal(res.payload.configured, true);
    assert.equal(res.payload.outbound_messaging_enabled, false);
    assert.equal(JSON.stringify(res.payload).includes(API_KEY_SECRET), false);

    const signedOut = await invoke(handler, { method: 'GET', authenticated: false });
    assert.equal(signedOut.statusCode, 401);
    assert.equal(signedOut.payload.error, 'unauthenticated');
  });
});

test('Ari permits only a same-origin read-only connection check and exposes no send action', async () => {
  let checks = 0;
  const handler = createHandler({ provider: {
    getPublicStatus: () => ({ provider: 'twilio', configured: true, outbound_messaging_enabled: false }),
    async checkConnection() { checks++; return { connected: true }; }
  } });

  await withEnv({
    ...twilioEnv(),
    SUPABASE_URL: 'https://ari-test.supabase.co',
    SUPABASE_ANON_KEY: 'test-public-key',
    ARI_ALLOWED_ORIGIN: 'https://ari.example'
  }, async () => {
    const crossOrigin = await invoke(handler, { method: 'POST', body: { action: 'check' }, sameOrigin: false });
    assert.equal(crossOrigin.statusCode, 403);
    assert.equal(crossOrigin.payload.error, 'same_origin_required');
    assert.equal(checks, 0);

    const sendAction = await invoke(handler, { method: 'POST', body: { action: 'send' } });
    assert.equal(sendAction.statusCode, 400);
    assert.equal(sendAction.payload.error, 'unsupported_action');
    assert.equal(checks, 0);

    const checked = await invoke(handler, { method: 'POST', body: { action: 'check' } });
    assert.equal(checked.statusCode, 200);
    assert.deepEqual(checked.payload, {
      provider: 'twilio',
      connected: true,
      mode: 'read_only_sandbox',
      outbound_messaging_enabled: false
    });
    assert.equal(checks, 1);
  });
});
