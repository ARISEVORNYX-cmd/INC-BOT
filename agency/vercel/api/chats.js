'use strict';

const privateAuth = require('../_lib/private-auth');
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function safePath(path, query) {
  return `${path}?${query.toString()}`;
}

async function databaseRequest(user, path, options = {}) {
  return privateAuth.requestSupabase(user.config, path, {
    ...options,
    headers: {
      Authorization: `Bearer ${user.accessToken}`,
      ...(options.headers || {})
    }
  });
}

function storageError(res, result) {
  if (result.status === 0 || result.status >= 500) {
    return privateAuth.json(res, 503, { error: 'memory_storage_unavailable', message: 'Personal memory storage is temporarily unavailable.' });
  }
  return privateAuth.json(res, 503, { error: 'memory_storage_not_ready', message: 'Personal memory storage is not ready yet.' });
}

module.exports = async function chats(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  if (req.method !== 'GET' && req.method !== 'POST') return privateAuth.json(res, 405, { error: 'method_not_allowed' });
  if (req.method === 'POST' && !privateAuth.requestIsSameOrigin(req)) {
    return privateAuth.json(res, 403, { error: 'same_origin_required' });
  }

  const user = await privateAuth.requireUser(req, res);
  if (!user) return;

  if (req.method === 'GET') {
    const conversationId = String(req.query && req.query.id || '').trim();
    if (conversationId && !UUID_RE.test(conversationId)) return privateAuth.json(res, 400, { error: 'invalid_conversation_id' });

    if (conversationId) {
      const query = new URLSearchParams({
        select: 'id,role,content,created_at',
        owner_id: `eq.${user.id}`,
        conversation_id: `eq.${conversationId}`,
        order: 'created_at.asc',
        limit: '500'
      });
      const result = await databaseRequest(user, safePath('/rest/v1/ari_messages', query), { method: 'GET' });
      if (!result.ok) return storageError(res, result);
      return privateAuth.json(res, 200, { messages: Array.isArray(result.data) ? result.data : [] });
    }

    const query = new URLSearchParams({
      select: 'id,title,created_at,updated_at',
      owner_id: `eq.${user.id}`,
      order: 'updated_at.desc',
      limit: '100'
    });
    const result = await databaseRequest(user, safePath('/rest/v1/ari_conversations', query), { method: 'GET' });
    if (!result.ok) return storageError(res, result);
    return privateAuth.json(res, 200, { conversations: Array.isArray(result.data) ? result.data : [] });
  }

  const parsed = privateAuth.parseJsonBody(req);
  if (parsed.error) return privateAuth.json(res, 400, { error: parsed.error });
  const body = parsed.body;
  const action = String(body.action || '');

  if (action === 'save_turn') {
    const question = typeof body.question === 'string' ? body.question.trim() : '';
    const answer = typeof body.answer === 'string' ? body.answer.trim() : '';
    if (!question || question.length > 4000 || !answer || answer.length > 4000) {
      return privateAuth.json(res, 400, { error: 'invalid_turn', message: 'A saved turn needs a question and answer, each up to 4,000 characters.' });
    }

    let conversationId = String(body.conversation_id || '').trim();
    let conversation;
    if (conversationId) {
      if (!UUID_RE.test(conversationId)) return privateAuth.json(res, 400, { error: 'invalid_conversation_id' });
      const lookup = new URLSearchParams({
        select: 'id,title,created_at,updated_at',
        id: `eq.${conversationId}`,
        owner_id: `eq.${user.id}`,
        limit: '1'
      });
      const found = await databaseRequest(user, safePath('/rest/v1/ari_conversations', lookup), { method: 'GET' });
      if (!found.ok) return storageError(res, found);
      conversation = Array.isArray(found.data) ? found.data[0] : null;
      if (!conversation) return privateAuth.json(res, 404, { error: 'conversation_not_found' });
    } else {
      const title = question.replace(/\s+/g, ' ').slice(0, 96) || 'New chat';
      const created = await databaseRequest(user, '/rest/v1/ari_conversations?select=id,title,created_at,updated_at', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ owner_id: user.id, title })
      });
      if (!created.ok) return storageError(res, created);
      conversation = Array.isArray(created.data) ? created.data[0] : null;
      if (!conversation || !UUID_RE.test(String(conversation.id || ''))) {
        return privateAuth.json(res, 503, { error: 'memory_storage_unavailable' });
      }
      conversationId = conversation.id;
    }

    const metadata = body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
      ? body.metadata : {};
    const safeMetadata = {
      agent: String(metadata.agent || 'Ari').slice(0, 40),
      model: String(metadata.model || 'local').slice(0, 120),
      source: String(metadata.source || 'unknown').slice(0, 40)
    };
    const inserted = await databaseRequest(user, '/rest/v1/ari_messages', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify([
        { owner_id: user.id, conversation_id: conversationId, role: 'user', content: question, metadata: {} },
        { owner_id: user.id, conversation_id: conversationId, role: 'assistant', content: answer, metadata: safeMetadata }
      ])
    });
    if (!inserted.ok) return storageError(res, inserted);

    const updatedAt = new Date().toISOString();
    const updateQuery = new URLSearchParams({ id: `eq.${conversationId}`, owner_id: `eq.${user.id}` });
    const updated = await databaseRequest(user, safePath('/rest/v1/ari_conversations', updateQuery), {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ updated_at: updatedAt })
    });
    if (!updated.ok) return storageError(res, updated);

    return privateAuth.json(res, 200, {
      conversation: { ...conversation, updated_at: updatedAt },
      saved: true
    });
  }

  if (action === 'delete') {
    const conversationId = String(body.conversation_id || '').trim();
    if (!UUID_RE.test(conversationId)) return privateAuth.json(res, 400, { error: 'invalid_conversation_id' });
    const query = new URLSearchParams({ id: `eq.${conversationId}`, owner_id: `eq.${user.id}` });
    const result = await databaseRequest(user, safePath('/rest/v1/ari_conversations', query), {
      method: 'DELETE',
      headers: { Prefer: 'return=representation' }
    });
    if (!result.ok) return storageError(res, result);
    if (!Array.isArray(result.data) || result.data.length === 0) return privateAuth.json(res, 404, { error: 'conversation_not_found' });
    return privateAuth.json(res, 200, { deleted: true });
  }

  return privateAuth.json(res, 400, { error: 'invalid_action' });
};
