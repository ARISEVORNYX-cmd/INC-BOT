'use strict';

const privateAuth = require('../_lib/private-auth');
const twilioWhatsApp = require('../_lib/twilio-whatsapp');

function createHandler({ provider = twilioWhatsApp } = {}) {
  return async function whatsapp(req, res) {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    if (req.method === 'OPTIONS') return res.status(204).end();

    const method = String(req.method || 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'POST') {
      return privateAuth.json(res, 405, { error: 'method_not_allowed' });
    }
    if (method === 'POST' && !privateAuth.requestIsSameOrigin(req)) {
      return privateAuth.json(res, 403, { error: 'same_origin_required' });
    }

    const user = await privateAuth.requireUser(req, res);
    if (!user) return;

    if (method === 'GET') {
      return privateAuth.json(res, 200, provider.getPublicStatus());
    }

    const parsed = privateAuth.parseJsonBody(req, 4000);
    if (parsed.error) return privateAuth.json(res, 400, { error: parsed.error });
    if (parsed.body.action !== 'check') {
      return privateAuth.json(res, 400, { error: 'unsupported_action' });
    }

    const result = await provider.checkConnection();
    if (!result.connected) {
      const error = result.error || 'twilio_request_failed';
      const status = error.startsWith('twilio_not_configured') || error.startsWith('twilio_configuration_')
        ? 409
        : 502;
      return privateAuth.json(res, status, {
        provider: 'twilio',
        connected: false,
        mode: 'read_only_sandbox',
        outbound_messaging_enabled: false,
        error
      });
    }

    return privateAuth.json(res, 200, {
      provider: 'twilio',
      connected: true,
      mode: 'read_only_sandbox',
      outbound_messaging_enabled: false
    });
  };
}

module.exports = createHandler();
module.exports.createHandler = createHandler;
