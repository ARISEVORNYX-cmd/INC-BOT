'use strict';

const privateAuth = require('../_lib/private-auth');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE_RE = /^[A-Za-z0-9._~-]{10,2048}$/;
const TOKEN_RE = /^\S{20,4096}$/;
const REFRESH_RE = /^\S{20,2048}$/;
const VERIFIER_RE = /^[A-Za-z0-9_-]{43,128}$/;

function sessionTokens(session) {
  const accessToken = String(session && session.access_token || '').trim();
  const refreshToken = String(session && session.refresh_token || '').trim();
  return TOKEN_RE.test(accessToken) && REFRESH_RE.test(refreshToken)
    ? { accessToken, refreshToken }
    : null;
}

module.exports = async function auth(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  if (req.method === 'GET') {
    const action = String(req.query && req.query.action || 'session');
    if (action !== 'session') return privateAuth.json(res, 400, { error: 'invalid_action' });
    const user = await privateAuth.requireUser(req, res);
    if (!user) return;
    return privateAuth.json(res, 200, { authenticated: true, user: { id: user.id, email: user.email } });
  }

  if (req.method !== 'POST') return privateAuth.json(res, 405, { error: 'method_not_allowed' });
  if (!privateAuth.requestIsSameOrigin(req)) return privateAuth.json(res, 403, { error: 'same_origin_required' });

  const parsed = privateAuth.parseJsonBody(req);
  if (parsed.error) return privateAuth.json(res, 400, { error: parsed.error });
  const body = parsed.body;
  const action = String(body.action || '');
  const config = privateAuth.getConfig();

  if (action === 'logout') {
    const cookies = privateAuth.parseCookies(req);
    privateAuth.clearAuthCookies(req, res);
    if (config) await privateAuth.revokeSession(config, cookies[privateAuth.ACCESS_COOKIE]);
    return privateAuth.json(res, 200, { authenticated: false });
  }

  if (!config) return privateAuth.json(res, 503, { error: 'private_auth_not_configured', message: 'Private sign-in is not configured.' });

  if (action === 'send_link') {
    const email = privateAuth.normalizeEmail(body.email);
    if (email.length > 254 || !EMAIL_RE.test(email)) {
      return privateAuth.json(res, 400, { error: 'invalid_email', message: 'Enter a valid email address.' });
    }
    const redirectTo = privateAuth.getRequestOrigin(req);
    if (!redirectTo) return privateAuth.json(res, 400, { error: 'invalid_redirect_origin' });

    const { verifier, challenge } = privateAuth.createPkcePair();
    const result = await privateAuth.sendMagicLink(config, email, redirectTo, challenge);
    if (result.status === 0 || result.status >= 500) {
      privateAuth.clearPkceCookie(req, res);
      return privateAuth.json(res, 503, { error: 'email_signin_unavailable', message: 'Email sign-in is temporarily unavailable.' });
    }
    if (!result.ok) {
      privateAuth.clearPkceCookie(req, res);
      const status = result.status === 429 ? 429 : 502;
      return privateAuth.json(res, status, { error: 'email_link_not_sent', message: 'The sign-in link could not be sent. Wait a little and try again.' });
    }

    privateAuth.setPkceCookie(req, res, verifier);
    return privateAuth.json(res, 200, {
      sent: true,
      message: 'If this email can receive sign-in, a one-time link has been sent. Open it in this same browser.'
    });
  }

  if (action === 'exchange_link') {
    const code = String(body.code || '').trim();
    const accessToken = String(body.access_token || '').trim();
    const refreshToken = String(body.refresh_token || '').trim();
    const usingPkce = Boolean(code);
    let session;

    if (usingPkce) {
      if (accessToken || refreshToken || !CODE_RE.test(code)) {
        privateAuth.clearPkceCookie(req, res);
        return privateAuth.json(res, 400, { error: 'invalid_signin_link', message: 'That sign-in link is invalid. Request a fresh one.' });
      }
      const verifier = privateAuth.parseCookies(req)[privateAuth.PKCE_COOKIE] || '';
      if (!VERIFIER_RE.test(verifier)) {
        privateAuth.clearPkceCookie(req, res);
        return privateAuth.json(res, 400, {
          error: 'pkce_verifier_missing',
          message: 'Open the sign-in link in the same browser where you requested it, then request a fresh link if needed.'
        });
      }

      const exchanged = await privateAuth.requestSupabase(config, '/auth/v1/token?grant_type=pkce', {
        method: 'POST',
        body: JSON.stringify({ auth_code: code, code_verifier: verifier })
      });
      if (exchanged.status === 0 || exchanged.status >= 500) {
        return privateAuth.json(res, 503, { error: 'auth_service_unavailable', message: 'Sign-in service is temporarily unavailable.' });
      }
      privateAuth.clearPkceCookie(req, res);
      if (!exchanged.ok) {
        return privateAuth.json(res, 401, { error: 'invalid_signin_link', message: 'That sign-in link is invalid or expired. Request a fresh one.' });
      }
      session = exchanged.data;
    } else {
      // Compatibility for one-time magic links sent before PKCE was enabled.
      if (!TOKEN_RE.test(accessToken) || !REFRESH_RE.test(refreshToken)) {
        privateAuth.clearPkceCookie(req, res);
        return privateAuth.json(res, 400, { error: 'invalid_signin_link', message: 'That sign-in link is invalid. Request a fresh one.' });
      }
      session = { access_token: accessToken, refresh_token: refreshToken, expires_in: 3600 };
    }

    const tokens = sessionTokens(session);
    if (!tokens) {
      privateAuth.clearPkceCookie(req, res);
      return privateAuth.json(res, 401, { error: 'invalid_signin_link', message: 'That sign-in link is invalid or expired. Request a fresh one.' });
    }

    const verified = await privateAuth.fetchUser(config, tokens.accessToken);
    if (verified.status === 0 || verified.status >= 500) {
      privateAuth.clearPkceCookie(req, res);
      return privateAuth.json(res, 503, { error: 'auth_service_unavailable', message: 'Sign-in service is temporarily unavailable.' });
    }
    const user = verified.user && privateAuth.userIdentity(verified.user);
    if (!user) {
      privateAuth.clearAuthCookies(req, res);
      if (verified.user) await privateAuth.revokeSession(config, tokens.accessToken);
      return privateAuth.json(res, 401, { error: 'invalid_signin_link', message: 'That sign-in link is invalid or expired. Request a fresh one.' });
    }

    privateAuth.setSessionCookies(req, res, {
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      expires_in: session.expires_in
    });
    return privateAuth.json(res, 200, { authenticated: true, user });
  }

  return privateAuth.json(res, 400, { error: 'invalid_action' });
};
