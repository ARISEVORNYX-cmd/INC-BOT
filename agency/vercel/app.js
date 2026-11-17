'use strict';

(() => {
  const $ = id => document.getElementById(id);
  const loginView = $('loginView');
  const appView = $('appView');
  const authStatus = $('authStatus');
  const emailForm = $('emailForm');
  const linkStep = $('linkStep');
  const emailInput = $('accountEmail');
  const sendLinkButton = $('sendLinkButton');
  const oauthOptions = $('oauthOptions');
  const oauthSetupNote = $('oauthSetupNote');
  const oauthButtons = Array.from(document.querySelectorAll('[data-oauth-provider]'));
  const conversationList = $('conversationList');
  const messagesBox = $('messages');
  const welcomeState = $('welcomeState');
  const composer = $('chatForm');
  const questionInput = $('questionInput');
  const chatNotice = $('chatNotice');
  const memoryStatus = $('memoryStatus');
  const chatTitle = $('chatTitle');
  const deleteChatButton = $('deleteChatButton');
  const modelStatus = $('modelStatus');
  const studioOutput = $('studioOut');

  let signedInUser = null;
  let conversations = [];
  let conversationId = null;
  let transcript = [];
  let busy = false;
  let panelMode = false;
  let memoryReady = false;
  let installPrompt = null;
  let availableOAuthProviders = new Set();

  class ApiError extends Error {
    constructor(message, status, code) {
      super(message || `Request failed (${status})`);
      this.name = 'ApiError';
      this.status = status;
      this.code = code;
    }
  }

  async function requestJson(url, options = {}) {
    const response = await fetch(url, {
      cache: 'no-store',
      credentials: 'same-origin',
      ...options,
      headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) }
    });
    let data = {};
    try { data = await response.json(); } catch (_) { data = {}; }
    if (!response.ok) throw new ApiError(data.message || data.error, response.status, data.error);
    return data;
  }

  function setOAuthAvailability(providers, fallbackMessage = '') {
    availableOAuthProviders = new Set((Array.isArray(providers) ? providers : []).filter(provider => ['google', 'discord'].includes(provider)));
    for (const button of oauthButtons) {
      const isAvailable = availableOAuthProviders.has(button.dataset.oauthProvider);
      button.hidden = !isAvailable;
      button.disabled = !isAvailable;
    }
    oauthOptions.hidden = availableOAuthProviders.size === 0;
    oauthSetupNote.hidden = availableOAuthProviders.size > 0 && !fallbackMessage;
    if (oauthSetupNote.hidden) return;
    oauthSetupNote.textContent = fallbackMessage || 'Google ya Discord sign-in ko pehle Supabase mein configure karna hoga. Abhi email link se continue kar sakte ho.';
  }

  async function loadOAuthProviders() {
    try {
      const data = await requestJson('/api/auth?action=providers');
      setOAuthAvailability(data.providers);
    } catch (_) {
      setOAuthAvailability([], 'Social sign-in ka status abhi check nahi ho paaya. Email link se continue kar sakte ho.');
    }
  }

  function showLogin(message, disableSignIn = false) {
    signedInUser = null;
    conversations = [];
    conversationId = null;
    transcript = [];
    emailForm.hidden = false;
    linkStep.hidden = true;
    appView.hidden = true;
    loginView.hidden = false;
    $('signedInEmail').textContent = '';
    renderTranscript();
    renderConversations();
    sendLinkButton.disabled = disableSignIn;
    for (const button of oauthButtons) button.disabled = disableSignIn || !availableOAuthProviders.has(button.dataset.oauthProvider);
    authStatus.textContent = message || 'Free account sign-in ready. Apna email dalo.';
  }

  function showApp(user) {
    signedInUser = user;
    loginView.hidden = true;
    appView.hidden = false;
    $('signedInEmail').textContent = user.email || '';
    authStatus.textContent = '';
    memoryStatus.textContent = 'Saved chats load ho rahe hain…';
    chatNotice.textContent = '';
    loadConversations(true);
    questionInput.focus({ preventScroll: true });
  }

  function showAuthError(error) {
    if (error && error.code === 'unauthenticated') {
      showLogin('Session khatam ho gaya. Dobara sign in karo.');
      return true;
    }
    return false;
  }

  function appendMessage(role, content, saveToState = true) {
    const safeContent = String(content || '');
    if (saveToState) transcript.push({ role, content: safeContent });
    const article = document.createElement('article');
    article.className = `message ${role === 'user' ? 'user' : 'assistant'}`;
    const label = document.createElement('span');
    label.className = 'message-label';
    label.textContent = role === 'user' ? 'TUM' : 'ARI';
    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';
    bubble.textContent = safeContent;
    article.append(label, bubble);
    messagesBox.append(article);
    welcomeState.hidden = transcript.length > 0;
    messagesBox.scrollTop = messagesBox.scrollHeight;
  }

  function renderTranscript() {
    messagesBox.replaceChildren();
    for (const item of transcript) appendMessage(item.role, item.content, false);
    welcomeState.hidden = transcript.length > 0;
    messagesBox.scrollTop = messagesBox.scrollHeight;
  }

  function renderConversations() {
    conversationList.replaceChildren();
    for (const conversation of conversations) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'conversation-item';
      button.setAttribute('aria-current', conversation.id === conversationId ? 'page' : 'false');
      const title = document.createElement('span');
      title.textContent = conversation.title || 'New chat';
      button.append(title);
      button.addEventListener('click', () => loadConversation(conversation.id));
      conversationList.append(button);
    }
    deleteChatButton.hidden = !conversationId;
  }

  async function loadConversations(autoSelectLatest = false) {
    try {
      const data = await requestJson('/api/chats');
      memoryReady = true;
      conversations = Array.isArray(data.conversations) ? data.conversations : [];
      memoryStatus.textContent = conversations.length ? `${conversations.length} saved chat${conversations.length === 1 ? '' : 's'}` : 'Abhi koi saved chat nahi.';
      renderConversations();
      if (autoSelectLatest && !conversationId && conversations.length) await loadConversation(conversations[0].id);
      else if (!conversationId) startNewChat(false);
    } catch (error) {
      if (showAuthError(error)) return;
      memoryReady = false;
      conversations = [];
      renderConversations();
      memoryStatus.textContent = error.code === 'memory_storage_not_ready'
        ? 'Saved memory ke liye Supabase migration abhi apply nahi hui.'
        : 'Saved memory service abhi unavailable hai.';
      chatNotice.textContent = 'Ari chat kar sakta hai, par storage ready na ho to yeh conversation save nahi hogi.';
      if (!conversationId) startNewChat(false);
    }
  }

  async function loadConversation(id) {
    if (!signedInUser) return;
    chatNotice.textContent = '';
    chatTitle.textContent = 'Chat load ho rahi hai…';
    try {
      const data = await requestJson(`/api/chats?id=${encodeURIComponent(id)}`);
      conversationId = id;
      transcript = (Array.isArray(data.messages) ? data.messages : [])
        .filter(row => row && (row.role === 'user' || row.role === 'assistant') && typeof row.content === 'string')
        .map(row => ({ role: row.role, content: row.content }));
      const current = conversations.find(item => item.id === id);
      chatTitle.textContent = current ? current.title : 'Saved conversation';
      renderTranscript();
      renderConversations();
    } catch (error) {
      if (!showAuthError(error)) chatNotice.textContent = 'Saved chat load nahi hui. Thodi der baad dobara try karo.';
    }
  }

  function startNewChat(clearNotice = true) {
    conversationId = null;
    transcript = [];
    chatTitle.textContent = 'New conversation';
    deleteChatButton.hidden = true;
    if (clearNotice) chatNotice.textContent = '';
    renderTranscript();
    renderConversations();
    questionInput.focus({ preventScroll: true });
  }

  async function saveTurn(question, answer, metadata) {
    if (!memoryReady) return false;
    const data = await requestJson('/api/chats', {
      method: 'POST',
      body: JSON.stringify({
        action: 'save_turn',
        conversation_id: conversationId,
        question,
        answer,
        metadata: {
          agent: metadata.agent || 'Ari',
          model: metadata.model || 'local',
          source: metadata.source || 'unknown'
        }
      })
    });
    conversationId = data.conversation.id;
    const index = conversations.findIndex(item => item.id === conversationId);
    const savedConversation = data.conversation;
    if (index >= 0) conversations[index] = savedConversation;
    else conversations.unshift(savedConversation);
    conversations.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
    chatTitle.textContent = savedConversation.title || 'Saved conversation';
    memoryStatus.textContent = `${conversations.length} saved chat${conversations.length === 1 ? '' : 's'}`;
    renderConversations();
    return true;
  }

  emailForm.addEventListener('submit', async event => {
    event.preventDefault();
    const email = emailInput.value.trim().toLowerCase();
    if (!email) return;
    sendLinkButton.disabled = true;
    authStatus.textContent = 'Secure sign-in link ki request ja rahi hai…';
    try {
      await requestJson('/api/auth', { method: 'POST', body: JSON.stringify({ action: 'send_link', email }) });
      emailForm.hidden = true;
      linkStep.hidden = false;
      authStatus.textContent = 'Agar email sign-in ke liye available hai, inbox mein one-time link aayega. Spam folder bhi dekh lo; link isi browser mein kholo.';
    } catch (error) {
      authStatus.textContent = error.message || 'Sign-in request complete nahi hui.';
      sendLinkButton.disabled = false;
    }
  });

  for (const button of oauthButtons) {
    button.addEventListener('click', async () => {
      const provider = button.dataset.oauthProvider;
      if (!availableOAuthProviders.has(provider)) return;
      const providerName = provider === 'google' ? 'Google' : 'Discord';
      for (const socialButton of oauthButtons) socialButton.disabled = true;
      sendLinkButton.disabled = true;
      authStatus.textContent = `${providerName} se secure sign-in shuru ho raha hai…`;
      try {
        const data = await requestJson('/api/auth', {
          method: 'POST',
          body: JSON.stringify({ action: 'start_oauth', provider })
        });
        if (typeof data.authorizationUrl !== 'string') throw new Error('Secure sign-in URL nahi mila. Email link try karo.');
        window.location.assign(data.authorizationUrl);
      } catch (error) {
        authStatus.textContent = error.message || `${providerName} sign-in start nahi hua. Email link try karo.`;
        for (const socialButton of oauthButtons) {
          socialButton.disabled = !availableOAuthProviders.has(socialButton.dataset.oauthProvider);
        }
        sendLinkButton.disabled = false;
      }
    });
  }

  $('changeEmailButton').addEventListener('click', () => {
    linkStep.hidden = true;
    emailForm.hidden = false;
    sendLinkButton.disabled = false;
    authStatus.textContent = 'Apna email dalo; Ari free account ke liye sign-in link bhejega.';
    emailInput.focus();
  });

  $('logoutButton').addEventListener('click', async () => {
    $('logoutButton').disabled = true;
    try { await requestJson('/api/auth', { method: 'POST', body: JSON.stringify({ action: 'logout' }) }); }
    catch (_) { /* The browser still drops the private view; cookie expiry is server-controlled. */ }
    $('logoutButton').disabled = false;
    showLogin('Sign out ho gaya. Dobara sign in karne ke liye email link mangwao.');
  });

  $('newChatButton').addEventListener('click', () => startNewChat());

  deleteChatButton.addEventListener('click', async () => {
    if (!conversationId || !window.confirm('Is saved conversation ko permanently delete karna hai?')) return;
    deleteChatButton.disabled = true;
    try {
      await requestJson('/api/chats', {
        method: 'POST', body: JSON.stringify({ action: 'delete', conversation_id: conversationId })
      });
      conversations = conversations.filter(item => item.id !== conversationId);
      startNewChat();
      memoryStatus.textContent = conversations.length ? `${conversations.length} saved chat${conversations.length === 1 ? '' : 's'}` : 'Abhi koi saved chat nahi.';
    } catch (error) {
      if (!showAuthError(error)) chatNotice.textContent = 'Delete complete nahi hua. Dobara try karo.';
    } finally {
      deleteChatButton.disabled = false;
    }
  });

  composer.addEventListener('submit', async event => {
    event.preventDefault();
    const question = questionInput.value.trim();
    if (!question || busy || !signedInUser) return;
    busy = true;
    $('sendButton').disabled = true;
    chatNotice.textContent = '';
    const history = transcript.slice(-10).map(item => ({ role: item.role, content: item.content }));
    appendMessage('user', question);
    questionInput.value = '';
    const waiting = document.createElement('article');
    waiting.className = 'message assistant';
    waiting.id = 'waitingMessage';
    const label = document.createElement('span');
    label.className = 'message-label';
    label.textContent = 'ARI';
    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';
    bubble.textContent = 'Soch raha hoon…';
    waiting.append(label, bubble);
    messagesBox.append(waiting);
    messagesBox.scrollTop = messagesBox.scrollHeight;

    try {
      const data = await requestJson('/api/ask', {
        method: 'POST',
        body: JSON.stringify({ question, history, panel: panelMode, use_model: true })
      });
      waiting.remove();
      let answer = data.answer || 'Is sawaal ka jawab abhi nahi bana.';
      if (data.source === 'local-always-answer' && data.proactive_suggestion) answer += `\n\nAri ka suggestion: ${data.proactive_suggestion}`;
      appendMessage('assistant', answer);
      const modelText = data.source === 'openrouter'
        ? `Cloud model · ${data.model || 'free-tier model'}`
        : `Local fallback · ${data.provider_error || 'cloud model not configured'}`;
      modelStatus.textContent = modelText;
      if (data.provider_error) chatNotice.textContent = `AI provider status: ${data.provider_error}. Free-tier availability/quotas badal sakte hain.`;
      if (memoryReady) {
        try {
          await saveTurn(question, answer, data);
          if (chatNotice.textContent === '') chatNotice.textContent = 'Chat tumhare private account mein save ho gayi.';
        } catch (error) {
          if (showAuthError(error)) return;
          chatNotice.textContent = 'Jawab aa gaya, par saved memory mein save nahi hua. Dobara try karne se duplicate response generate ho sakta hai.';
        }
      }
    } catch (error) {
      waiting.remove();
      if (showAuthError(error)) return;
      chatNotice.textContent = error.message || 'Ari se connection nahi hua.';
    } finally {
      busy = false;
      $('sendButton').disabled = false;
      questionInput.focus({ preventScroll: true });
    }
  });

  $('panelToggle').addEventListener('click', event => {
    panelMode = !panelMode;
    event.currentTarget.setAttribute('aria-pressed', String(panelMode));
    event.currentTarget.classList.toggle('selected', panelMode);
  });

  $('listenButton').addEventListener('click', () => {
    if (!('speechSynthesis' in window)) {
      chatNotice.textContent = 'Is browser mein text-to-speech available nahi hai.';
      return;
    }
    const lastAnswer = [...transcript].reverse().find(item => item.role === 'assistant');
    if (!lastAnswer) {
      chatNotice.textContent = 'Pehle Ari ka jawab le lo; phir sun sakte ho.';
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(lastAnswer.content);
    utterance.lang = 'hi-IN';
    window.speechSynthesis.speak(utterance);
  });

  $('planButton').addEventListener('click', async () => {
    const brief = $('studioBrief').value.trim();
    if (!brief) {
      studioOutput.textContent = 'Pehle ek short brief likho.';
      return;
    }
    $('planButton').disabled = true;
    studioOutput.textContent = 'Safe planning preview ban raha hai…';
    try {
      const result = await requestJson('/api/studio', {
        method: 'POST',
        body: JSON.stringify({ brief, region: $('studioRegion').value })
      });
      studioOutput.textContent = JSON.stringify(result, null, 2);
    } catch (error) {
      if (!showAuthError(error)) studioOutput.textContent = `Plan nahi bana: ${error.message}`;
    } finally {
      $('planButton').disabled = false;
    }
  });

  document.querySelectorAll('[data-prompt]').forEach(button => {
    button.addEventListener('click', () => {
      questionInput.value = button.getAttribute('data-prompt') || '';
      questionInput.focus();
    });
  });

  questionInput.addEventListener('keydown', event => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      composer.requestSubmit();
    }
  });

  $('installButton').addEventListener('click', async () => {
    if (installPrompt) {
      installPrompt.prompt();
      await installPrompt.userChoice;
      installPrompt = null;
    } else {
      chatNotice.textContent = 'Android: browser menu → Install app / Add to Home screen. iPhone: Safari Share → Add to Home Screen. HTTPS chahiye.';
    }
  });

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    installPrompt = event;
  });

  async function consumeMagicLink() {
    const query = new URLSearchParams(window.location.search);
    const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const params = fragment.has('access_token') || fragment.has('error') ? fragment : query;
    const code = query.get('code') || fragment.get('code') || '';
    const accessToken = params.get('access_token') || '';
    const refreshToken = params.get('refresh_token') || '';
    const errorDescription = params.get('error_description') || params.get('error') || '';
    if (!code && !accessToken && !refreshToken && !errorDescription) return false;

    // Remove one-time auth material from the address bar before making any API request.
    window.history.replaceState({}, document.title, window.location.pathname);
    if (errorDescription) {
      showLogin('Sign-in cancel ya fail hua. Dobara try karo, ya email link use karo.');
      return true;
    }
    if (!code && (!accessToken || !refreshToken)) {
      showLogin('Sign-in link incomplete tha. Naya link mangwa kar isi browser mein kholo.');
      return true;
    }

    authStatus.textContent = 'Secure sign-in verify ho raha hai…';
    try {
      const payload = { action: 'exchange_link' };
      if (code) payload.code = code;
      else Object.assign(payload, { access_token: accessToken, refresh_token: refreshToken });
      const data = await requestJson('/api/auth', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      showApp(data.user);
    } catch (error) {
      showLogin(error.message || 'Sign-in complete nahi hua. Dobara try karo ya email link mangwao.');
    }
    return true;
  }

  async function boot() {
    if ('serviceWorker' in navigator && window.isSecureContext) {
      window.addEventListener('load', () => navigator.serviceWorker.register('/service-worker.js').catch(() => {}));
    }
    if (await consumeMagicLink()) {
      if (!signedInUser) await loadOAuthProviders();
      return;
    }
    await loadOAuthProviders();
    try {
      const data = await requestJson('/api/auth?action=session');
      sendLinkButton.disabled = false;
      showApp(data.user);
    } catch (error) {
      if (error.code === 'private_auth_not_configured') {
        showLogin('Private sign-in abhi server par configure nahi hai. Fail-closed: workspace open nahi hoga.', true);
      } else if (error.code === 'auth_service_unavailable') {
        showLogin('Sign-in service temporarily unavailable hai. Thodi der baad try karo.');
      } else {
        showLogin('Free account sign-in ready. Apna email dalo.');
      }
    }
  }

  boot();
})();
