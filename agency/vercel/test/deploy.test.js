'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const pageRoot = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(pageRoot, 'deploy.html'), 'utf8');
const css = fs.readFileSync(path.join(pageRoot, 'deploy.css'), 'utf8');
const vercelConfig = JSON.parse(fs.readFileSync(path.join(pageRoot, 'vercel.json'), 'utf8'));

test('agent launch dashboard clearly reports the real blocked and preview-only state', () => {
  assert.match(html, /Ari Launchpad — Project & Deploy Status/);
  assert.match(html, /Not connected/);
  assert.match(html, /does not allow outbound requests to Antideploy/);
  assert.match(html, /No approval link or device code was requested/);
  assert.match(html, /Nothing deployed yet/);
  assert.match(html, /no live deployment/i);
  assert.match(html, /50–70 specialist profiles/);
  assert.match(html, /39 \/ 39 passed/);
  assert.match(html, /39 Vercel tests \+ 17 agency tests/);
  assert.match(html, /39 tests · auth\/provider calls mocked; no live AI call/);
  assert.match(html, /Free-tier reality check/);
  assert.match(html, /may pause after one week of inactivity/);
  assert.match(html, /not unlimited service/i);
});

test('agent launch dashboard offers navigation back to Ari and a responsive mobile layout', () => {
  assert.match(html, /href="\.\/index\.html"/);
  assert.match(css, /@media\(max-width:540px\)/);
  assert.match(html, /name="viewport"/);
  assert.doesNotMatch(html, /<iframe\b/i);
});

test('Vercel routes dashboard assets and applies restrictive same-origin security headers', () => {
  assert.ok(vercelConfig.routes.some(route => route.src === '/deploy/?' && route.dest === '/deploy.html'));
  assert.ok(vercelConfig.routes.some(route => route.src === '/deploy.html' && route.dest === '/deploy.html'));
  assert.ok(vercelConfig.routes.some(route => route.src === '/styles.css' && route.dest === '/styles.css'));
  assert.ok(vercelConfig.routes.some(route => route.src === '/app.js' && route.dest === '/app.js'));
  assert.ok(vercelConfig.routes.some(route => route.src === '/deploy.css' && route.dest === '/deploy.css'));
  assert.ok(vercelConfig.routes.some(route => route.src === '/_lib/(.*)' && route.status === 404));
  const headers = vercelConfig.headers.find(group => group.source === '/(.*)').headers;
  assert.ok(headers.some(header => header.key === 'Content-Security-Policy' && /script-src 'self'/.test(header.value)));
  assert.ok(headers.some(header => header.key === 'Cache-Control' && /no-store/.test(header.value)));
});
