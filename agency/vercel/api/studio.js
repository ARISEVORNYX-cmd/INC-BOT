'use strict';

const privateAuth = require('../_lib/private-auth');

// Safe, deterministic Studio Director planner. It never searches the web, sends
// messages, writes files, runs phone commands, or deploys anything.
const MAX_BRIEF = 4000;
const REGIONS = new Set(['India', 'Worldwide', 'India + worldwide']);
const CREATIVE_SOURCES = require('../data/creative-sources.json').sources;
const PAYMENT_NOTIFICATION_POLICY = Object.freeze({
  selected_trigger: 'payment_cleared',
  trigger_condition: 'verified_provider_event_with_final_cleared_or_settled_status',
  enabled: false,
  notify_on_project_acceptance: false,
  payment_provider: null,
  delivery_channel: null,
  money_movement: false,
  implementation_status: 'not_configured'
});
const TRACKS = {
  client_research: {
    title: 'Client research & proposal preparation',
    triggers: /\b(clients?|customers?|leads?|prospects?|markets?|sales|business(?:es)?|outreach)\b|client dhoond/i,
    roles: ['Market & Lead Researcher', 'Ideal Customer Analyst', 'Consent & Source Reviewer', 'Proposal Drafter'],
    steps: [
      'Clarify the offer, ideal customer, location, evidence, and exclusions.',
      'Research only public, permitted sources; record source URLs and confidence.',
      'Score candidate clients against the brief and remove duplicates or opt-outs.',
      'Prepare a concise, fact-checked proposal draft for human review.'
    ],
    checks: ['Every lead has a verifiable source.', 'No contact is invented or scraped from a restricted source.', 'No outreach is sent; drafts require your approval.']
  },
  product_build: {
    title: 'AI product / website / app / bot build',
    triggers: /\b(website|web app|app|discord|bot|build|code|product|feature|bug|issue|fix|repo|repository)\b/i,
    roles: ['Product Manager', 'AI & Automation Architect', 'UI/UX Designer', 'Web/App/Discord Developer', 'QA Reviewer', 'Security Reviewer'],
    steps: [
      'Turn the request into acceptance criteria and identify missing decisions.',
      'Inspect the supplied repository and propose a bounded implementation plan.',
      'Build in an isolated working branch or sandbox; do not change production directly.',
      'Run tests, security checks, and a reviewer pass; retry at most three times.',
      'Prepare a preview and handoff report; production release needs your approval.'
    ],
    checks: ['Acceptance criteria are testable.', 'Tests and security checks are reported honestly.', 'No production deploy or external repo write occurs without approval.']
  },
  payment_notifications: {
    title: 'Cleared-payment notification setup',
    triggers: /\b(payments?|paid|cleared|settled|settlement|invoices?|billing|deposits?|payouts?)\b/i,
    roles: ['Payment Integration Engineer', 'Notification & Event Engineer', 'Security Reviewer'],
    steps: [
      'Choose a payment provider and owner notification channel; neither is configured yet.',
      'Verify the provider webhook signature server-side and map only its authoritative cleared/settled state to a notification.',
      'Make event handling idempotent, notify the owner once, and keep logs free of payment secrets or unnecessary personal data.',
      'Never charge, refund, transfer, or otherwise move money as part of a notification workflow.'
    ],
    checks: ['Pending, initiated, authorized, failed, or merely invoiced events do not trigger an alert.', 'Only a verified provider event with a final cleared/settled status can trigger an owner notification.', 'Duplicate webhook deliveries do not send duplicate alerts.', 'The workflow cannot move money.']
  },
  creative_design: {
    title: 'Creative direction, graphic design & motion',
    triggers: /\b(creative|artist|artwork|graphic|graphics|graphic edit(?:ing)?|logo|poster|thumbnail|illustrat\w*|visual identity|brand design|motion design|motion graphics|animation|animated|video edit(?:ing)?|reel|image edit(?:ing)?|photo edit(?:ing)?|retouch|vector|svg|blender|3d render|kinetic typography|storyboard)\b/i,
    roles: ['Ari Creative Director', 'Brand & Graphic Designer', 'Motion Director', 'Image & Illustration Artist', 'Visual QA & Rights Reviewer'],
    steps: [
      'Clarify the deliverable, audience, channel, aspect ratio, dimensions, duration, brand assets, and deadline; state any reversible assumptions.',
      'Choose up to three reviewed creative sources that fit the task and device; list license, runtime, model, hardware, and asset-rights caveats.',
      'Prepare an original concept, storyboard or layout, motion/timing plan, asset manifest, and export specification for review.',
      'Build only with an available, authorized tool in the approved workspace; do not install a repo, imitate a living artist’s signature style, upload, or overwrite files without permission.',
      'Render and inspect the actual output; check spelling, crop/safe areas, contrast, mobile readability, timing, audio, reduced-motion fallback, and provenance; retry at most three times.'
    ],
    checks: ['A concrete deliverable and export format are specified.', 'Artwork, fonts, music, footage, models, and logos have a rights/provenance note.', 'Visual QA is based on the actual output, not a plan or unrendered source.', 'No asset is uploaded, overwritten, or published without owner approval.']
  },
  phone_assistance: {
    title: 'Android personal-assistant task',
    triggers: /\b(phone|android|mobile|device|torch|brightness|reminder|open app)\b/i,
    roles: ['Personal AI Director', 'Android Companion Operator', 'Automation Engineer', 'Safety Reviewer'],
    steps: [
      'Classify the requested device action as read-only, reversible, or sensitive.',
      'Use only an installed companion capability with explicit Android permission.',
      'Ask before messages, calls, payments, account changes, deletes, or sensitive actions.',
      'Return the device result and an audit entry; stop if the phone is offline or permission is missing.'
    ],
    checks: ['Only allowlisted actions are proposed.', 'Sensitive actions remain approval-gated.', 'No remote shell or unrestricted screen control is enabled.']
  }
};

