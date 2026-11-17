'use strict';

const ACCESS_COOKIE = 'ari_access';
const REFRESH_COOKIE = 'ari_refresh';
const ACCESS_MAX_AGE_SECONDS = 60 * 60;
const REFRESH_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const AUTH_TIMEOUT_MS = 5000;

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function getConfig() {
  const rawUrl = String(process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const anonKey = String(process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || '').trim();
  const allowedEmail = normalizeEmail(process.env.ARI_ALLOWED_EMAIL);
  let url;
  try {
    url = new URL(rawUrl);
  } catch (_) {
    return null;
  }
  const localHttp = ['localhost', '127.0.0.1'].includes(url.hostname);
  if ((!localHttp && url.protocol !== 'https:') || !anonKey || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(allowedEmail)) return null;
  if (url.username || url.password || url.search || url.hash) return null;
  return { url: rawUrl, anonKey, allowedEmail };
}

function setNoStore(res) {
  if (res && typeof res.setHeader === 'function') res.setHeader('Cache-Control', 'no-store, max-age=0');
}

function json(res, status, payload) {
  setNoStore(res);
  return res.status(status).json(payload);
}

function parseCookies(req) {
  const raw = req && req.headers && req.headers.cookie;
  const cookies = {};
  for (const part of String(raw || '').split(';')) {
    const index = part.indexOf('=');
    if (index < 1) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    try { cookies[name] = decodeURIComponent(value); }
    catch (_) { cookies[name] = ''; }
  }
  return cookies;
}

function requestScheme(req) {
  const forwardedProto = String(req && req.headers && req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  if (forwardedProto === 'https' || forwardedProto === 'http') return forwardedProto;
  if (forwardedProto) return null;
  if (req && req.socket && req.socket.encrypted) return 'https';
  return process.env.NODE_ENV === 'production' ? 'https' : 'http';
}

function requestIsSameOrigin(req) {
  const headers = req && req.headers || {};
  const origin = String(headers.origin || '').trim();
  const hostValue = String(headers['x-forwarded-host'] || headers.host || '').split(',')[0].trim();
  const scheme = requestScheme(req);
  if (!origin || !hostValue || !scheme) return false;
  try {
    const originUrl = new URL(origin);
    const requestUrl = new URL(`${scheme}://${hostValue}`);
    if (!['https:', 'http:'].includes(originUrl.protocol)
      || originUrl.username || originUrl.password || originUrl.pathname !== '/' || originUrl.search || originUrl.hash
      || requestUrl.username || requestUrl.password || requestUrl.pathname !== '/' || requestUrl.search || requestUrl.hash) return false;

    const configuredOrigin = String(process.env.ARI_ALLOWED_ORIGIN || '').trim();
    if (!configuredOrigin && process.env.NODE_ENV === 'production') return false;
    if (configuredOrigin) {
      const allowedUrl = new URL(configuredOrigin);
      const localHttp = ['localhost', '127.0.0.1'].includes(allowedUrl.hostname);
      const developmentLocal = process.env.NODE_ENV !== 'production' && localHttp && allowedUrl.protocol === 'http:';
      if (allowedUrl.username || allowedUrl.password || allowedUrl.pathname !== '/' || allowedUrl.search || allowedUrl.hash
        || (allowedUrl.protocol !== 'https:' && !developmentLocal)
        || originUrl.origin !== allowedUrl.origin) return false;
    }

    return originUrl.origin === requestUrl.origin;
  } catch (_) {
    return false;
  }
}

function getRequestOrigin(req) {
  if (!requestIsSameOrigin(req)) return null;
  try { return new URL(req.headers.origin).origin; }
  catch (_) { return null; }
}

function cookieLine(req, name, value, maxAge) {
  const forwardedProto = String(req && req.headers && req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  const secure = forwardedProto === 'https' || process.env.NODE_ENV === 'production';
  return `${name}=${encodeURIComponent(value || '')}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

function setSessionCookies(req, res, session) {
  const access = String(session && session.access_token || '');
  const refresh = String(session && session.refresh_token || '');
  const expiresIn = Math.max(60, Math.min(ACCESS_MAX_AGE_SECONDS, Number(session && session.expires_in) || ACCESS_MAX_AGE_SECONDS));
  res.setHeader('Set-Cookie', [
    cookieLine(req, ACCESS_COOKIE, access, expiresIn),
    cookieLine(req, REFRESH_COOKIE, refresh, REFRESH_MAX_AGE_SECONDS)
  ]);
}

function clearSessionCookies(req, res) {
  res.setHeader('Set-Cookie', [
    cookieLine(req, ACCESS_COOKIE, '', 0),
    cookieLine(req, REFRESH_COOKIE, '', 0)
  ]);
}

async function requestSupabase(config, path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AUTH_TIMEOUT_MS);
  try {
    const response = await fetch(`${config.url}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        apikey: config.anonKey,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {})
      }
    });
    let data = null;
    try { data = await response.json(); } catch (_) { data = null; }
    return { status: response.status, ok: response.ok, data };
  } catch (_) {
    return { status: 0, ok: false, data: null };
  } finally {
    clearTimeout(timer);
  }
}

