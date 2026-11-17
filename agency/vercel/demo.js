'use strict';

(() => {
  const $ = id => document.getElementById(id);
  const messages = $('demoMessages');
  const welcome = $('demoWelcome');
  const input = $('demoQuestion');
  const notice = $('demoNotice');
  const title = $('demoChatTitle');
  const transcript = [];

  const samples = {
    launch: {
      title: 'AI product launch · sample',
      messages: [
        { role: 'user', content: 'Mere AI product ke liye ek simple launch plan?' },
        { role: 'assistant', content: 'DEMO SAMPLE — Pehle ek audience aur ek clear problem chuno. Chhota prototype banao, 5 logon se feedback lo, phir ek haftay ka launch checklist set karo. Yeh fictional canned example hai; koi AI call nahi hui.' }
      ]
    },
    creative: {
      title: 'Creative idea · sample',
      messages: [
        { role: 'user', content: 'Ek short creative reel ka idea do.' },
        { role: 'assistant', content: 'DEMO SAMPLE — 3 quick scenes: problem, small transformation, clear result. Har scene ko ek visual cue do aur end mein simple call-to-action rakho. Yeh fixed sample hai, generated answer nahi.' }
      ]
    }
  };

  function appendMessage(role, content) {
    const article = document.createElement('article');
    article.className = `message ${role === 'user' ? 'user' : 'assistant'}`;
    const label = document.createElement('span');
    label.className = 'message-label';
    label.textContent = role === 'user' ? 'SAMPLE USER' : 'ARI · DEMO';
    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';
    bubble.textContent = String(content || '');
    article.append(label, bubble);
    messages.append(article);
    messages.scrollTop = messages.scrollHeight;
  }

  function renderSample(id) {
    const sample = samples[id];
    if (!sample) return;
    transcript.splice(0, transcript.length, ...sample.messages.map(item => ({ ...item })));
    title.textContent = sample.title;
    messages.replaceChildren();
    transcript.forEach(item => appendMessage(item.role, item.content));
    welcome.hidden = transcript.length > 0;
    notice.textContent = 'Fictional sample thread · not saved';
    document.querySelectorAll('[data-demo-thread]').forEach(button => {
      button.setAttribute('aria-current', button.getAttribute('data-demo-thread') === id ? 'page' : 'false');
    });
  }

  function startEmptyDemo() {
    transcript.length = 0;
    messages.replaceChildren();
    title.textContent = 'New demo conversation';
    welcome.hidden = false;
    notice.textContent = 'Demo mode · messages only live in this tab';
    document.querySelectorAll('[data-demo-thread]').forEach(button => button.setAttribute('aria-current', 'false'));
    input.focus({ preventScroll: true });
  }

  function sendSample() {
    const question = input.value.trim();
    if (!question) {
      notice.textContent = 'Pehle koi sample prompt type karo.';
      input.focus();
      return;
    }
    transcript.push({ role: 'user', content: question });
    appendMessage('user', question);
    const answer = 'DEMO SCRIPTED RESPONSE — Ek clear goal chuno, usse chhote next steps mein baanto, aur pehle ek low-risk test karo. Yeh fixed example hai, personalized AI answer nahi. Tumhara prompt kisi server ya model ko nahi bheja gaya.';
    transcript.push({ role: 'assistant', content: answer });
    appendMessage('assistant', answer);
    title.textContent = 'New demo conversation';
    welcome.hidden = true;
    notice.textContent = 'Scripted reply only · nothing sent or saved';
    input.value = '';
    input.focus({ preventScroll: true });
  }

  document.querySelectorAll('[data-demo-thread]').forEach(button => {
    button.addEventListener('click', () => renderSample(button.getAttribute('data-demo-thread')));
  });
  document.querySelectorAll('[data-demo-prompt]').forEach(button => {
    button.addEventListener('click', () => {
      input.value = button.getAttribute('data-demo-prompt') || '';
      input.focus();
    });
  });

  $('demoNewChat').addEventListener('click', startEmptyDemo);
  $('demoSendButton').addEventListener('click', sendSample);
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      sendSample();
    }
  });

  const roleToggle = $('demoRoleToggle');
  roleToggle.addEventListener('click', () => {
    const enabled = roleToggle.getAttribute('aria-pressed') !== 'true';
    roleToggle.setAttribute('aria-pressed', String(enabled));
    roleToggle.classList.toggle('selected', enabled);
    notice.textContent = enabled
      ? 'UI toggle only · koi specialist ya agent start nahi hua'
      : 'Demo mode · messages sirf tab band/reload hone tak';
  });

  $('demoPlanButton').addEventListener('click', () => {
    $('demoStudioOutput').textContent = 'DEMO PLAN (fixed example)\n1. Goal aur audience likho.\n2. Ek chhota prototype choose karo.\n3. Review ke liye 3 questions banao.\n\nNo real planning API was called.';
  });

  $('demoStudioButton').addEventListener('click', () => {
    const brief = $('demoBrief').value.trim();
    $('demoStudioOutput').textContent = brief
      ? `DEMO PLAN for this local-only brief:\n${brief.slice(0, 160)}\n\n1. Goal define karo.\n2. Ek small first draft banao.\n3. Feedback ke baad iterate karo.\n\nFixed template only · not sent or saved.`
      : 'Pehle koi fake sample brief likho. Yeh local demo hai; kuch server par nahi jayega.';
  });

  renderSample('launch');
})();
