'use strict';

const twilio = require('twilio');

const DEFAULT_SANDBOX_SENDER = 'whatsapp:+14155238886';
const TWILIO_TIMEOUT_MS = 7000;
const ACCOUNT_SID_RE = /^AC[0-9a-f]{32}$/i;
const API_KEY_SID_RE = /^SK[0-9a-f]{32}$/i;
const WHATSAPP_ADDRESS_RE = /^whatsapp:\+[1-9]\d{6,14}$/;

function readConfig(env = process.env) {
  const accountSid = String(env.TWILIO_ACCOUNT_SID || '').trim();
  const apiKeySid = String(env.TWILIO_API_KEY_SID || '').trim();
  const apiKeySecret = String(env.TWILIO_API_KEY_SECRET || '').trim();
  const whatsappFrom = String(env.TWILIO_WHATSAPP_FROM || DEFAULT_SANDBOX_SENDER).trim();
  const hasAnyCredential = Boolean(accountSid || apiKeySid || apiKeySecret);

  if (!hasAnyCredential) return { ok: false, error: 'twilio_not_configured' };
  if (!accountSid || !apiKeySid || !apiKeySecret) {
    return { ok: false, error: 'twilio_configuration_incomplete' };
  }
  if (!ACCOUNT_SID_RE.test(accountSid)
    || !API_KEY_SID_RE.test(apiKeySid)
    || apiKeySecret.length > 256
    || /[\r\n]/.test(apiKeySecret)
    || !WHATSAPP_ADDRESS_RE.test(whatsappFrom)) {
    return { ok: false, error: 'twilio_configuration_invalid' };
  }

  return {
    ok: true,
    config: { accountSid, apiKeySid, apiKeySecret, whatsappFrom }
  };
}

function getPublicStatus(env = process.env) {
  const result = readConfig(env);
  return {
    provider: 'twilio',
    status: result.ok ? 'credentials_configured' : result.error,
    configured: result.ok,
    mode: 'read_only_sandbox',
    outbound_messaging_enabled: false
  };
}

function classifyError(error) {
  const status = Number(error && (error.status || error.statusCode));
  const code = String(error && error.code || '');
  if (status === 401 || code === '20003') return 'twilio_credentials_invalid';
  if (status === 403 || code === '20403') return 'twilio_read_permission_missing';
  if (status === 429) return 'twilio_rate_limited';
  if (status >= 500) return 'twilio_unavailable';
  if (['ETIMEDOUT', 'ECONNABORTED', 'ESOCKETTIMEDOUT'].includes(code)) return 'twilio_timeout';
  return 'twilio_request_failed';
}

async function checkConnection({ env = process.env, clientFactory = twilio } = {}) {
  const result = readConfig(env);
  if (!result.ok) return { connected: false, error: result.error };

  const { accountSid, apiKeySid, apiKeySecret, whatsappFrom } = result.config;
  try {
    const client = clientFactory(apiKeySid, apiKeySecret, {
      accountSid,
      timeout: TWILIO_TIMEOUT_MS,
      autoRetry: false,
      logLevel: 'silent'
    });
    // A restricted, read-only key is used to fetch at most one sandbox message.
    // The response is discarded: no message text, recipient, or status is persisted or returned.
    await client.messages.list({ from: whatsappFrom, limit: 1 });
    return { connected: true };
  } catch (error) {
    return { connected: false, error: classifyError(error) };
  }
}

module.exports = {
  DEFAULT_SANDBOX_SENDER,
  readConfig,
  getPublicStatus,
  classifyError,
  checkConnection
};