function ownerIdentity(user, config) {
  if (!user || typeof user.id !== 'string' || !user.id || !/^[0-9a-f-]{36}$/i.test(user.id)) return null;
  const email = normalizeEmail(user.email);
  if (!email || email !== config.allowedEmail) return null;
  return { id: user.id, email };
}

async function fetchUser(config, accessToken) {
  if (!accessToken) return { status: 401, user: null };
  const result = await requestSupabase(config, '/auth/v1/user', {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  return { status: result.status, user: result.ok ? result.data : null };
}

async function refreshSession(config, refreshToken) {
  if (!refreshToken) return { status: 401, session: null };
  const result = await requestSupabase(config, '/auth/v1/token?grant_type=refresh_token', {
    method: 'POST',
    body: JSON.stringify({ refresh_token: refreshToken })
  });
  return { status: result.status, session: result.ok ? result.data : null };
}

async function requireOwner(req, res) {
  setNoStore(res);
  const config = getConfig();
  if (!config) {
    json(res, 503, { error: 'private_auth_not_configured', message: 'Private sign-in is not configured.' });
    return null;
  }
  const cookies = parseCookies(req);
  let accessToken = cookies[ACCESS_COOKIE];
  const refreshToken = cookies[REFRESH_COOKIE];
  let auth = accessToken ? await fetchUser(config, accessToken) : { status: 401, user: null };

  if (auth.status === 0 || auth.status >= 500) {
    json(res, 503, { error: 'auth_service_unavailable', message: 'Sign-in service is temporarily unavailable.' });
    return null;
  }

  if (!auth.user && refreshToken) {
    const refreshed = await refreshSession(config, refreshToken);
    if (refreshed.status === 0 || refreshed.status >= 500) {
      json(res, 503, { error: 'auth_service_unavailable', message: 'Sign-in service is temporarily unavailable.' });
      return null;
    }
    if (refreshed.session && refreshed.session.access_token && refreshed.session.refresh_token) {
      accessToken = String(refreshed.session.access_token);
      auth = { status: 200, user: refreshed.session.user || null };
      if (!auth.user) {
        auth = await fetchUser(config, accessToken);
        if (auth.status === 0 || auth.status >= 500) {
          json(res, 503, { error: 'auth_service_unavailable', message: 'Sign-in service is temporarily unavailable.' });
          return null;
        }
      }
      if (auth.user) setSessionCookies(req, res, refreshed.session);
    }
  }

  if (!auth.user) {
    if (accessToken || refreshToken) clearSessionCookies(req, res);
    json(res, 401, { error: 'unauthenticated', message: 'Sign in to continue.' });
    return null;
  }

  const user = ownerIdentity(auth.user, config);
  if (!user) {
    clearSessionCookies(req, res);
    json(res, 403, { error: 'owner_only', message: 'This Ari workspace is limited to its owner.' });
    return null;
  }

  return { ...user, accessToken, config };
}

function parseJsonBody(req, maxBytes = 12000) {
  const limit = Number.isSafeInteger(maxBytes) && maxBytes > 0 ? maxBytes : 12000;
  const contentLength = req && req.headers && req.headers['content-length'];
  if (contentLength !== undefined) {
    const rawLength = String(contentLength).trim();
    if (!/^\d+$/.test(rawLength)) return { error: 'invalid_content_length' };
    if (Number(rawLength) > limit) return { error: 'body_too_large' };
  }

  let body = req && req.body;
  if (Buffer.isBuffer(body)) {
    if (body.byteLength > limit) return { error: 'body_too_large' };
    body = body.toString('utf8');
  }
  if (typeof body === 'string') {
    if (Buffer.byteLength(body, 'utf8') > limit) return { error: 'body_too_large' };
    try { body = body.trim() ? JSON.parse(body) : {}; }
    catch (_) { return { error: 'invalid_json' }; }
  } else if (body === undefined || body === null) {
    body = {};
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'invalid_json' };

  let serialized;
  try { serialized = JSON.stringify(body); }
  catch (_) { return { error: 'invalid_json' }; }
  if (typeof serialized !== 'string' || Buffer.byteLength(serialized, 'utf8') > limit) {
    return { error: 'body_too_large' };
  }
  return { body };
}

async function sendMagicLink(config, email, redirectTo) {
  const redirect = new URL(redirectTo);
  return requestSupabase(config, `/auth/v1/otp?redirect_to=${encodeURIComponent(redirect.origin)}`, {
    method: 'POST',
    body: JSON.stringify({ email, create_user: true, code_challenge: null, code_challenge_method: null })
  });
}

async function revokeSession(config, accessToken) {
  if (!accessToken) return;
  await requestSupabase(config, '/auth/v1/logout', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` }
  });
}

module.exports = {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  getConfig,
  json,
  normalizeEmail,
  ownerIdentity,
  parseCookies,
  parseJsonBody,
  requestIsSameOrigin,
  getRequestOrigin,
  requestSupabase,
  requireOwner,
  sendMagicLink,
  revokeSession,
  setSessionCookies,
  clearSessionCookies
};
