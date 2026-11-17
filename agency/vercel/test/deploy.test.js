'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const pageRoot = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(pageRoot, 'deploy.html'), 'utf8');
const css = fs.readFileSync(path.join(pageRoot, 'deploy.css'), 'utf8');
const vercelConfig = JSON.parse(fs.readFileSync(path.join(pageRoot, 'vercel.json'), 'utf8'));

test('Ari hosting dashboard reports account-based setup and remaining live checks honestly', () => {
  assert.match(html, /Ari Launchpad — Private Hosting Status/);
  assert.match(html, /Account-based hosting/);
  assert.match(html, /52 \/ 52 passed/);
  assert.match(html, /Not live-tested/);
  assert.match(html, /RLS enabled/);
  assert.match(html, /live PKCE login and cross-account isolation/);
  assert.match(html, /Vercel currently reports SSO protection/);
  assert.match(html, /not unlimited service/i);
  assert.match(html, /AI_PROVIDER=local/);
  assert.match(html, /OPENROUTER_API_KEY/);
  assert.match(html, /value has not been inspected/);
  assert.doesNotMatch(html, /Nothing deployed yet|NO CLOUD WRITES|Antideploy/);
});

test('hosting dashboard links to the assigned domain and keeps responsive navigation', () => {
  assert.match(html, /href="https:\/\/inc-ari-agency\.vercel\.app\/"/);
  assert.match(html, /href="\.\/index\.html"/);
  assert.match(css, /@media\(max-width:540px\)/);
  assert.match(html, /name="viewport"/);
  assert.doesNotMatch(html, /<iframe\b/i);
});

test('Vercel routes app assets, applies security headers, and has no invalid public field', () => {
  assert.equal(Object.hasOwn(vercelConfig, 'public'), false);
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
