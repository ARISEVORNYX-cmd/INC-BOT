'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const root = path.join(__dirname, '..');
const pageHandler = require(path.join(root, 'api', 'demo-page.js'));
const demoClient = fs.readFileSync(path.join(root, 'demo.js'), 'utf8');
const vercelConfig = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));

function invoke(method = 'GET', vercelEnv) {
  const hasOriginal = Object.hasOwn(process.env, 'VERCEL_ENV');
  const original = process.env.VERCEL_ENV;
  if (vercelEnv === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = vercelEnv;

  let responseBody;
  const responseHeaders = {};
  let statusCode = 200;
  const response = {
    setHeader(name, value) { responseHeaders[name] = value; return this; },
    status(code) { statusCode = code; return this; },
    json(value) { responseBody = value; return this; },
    send(value) { responseBody = value; return this; }
  };

  try {
    pageHandler({ method }, response);
  } finally {
    if (hasOriginal) process.env.VERCEL_ENV = original;
    else delete process.env.VERCEL_ENV;
  }
  return { statusCode, responseHeaders, responseBody };
}

test('demo page is served only from a Vercel Preview deployment', () => {
  const preview = invoke('GET', 'preview');
  assert.equal(preview.statusCode, 200);
  assert.equal(preview.responseHeaders['X-Ari-Demo-Mode'], 'preview-only');
  assert.match(preview.responseHeaders['Cache-Control'], /no-store/);
  assert.match(preview.responseHeaders['X-Robots-Tag'], /noindex/);
  assert.match(preview.responseBody, /Safe demo/);
  assert.match(preview.responseBody, /fake data/i);
  assert.match(preview.responseBody, /href="\/demo\.css"/);
  assert.match(preview.responseBody, /src="\/demo\.js"/);
  assert.doesNotMatch(preview.responseBody, /<form\b|src="\/app\.js"|<script\b(?![^>]*\bsrc=)/i);
});

test('demo page is absent from Production and Development deployments', () => {
  for (const environment of ['production', 'development', undefined]) {
    const response = invoke('GET', environment);
    assert.equal(response.statusCode, 404);
    assert.deepEqual(response.responseBody, { error: 'not_found' });
    assert.equal(response.responseHeaders['X-Ari-Demo-Mode'], undefined);
  }
});

test('demo route rejects methods other than GET', () => {
  const response = invoke('POST', 'preview');
  assert.equal(response.statusCode, 405);
  assert.equal(response.responseHeaders.Allow, 'GET');
  assert.deepEqual(response.responseBody, { error: 'method_not_allowed' });
});

test('demo interactions are local scripted examples with no network, storage, or private APIs', () => {
  assert.match(demoClient, /bubble\.textContent\s*=/);
  assert.doesNotMatch(demoClient, /\bfetch\s*\(|XMLHttpRequest|WebSocket|localStorage|sessionStorage|\/api\/|SUPABASE|OPENROUTER|innerHTML/i);
  assert.match(demoClient, /Scripted reply only/);
  assert.match(demoClient, /personalized AI answer nahi/);
});

test('demo assets and preview-only route are explicitly wired without changing the app root', () => {
  assert.ok(vercelConfig.routes.some(route => route.src === '/demo/?' && route.dest === '/api/demo-page.js'));
  assert.ok(vercelConfig.routes.some(route => route.src === '/demo.css' && route.dest === '/demo.css'));
  assert.ok(vercelConfig.routes.some(route => route.src === '/demo.js' && route.dest === '/demo.js'));
  assert.ok(vercelConfig.routes.some(route => route.src === '/(.*)' && route.dest === '/index.html'));
});
