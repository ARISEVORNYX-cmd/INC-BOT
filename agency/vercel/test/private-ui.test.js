'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const client = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const worker = fs.readFileSync(path.join(root, 'service-worker.js'), 'utf8');

test('private Ari shell hides the workspace until session verification and discourages indexing', () => {
  assert.match(html, /id="loginView"/);
  assert.match(html, /id="appView"[^>]*hidden/);
  assert.match(html, /name="robots" content="noindex,nofollow,noarchive,nosnippet"/);
  assert.match(html, /frame-ancestors 'none'/);
  assert.doesNotMatch(html, /<style\b|<script\b(?![^>]*\bsrc=)[^>]*>/i);
});

test('browser code keeps user text as text, handles PKCE callbacks, and does not persist tokens locally', () => {
  assert.match(client, /bubble\.textContent\s*=/);
  assert.doesNotMatch(client, /\.innerHTML\s*=|localStorage|sessionStorage|SUPABASE_(?:ANON|PUBLISHABLE)_KEY|service_role/i);
  assert.match(client, /credentials:\s*'same-origin'/);
  assert.match(client, /query\.get\('code'\)/);
  assert.match(client, /payload\.code\s*=\s*code/);
  assert.match(client, /history\.replaceState/);
});

test('service worker caches only the private app shell, skipping APIs and demo navigation', () => {
  assert.match(worker, /ari-private-shell-v4/);
  assert.match(worker, /url\.pathname\.startsWith\('\/api\/'\)/);
  assert.match(worker, /url\.pathname !== '\/' && url\.pathname !== '\/index\.html'/);
  assert.match(worker, /never cached/i);
});