function selectCreativeSources(brief) {
  const text = String(brief || '').toLowerCase();
  const ids = [];
  const add = (...values) => values.forEach(id => { if (!ids.includes(id)) ids.push(id); });
  if (/\b(blender|3d|model|mesh|character|scene|rigging)\b/.test(text)) add('blender-skills');
  if (/\b(motion|kinetic|animation|animated|video|reel|promo|opener|explainer|storyboard)\b/.test(text)) {
    add('bang-motion', 'remotion-motion-graphics');
  }
  if (/\b(ui|interface|microinteraction|react|gesture|scroll|web animation)\b/.test(text)) add('motion-react');
  if (/\b(brand|graphic|graphics|logo|poster|vector|svg|icon|layout|prototype)\b/.test(text)) add('penpot', 'svg-edit');
  if (/\b(interactive|2d|canvas|particle|webgl|game)\b/.test(text)) add('pixijs');
  if (/\b(image|photo|painting|illustration|retouch|inpaint|outpaint|diffusion|krita)\b/.test(text)) {
    add('krita-ai-diffusion', 'comfyui');
  }
  if (/\b(skill catalog|more motion skills|discover motion tools)\b/.test(text)) add('awesome-motion-design-skills');
  if (!ids.length) add('penpot', 'bang-motion');
  const byId = new Map(CREATIVE_SOURCES.map(source => [source.id, source]));
  return ids.slice(0, 3).map(id => {
    const source = byId.get(id);
    return source && ({ id: source.id, name: source.name, repository: source.repository, url: source.url, license: source.license, focus: source.focus, adoption_status: source.adoption_status, caveat: source.caveat });
  }).filter(Boolean);
}

function cleanText(value, max = MAX_BRIEF) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function normalizeRegion(value) {
  const raw = cleanText(value, 80).toLowerCase().replace(/\s+/g, ' ');
  if (!raw || raw === 'both' || raw === 'india + worldwide' || raw === 'india and worldwide') return 'India + worldwide';
  if (raw === 'india' || raw === 'india only') return 'India';
  if (raw === 'worldwide' || raw === 'global' || raw === 'worldwide only') return 'Worldwide';
  return null;
}

