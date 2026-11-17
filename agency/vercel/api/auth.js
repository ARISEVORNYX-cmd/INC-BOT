'use strict';

const privateAuth = require('../_lib/private-auth');

module.exports = async function auth(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  if (req.method === 'GET') {
    const action = String(req.query && req.query.action || 'session');
    if (action !== 'session') return privateAuth.json(res, 400, { error: 'invalid_action' });
    const owner = await privateAuth.requireOwner(req, res);
    if (!owner) return;
    return privateAuth.json(res, 200, { authenticated: true, user: { id: owner.id, email: owner.email } });
  }

  if (req.method !== 'POST') return privateAuth.json(res, 405, { error: 'method_not_allowed' });
  if (!privateAuth.requestIsSameOrigin(req)) return privateAuth.json(res, 403, { error: 'same_origin_required' });

  const parsed = privateAuth.parseJsonBody(req);
  if (parsed.error) return privateAuth.json(res, 400, { error: parsed.error });
  const body = parsed.body;
  const action = String(body.action || '');

  if (action === 'logout') {
    const config = privateAuth.getConfig();
    const cookies = privateAuth.parseCookies(req);
    privateAuth.clearSessionCookies(req, res);
    if (config) await privateAuth.revokeSession(config, cookies[privateAuth.ACCESS_COOKIE]);
    return privateAuth.json(res, 200, { authenticated: false });
  }

  const config = privateAuth.getConfig();
  if (!config) return privateAuth.json(res, 503, { error: 'private_auth_not_configured', message: 'Private sign-in is not configured.' });

  const email = privateAuth.normalizeEmail(body.email);
  if (action === 'send_link') {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email !== config.allowedEmail) {
      return privateAuth.json(res, 200, { sent: true, message: 'If this is the owner email, a sign-in link was sent.' });
    }
    const redirectTo = privateAuth.getRequestOrigin(req);
    if (!redirectTo) return privateAuth.json(res, 400, { error: 'invalid_redirect_origin' });
    const result = await privateAuth.sendMagicLink(config, email, redirectTo);
    if (result.status === 0 || result.status >= 500) {
      return privateAuth.json(res, 503, { error: 'email_signin_unavailable', message: 'Email sign-in is temporarily unavailable.' });
    }
    if (!result.ok) {
      const status = result.status === 429 ? 429 : 502;
      return privateAuth.json(res, status, { error: 'email_link_not_sent', message: 'The sign-in link could not be sent. Wait and try again.' });
    }
    return privateAuth.json(res, 200, { sent: true, message: 'If this is the owner email, a sign-in link was sent.' });
  }

  if (action === 'exchange_link') {
    const accessToken = String(body.access_token || '').trim();
    const refreshToken = String(body.refresh_token || '').trim();
    if (accessToken.length < 20 || accessToken.length > 4096 || refreshToken.length < 20 || refreshToken.length > 2048 || /\s/.test(accessToken + refreshToken)) {
      return privateAuth.json(res, 400, { error: 'invalid_signin_link' });
    }

    const verified = await privateAuth.requestSupabase(config, '/auth/v1/user', {
      method: 'GET', headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (verified.status === 0 || verified.status >= 500) {
      return privateAuth.json(res, 503, { error: 'auth_service_unavailable', message: 'Sign-in service is temporarily unavailable.' });
    }
    const owner = verified.ok && privateAuth.ownerIdentity(verified.data, config);
    if (!owner) {
      privateAuth.clearSessionCookies(req, res);
      if (verified.ok) await privateAuth.revokeSession(config, accessToken);
      return privateAuth.json(res, verified.ok ? 403 : 401, {
        error: verified.ok ? 'owner_only' : 'invalid_signin_link',
        message: verified.ok ? 'This Ari workspace is limited to its owner.' : 'That sign-in link is invalid or expired. Request a fresh one.'
      });
    }

    privateAuth.setSessionCookies(req, res, { access_token: accessToken, refresh_token: refreshToken, expires_in: 3600 });
    return privateAuth.json(res, 200, { authenticated: true, user: owner });
  }

  return privateAuth.json(res, 400, { error: 'invalid_action' });
};
