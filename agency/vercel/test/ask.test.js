const assert = require('node:assert/strict');
const { test } = require('node:test');
const ask = require('../api/ask.js');

const ENV_KEYS = [
  'AI_PROVIDER',
  'OPENROUTER_API_KEY',
  'OPENROUTER_MODEL',
  'GEMINI_API_KEY',
  'GEMINI_MODEL',
  'AGENT_TEAM_MODEL'
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

async function withFetch(mockFetch, callback) {
  const saved = global.fetch;
  global.fetch = mockFetch;
  try {
    return await callback();
  } finally {
    global.fetch = saved;
  }
}

async function invoke({ method = 'POST', body = {}, query = {} } = {}) {
  const res = {
    headers: {},
    statusCode: 200,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
    end() { this.ended = true; return this; }
  };
  await ask({ method, body, query }, res);
  return res;
}

function mockOpenRouterResponse(text, model) {
  return new Response(JSON.stringify({
    id: 'resp_mock',
    object: 'response',
    created_at: 1700000000,
    completed_at: 1700000001,
    status: 'completed',
    error: null,
    frequency_penalty: null,
    incomplete_details: null,
    instructions: null,
    metadata: null,
    model,
    output: [],
    output_text: text,
    parallel_tool_calls: false,
    presence_penalty: null,
    temperature: null,
    tool_choice: 'auto',
    tools: [],
    top_p: null,
    store: false
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

test('OpenRouter SDK request sends a selected free model slug and returns generated text', async () => {
  await withEnv({
    AI_PROVIDER: 'openrouter',
    OPENROUTER_API_KEY: 'test-key-do-not-leak',
    OPENROUTER_MODEL: 'vendor/sample-model:free'
  }, async () => withFetch(async input => {
    const request = input instanceof Request ? input : new Request(input);
    assert.match(request.url, /\/responses$/);
    assert.equal(request.method, 'POST');
    assert.equal(request.headers.get('authorization'), 'Bearer test-key-do-not-leak');
    const body = await request.clone().json();
    assert.equal(body.model, 'vendor/sample-model:free');
    assert.equal(body.stream, false);
    assert.equal(body.max_output_tokens, 1200);
    assert.match(body.input, /OpenRouter end-to-end smoke test/);
    return mockOpenRouterResponse('Mocked OpenRouter answer', 'vendor/sample-model:free');
  }, async () => {
    const res = await invoke({ body: { question: 'OpenRouter end-to-end smoke test', use_model: true } });
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.source, 'openrouter');
    assert.equal(res.payload.answer, 'Mocked OpenRouter answer');
    assert.equal(res.payload.model, 'vendor/sample-model:free');
    assert.equal(JSON.stringify(res.payload).includes('test-key-do-not-leak'), false);
  }));
});

test('paid OpenRouter model slugs are blocked before any provider request', async () => {
  await withEnv({
    AI_PROVIDER: 'openrouter',
    OPENROUTER_API_KEY: 'test-key-do-not-leak',
    OPENROUTER_MODEL: 'vendor/paid-model'
  }, async () => withFetch(async () => {
    assert.fail('A blocked paid model must not make a request');
  }, async () => {
    const res = await invoke({ body: { question: 'Tell me something useful' } });
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.model, 'vercel-local-always-answer');
    assert.equal(res.payload.provider_error, 'openrouter_paid_model_blocked');
    assert.equal(JSON.stringify(res.payload).includes('test-key-do-not-leak'), false);
  }));
});

test('OpenRouter upstream errors return a local answer without exposing provider details', async () => {
  await withEnv({
    AI_PROVIDER: 'openrouter',
    OPENROUTER_API_KEY: 'test-key-do-not-leak',
    OPENROUTER_MODEL: 'openrouter/free'
  }, async () => withFetch(async () => {
    throw new Error('simulated upstream failure containing test-key-do-not-leak');
  }, async () => {
    const savedWarn = console.warn;
    const warnings = [];
    console.warn = message => warnings.push(String(message));
    try {
      const res = await invoke({ body: { question: 'Explain a simple idea', use_model: true } });
      assert.equal(res.statusCode, 200);
      assert.equal(res.payload.model, 'vercel-local-always-answer');
      assert.ok(res.payload.answer);
      assert.match(res.payload.provider_error, /^openrouter_/);
      assert.equal(JSON.stringify(res.payload).includes('test-key-do-not-leak'), false);
      assert.equal(warnings.some(line => line.includes('test-key-do-not-leak')), false);
    } finally {
      console.warn = savedWarn;
    }
  }));
});

test('Gemini remains selectable as the existing alternative provider', async () => {
  await withEnv({ AI_PROVIDER: 'gemini', GEMINI_API_KEY: 'gemini-test-key' }, async () => withFetch(async (url, options) => {
    assert.match(String(url), /generativelanguage\.googleapis\.com/);
    assert.equal(options.headers['x-goog-api-key'], 'gemini-test-key');
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: 'Mocked Gemini answer' }] } }]
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }, async () => {
    const res = await invoke({ body: { question: 'A normal question', use_model: true } });
    assert.equal(res.payload.source, 'gemini');
    assert.equal(res.payload.answer, 'Mocked Gemini answer');
    assert.equal(res.payload.model, 'gemini-2.0-flash');
  }));
});

test('missing provider key keeps the local answer and reports a safe setup error', async () => {
  await withEnv({ AI_PROVIDER: 'openrouter' }, async () => withFetch(async () => {
    assert.fail('A missing key must not make a request');
  }, async () => {
    const res = await invoke({ body: { question: 'A normal question' } });
    assert.ok(res.payload.answer);
    assert.equal(res.payload.source, 'local-always-answer');
    assert.equal(res.payload.provider_error, 'openrouter_api_key_missing');
  }));
});

test('malformed JSON and unsupported methods are rejected cleanly', async () => {
  const malformed = await invoke({ body: '{bad-json' });
  assert.equal(malformed.statusCode, 400);
  assert.equal(malformed.payload.error, 'invalid_json');

  const unsupported = await invoke({ method: 'PUT' });
  assert.equal(unsupported.statusCode, 405);
  assert.equal(unsupported.payload.error, 'method_not_allowed');
});
