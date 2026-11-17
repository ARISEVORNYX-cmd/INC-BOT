'use strict';

const DEMO_HTML = `<!doctype html>
<html lang="hi">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="theme-color" content="#090e15">
  <meta name="robots" content="noindex,nofollow,noarchive,nosnippet">
  <meta name="description" content="Ari interface demo with fictional, in-memory sample content only.">
  <link rel="stylesheet" href="/styles.css">
  <link rel="stylesheet" href="/demo.css">
  <script src="/demo.js" defer></script>
  <title>Ari — Safe Demo Preview</title>
</head>
<body>
  <div class="page-shell demo-shell">
    <header class="topbar">
      <a class="brand" href="/" aria-label="Ari sign-in page">
        <img class="avatar" src="/icons/ari-avatar.png" alt="Ari, fictional AI avatar">
        <span><strong>Ari</strong><small>INTERFACE DEMO</small></span>
      </a>
      <div class="privacy-chip demo-chip"><span class="status-dot"></span><span>PREVIEW · FAKE DATA</span></div>
    </header>

    <main class="demo-main">
      <section class="demo-warning" aria-label="Demo privacy notice">
        <span class="demo-warning-icon" aria-hidden="true">◇</span>
        <div>
          <strong>Safe demo — sirf interface test ke liye</strong>
          <p>Yahan messages fictional hain. Is preview mein login, Supabase, private chats, protected app APIs, ya real AI use nahi hota. Tumhara demo input sirf is tab ki memory mein rehta hai; save nahi hota.</p>
        </div>
      </section>

      <section class="app-heading demo-heading">
        <div>
          <p class="eyebrow">PERSONAL ARI · SANDBOX</p>
          <h1>Apne ideas ko shape do.</h1>
          <p class="subheading">Layout aur controls try karo. Replies scripted examples hain, real AI answers nahi.</p>
        </div>
        <a class="quiet-button demo-back" href="/">Back to private sign-in</a>
      </section>

      <div class="workspace">
        <aside class="history-panel" aria-label="Fictional sample chats">
          <div class="history-heading">
            <div><p class="eyebrow">SAMPLE ONLY</p><h2>Demo chats</h2></div>
            <button id="demoNewChat" class="icon-button" type="button" aria-label="Clear demo conversation" title="Clear demo">＋</button>
          </div>
          <p class="memory-status">Fictional examples · not saved</p>
          <nav class="conversation-list" aria-label="Choose a sample conversation">
            <button class="conversation-item" type="button" data-demo-thread="launch" aria-current="page"><span>AI product launch · sample</span></button>
            <button class="conversation-item" type="button" data-demo-thread="creative" aria-current="false"><span>Creative idea · sample</span></button>
          </nav>
          <div class="storage-note"><span aria-hidden="true">▣</span><span>Yeh sample chats nahi hain tumhari personal history. Reload karne par demo reset ho jayega.</span></div>
        </aside>

        <section class="chat-panel" aria-label="Ari interface sandbox">
          <div class="chat-toolbar">
            <div><span class="live-mark"></span><span id="demoChatTitle">AI product launch · sample</span></div>
            <button id="demoRoleToggle" class="quiet-button" type="button" aria-pressed="false">5-role UI demo</button>
          </div>
          <div id="demoWelcome" class="welcome-state">
            <div class="welcome-orb"><img src="/icons/ari-avatar.png" alt=""></div>
            <h2>Yahan app try karo.</h2>
            <p>Prompt bhejne par sirf fixed demo reply dikhega; koi request AI ya private API ko nahi bheji jaati.</p>
            <div class="suggestion-row">
              <button class="suggestion-button" type="button" data-demo-prompt="Mere AI product ke liye ek launch plan banao.">Launch plan ✦</button>
              <button class="suggestion-button" type="button" data-demo-prompt="Ek short creative reel ka idea do.">Creative idea ◌</button>
            </div>
          </div>
          <div id="demoMessages" class="messages" aria-live="polite" aria-relevant="additions text"></div>
          <p id="demoNotice" class="chat-notice demo-notice" role="status" aria-live="polite">Demo mode · messages sirf tab band/reload hone tak.</p>
          <div class="composer demo-composer">
            <label class="visually-hidden" for="demoQuestion">Demo prompt</label>
            <textarea id="demoQuestion" rows="1" maxlength="1000" placeholder="Koi sample prompt try karo…"></textarea>
            <div class="composer-footer">
              <span class="model-status">Scripted reply · no AI call</span>
              <div class="composer-actions">
                <button id="demoPlanButton" class="quiet-button" type="button">Plan demo</button>
                <button id="demoSendButton" class="send-button" type="button">Try sample <span aria-hidden="true">↑</span></button>
              </div>
            </div>
          </div>
        </section>
      </div>

      <details class="studio-card demo-studio">
        <summary><span class="summary-icon">✳</span><span><strong>Creative Studio · demo</strong><small>Fake, local planning preview — kuch save ya send nahi hota.</small></span><span class="summary-arrow" aria-hidden="true">⌄</span></summary>
        <div class="studio-content">
          <label for="demoBrief">Sample brief</label>
          <textarea id="demoBrief" rows="3" maxlength="1000" placeholder="Example: 20-second product launch reel…"></textarea>
          <div class="studio-controls"><span class="market-label">India + worldwide</span><button id="demoStudioButton" class="quiet-button" type="button">Show demo plan</button></div>
          <pre id="demoStudioOutput" class="studio-output" aria-live="polite">Fixed example plan will appear here.</pre>
        </div>
      </details>

      <footer class="page-footer demo-footer">Safe preview only · Production Ari remains owner-login protected · Demo prompts are not saved</footer>
    </main>
  </div>
</body>
</html>`;

module.exports = (req, res) => {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet');

  if (String(req.method || 'GET').toUpperCase() !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  if (process.env.VERCEL_ENV !== 'preview') {
    return res.status(404).json({ error: 'not_found' });
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('X-Ari-Demo-Mode', 'preview-only');
  return res.status(200).send(DEMO_HTML);
};
