const assert = require('node:assert/strict');
const { test } = require('node:test');
const studio = require('../api/studio.js');

async function invoke({ method = 'POST', body = {}, authenticated = true } = {}) {
  const res = {
    headers: {}, statusCode: 200,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
    end() { this.ended = true; return this; }
  };
  const authKeys = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'ARI_ALLOWED_EMAIL', 'ARI_ALLOWED_ORIGIN'];
  const savedEnv = Object.fromEntries(authKeys.map(key => [key, process.env[key]]));
  const savedFetch = global.fetch;
  Object.assign(process.env, {
    SUPABASE_URL: 'https://ari-test.supabase.co',
    SUPABASE_ANON_KEY: 'test-public-key',
    ARI_ALLOWED_EMAIL: 'owner@example.com',
    ARI_ALLOWED_ORIGIN: 'https://ari.example'
  });
  global.fetch = async (url, options) => {
    if (String(url).endsWith('/auth/v1/user')) {
      return new Response(JSON.stringify({ id: '6dbe2e9e-b674-40ac-a192-8c7de8542091', email: 'owner@example.com' }), { status: 200 });
    }
    return savedFetch(url, options);
  };
  try {
    await studio({ method, body, headers: { host: 'ari.example', origin: 'https://ari.example', 'x-forwarded-proto': 'https', cookie: authenticated ? 'ari_access=test-access' : '' } }, res);
    return res;
  } finally {
    global.fetch = savedFetch;
    for (const key of authKeys) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  }
}

test('client + product brief plans workstreams and gates every external side effect', () => {
  const plan = studio.createPlan({
    brief: 'Find AI automation clients in India and worldwide and build a website and Discord bot',
    region: 'both'
  });
  assert.equal(plan.status, 'plan_ready');
  assert.deepEqual(plan.workstreams.map(x => x.id), ['client_research', 'product_build']);
  assert.ok(plan.assigned_roles.includes('Market & Lead Researcher'));
  assert.ok(plan.assigned_roles.includes('QA Reviewer'));
  assert.equal(plan.workforce.personal_ai_first, true);
  assert.equal(plan.workforce.agency_phase, 2);
  assert.deepEqual(plan.workforce.planned_specialist_profiles, { minimum: 50, maximum: 70 });
  assert.equal(plan.workforce.max_active_specialists_per_run, 5);
  assert.equal(plan.workforce.status, 'planned_not_running');
  assert.equal(plan.workforce.role_profiles_are_running_agents, false);
  assert.equal(plan.approvals_required.contact_clients_or_send_messages, true);
  assert.equal(plan.approvals_required.publish_or_production_deploy, true);
  assert.deepEqual(plan.external_actions_performed, []);
  assert.match(plan.notice, /planning preview only/);
});

test('creative briefs select a small rights-aware tool stack from the reviewed ten-source catalog', () => {
  const plan = studio.createPlan({
    brief: 'Create a professional motion design reel, animated logo, and editable graphic poster',
    region: 'Worldwide'
  });
  assert.deepEqual(plan.workstreams.map(x => x.id), ['creative_design']);
  assert.deepEqual(plan.creative_sources.map(x => x.id), ['bang-motion', 'remotion-motion-graphics', 'penpot']);
  assert.ok(plan.creative_sources.every(x => x.adoption_status === 'reviewed-not-installed'));
  assert.equal(plan.approvals_required.upload_or_overwrite_creative_assets, true);
  assert.ok(plan.completion_checks.some(x => /provenance/.test(x)));
  assert.ok(plan.completion_checks.some(x => /actual output/.test(x)));
  assert.deepEqual(plan.external_actions_performed, []);

  const blender = studio.selectCreativeSources('Render a 3D character in Blender');
  assert.deepEqual(blender.map(x => x.id), ['blender-skills']);
});

test('Android work is limited to explicit permissions and approval-gated actions', () => {
  const plan = studio.createPlan({ brief: 'Set a reminder on my Android phone', region: 'India' });
  assert.deepEqual(plan.workstreams.map(x => x.id), ['phone_assistance']);
  assert.equal(plan.approvals_required.change_phone_state_or_send_device_commands, true);
  assert.ok(plan.completion_checks.some(x => /allowlisted/.test(x)));
});

test('payment notification planning records the cleared-only trigger without enabling any payment integration', () => {
  const plan = studio.createPlan({ brief: 'Notify me only when a payment is confirmed cleared', region: 'India' });
  assert.deepEqual(plan.workstreams.map(x => x.id), ['payment_notifications']);
  assert.equal(plan.payment_notification_policy.selected_trigger, 'payment_cleared');
  assert.equal(plan.payment_notification_policy.trigger_condition, 'verified_provider_event_with_final_cleared_or_settled_status');
  assert.equal(plan.payment_notification_policy.enabled, false);
  assert.equal(plan.payment_notification_policy.payment_provider, null);
  assert.equal(plan.payment_notification_policy.delivery_channel, null);
  assert.equal(plan.payment_notification_policy.money_movement, false);
  assert.equal(plan.approvals_required.move_or_refund_money, true);
  assert.ok(plan.completion_checks.some(x => /Pending, initiated, authorized/.test(x)));
  assert.match(plan.payment_notification_notice, /no notification has been sent/);
  assert.deepEqual(plan.external_actions_performed, []);
});

test('input validation rejects missing, oversized, and unsupported market values', () => {
  assert.equal(studio.createPlan({}).status, 'needs_input');
  assert.equal(studio.createPlan({ brief: 'x'.repeat(4001) }).error, 'brief_too_long');
  assert.equal(studio.createPlan({ brief: 'build a website', region: 'Mars' }).error, 'invalid_region');
});

test('Studio planner rejects signed-out requests', async () => {
  const res = await invoke({ authenticated: false, body: { brief: 'Do not run without login' } });
  assert.equal(res.statusCode, 401);
  assert.equal(res.payload.error, 'unauthenticated');
});

test('HTTP API is read-only catalog + plan preview, rejects writes and bad JSON', async () => {
  const get = await invoke({ method: 'GET' });
  assert.equal(get.payload.execution, 'plan_only');
  assert.equal(get.payload.creative_sources.length, 10);
  assert.equal(get.payload.payment_notification_policy.selected_trigger, 'payment_cleared');
  assert.equal(get.payload.payment_notification_policy.enabled, false);
  assert.equal(get.headers['Cache-Control'], 'no-store, max-age=0');
  const badJson = await invoke({ body: '{bad' });
  assert.equal(badJson.statusCode, 400);
  const put = await invoke({ method: 'PUT' });
  assert.equal(put.statusCode, 405);
  const good = await invoke({ body: { brief: 'Create a website for a client', region: 'Worldwide' } });
  assert.equal(good.statusCode, 200);
  assert.equal(good.payload.market, 'Worldwide');
  assert.deepEqual(good.payload.external_actions_performed, []);
});