function createPlan(body = {}) {
  const brief = cleanText(body.brief || body.goal);
  if (!brief) return { status: 'needs_input', error: 'brief_required', max_brief_chars: MAX_BRIEF };
  if (String(body.brief || body.goal).length > MAX_BRIEF) {
    return { status: 'error', error: 'brief_too_long', max_brief_chars: MAX_BRIEF };
  }
  const region = normalizeRegion(body.region);
  if (!region) return { status: 'error', error: 'invalid_region', allowed_regions: [...REGIONS] };

  const tracks = Object.entries(TRACKS).filter(([, track]) => track.triggers.test(brief));
  const selected = tracks.length ? tracks : [['product_build', TRACKS.product_build]];
  const roles = [...new Set(selected.flatMap(([, track]) => track.roles))].slice(0, 12);
  const steps = selected.flatMap(([, track]) => track.steps);
  const checks = [...new Set(selected.flatMap(([, track]) => track.checks))];
  const creativeWork = selected.some(([id]) => id === 'creative_design');
  const creativeRecommendations = creativeWork ? selectCreativeSources(brief) : [];
  return {
    plan_id: `plan-${Date.now().toString(36)}`,
    status: 'plan_ready',
    execution_mode: 'preview_only',
    brief,
    market: region,
    studio: 'AI Automation, Creative & Product Development Studio',
    director: 'Ari — Studio Director',
    workforce: {
      personal_ai_first: true,
      agency_phase: 2,
      planned_specialist_profiles: { minimum: 50, maximum: 70 },
      max_active_specialists_per_run: 5,
      status: 'planned_not_running',
      role_profiles_are_running_agents: false
    },
    workstreams: selected.map(([id, track]) => ({ id, title: track.title })),
    assigned_roles: roles,
    steps,
    completion_checks: checks,
    ari_recommendation: creativeWork
      ? 'Start with an original concept and select only a few reviewed tools that match the output; verify rights and inspect the render before calling it complete.'
      : 'Use the smallest safe workflow that meets the goal; label assumptions and verify the result before reporting completion.',
    creative_sources: creativeRecommendations,
    retry_limit: 3,
    resume_policy: 'Save checkpoints in the future task queue; pause and resume after a limit or blocker. No infinite retry loop.',
    payment_notification_policy: { ...PAYMENT_NOTIFICATION_POLICY },
    approvals_required: {
      contact_clients_or_send_messages: true,
      publish_or_production_deploy: true,
      change_phone_state_or_send_device_commands: true,
      move_or_refund_money: true,
      upload_or_overwrite_creative_assets: true,
      write_or_delete_cloud_data: true
    },
    payment_notification_notice: 'Preference recorded: alert only after a verified provider confirms a cleared or settled payment. No provider, webhook, payment data, or delivery channel is configured; no notification has been sent.',

    external_actions_performed: [],
    notice: 'This is a planning preview only. No web search, client contact, phone action, file edit, cloud write, or deployment was performed.'
  };
}

const CATALOG = Object.entries(TRACKS).map(([id, track]) => ({ id, title: track.title, roles: track.roles }));
const CREATIVE_CATALOG = CREATIVE_SOURCES.map(({ id, name, repository, url, license, focus, adoption_status }) => ({
  id, name, repository, url, license, focus, adoption_status
}));

module.exports = async function studio(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET' && req.method !== 'POST') return privateAuth.json(res, 405, { error: 'method_not_allowed' });
  if (req.method === 'POST' && !privateAuth.requestIsSameOrigin(req)) return privateAuth.json(res, 403, { error: 'same_origin_required' });
  const user = await privateAuth.requireUser(req, res);
  if (!user) return;
  if (req.method === 'GET') return res.status(200).json({
    director: 'Ari — Studio Director',
    catalog: CATALOG,
    creative_sources: CREATIVE_CATALOG,
    regions: [...REGIONS],
    payment_notification_policy: { ...PAYMENT_NOTIFICATION_POLICY },
    execution: 'plan_only',
    external_actions: 'approval_required'
  });
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const parsed = privateAuth.parseJsonBody(req, 12000);
  if (parsed.error) return privateAuth.json(res, 400, { error: parsed.error });
  const result = createPlan(parsed.body);
  return res.status(result.status === 'error' ? 400 : result.status === 'needs_input' ? 422 : 200).json(result);
};

module.exports.createPlan = createPlan;
module.exports.selectCreativeSources = selectCreativeSources;
module.exports.PAYMENT_NOTIFICATION_POLICY = PAYMENT_NOTIFICATION_POLICY;
