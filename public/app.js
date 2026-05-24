'use strict';

/* ── Session ── */
const SESSION_KEY = 'devagent_session_v1';
let sessionId = localStorage.getItem(SESSION_KEY);
if (!sessionId) {
  sessionId = crypto.randomUUID();
  localStorage.setItem(SESSION_KEY, sessionId);
}

/* ── DOM refs ── */
const $ = s => document.querySelector(s);
const logEl     = $('#log');
const wsEl      = $('#workspace');
const pipeEl    = $('#pipeline');
const runBtn    = $('#runBtn');
const taskEl    = $('#task');
const statusText = $('#statusText');
const statusDot  = $('#statusDot');
const iterBadge  = $('#iterBadge');
const wsLabel    = $('#wsLabel');

/* ── Pipeline ── */
const STAGES = [
  { k: 'plan', ico: '◈', name: 'Plan'     },
  { k: 'code', ico: '⌨', name: 'Code'     },
  { k: 'test', ico: '⚑', name: 'Test'     },
  { k: 'run',  ico: '▶', name: 'Run'      },
  { k: 'fix',  ico: '⟲', name: 'Self-Fix' },
  { k: 'ship', ico: '✓', name: 'Ship'     },
];

function renderPipeline(activeKey, doneKeys = []) {
  pipeEl.innerHTML = STAGES.map(s => {
    const cls = doneKeys.includes(s.k) ? 'done' : (s.k === activeKey ? 'active' : '');
    return `<div class="stage ${cls}"><div class="stage-ico">${s.ico}</div><div class="stage-name">${s.name}</div></div>`;
  }).join('');
}
renderPipeline(null);

/* ── Presets ── */
const PRESETS = [
  { label: '<b>TICKET-204</b> Title-case a sentence (whitespace-safe)', text: 'Write a function that takes a sentence and returns it with each word capitalized (title case), preserving the original spacing.' },
  { label: '<b>TICKET-118</b> FizzBuzz generator 1..n',                 text: 'Implement fizzbuzz: return an array of strings for 1 to n.' },
  { label: '<b>TICKET-377</b> Robust email validator',                  text: 'Write a function to validate an email address and reject malformed ones.' },
  { label: '<b>TICKET-091</b> Palindrome checker',                      text: 'Check whether a string is a palindrome, ignoring case and punctuation.' },
  { label: '<b>TICKET-256</b> Dedupe array, keep order',                text: 'Remove duplicates from an array while preserving the original order.' },
];

$('#presets').innerHTML = PRESETS.map((p, i) => `<button class="preset" data-i="${i}">${p.label}</button>`).join('');
$('#presets').addEventListener('click', e => {
  const b = e.target.closest('.preset');
  if (!b) return;
  taskEl.value = PRESETS[+b.dataset.i].text;
});

/* ── Helpers ── */
const sleep = ms => new Promise(r => setTimeout(r, ms));
let _tick = 0;
const now = () => String(++_tick).padStart(2, '0');
const resetTick = () => { _tick = 0; };
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function clearLog() { logEl.innerHTML = ''; resetTick(); }

function logInstant(who, html) {
  const div = document.createElement('div');
  div.className = 'log-line';
  div.innerHTML = `<div class="log-tick">[${now()}]</div><div class="log-body"><span class="who ${esc(who)}">${esc(who)}</span>${html}</div>`;
  logEl.appendChild(div);
  logEl.scrollTop = logEl.scrollHeight;
}

async function typeOut(html, who) {
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const words = text.split(' ').filter(Boolean).slice(0, 14);

  const div = document.createElement('div');
  div.className = 'log-line';
  div.innerHTML = `<div class="log-tick">[${now()}]</div><div class="log-body"><span class="who ${esc(who)}">${esc(who)}</span><span class="stream"></span></div>`;
  logEl.appendChild(div);
  const span = div.querySelector('.stream');

  for (let i = 0; i < words.length; i++) {
    span.innerHTML = words.slice(0, i + 1).join(' ') + '<span class="cursor"></span>';
    logEl.scrollTop = logEl.scrollHeight;
    await sleep(22);
  }
  span.innerHTML = html;
  logEl.scrollTop = logEl.scrollHeight;
}

/* ── Code rendering ── */
function highlight(code) {
  const e = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return e
    .replace(/(\/\/[^\n]*)/g, '<span class="com">$1</span>')
    .replace(/\b(function|return|const|let|var|for|if|else|new|typeof|of|false|true)\b/g, '<span class="kw">$1</span>')
    .replace(/\b(\d+)\b/g, '<span class="num">$1</span>')
    .replace(/(&quot;[^&]*?&quot;|"[^"]*"|'[^']*')/g, '<span class="str">$1</span>');
}

function renderCode(source, flashClass = '') {
  const lines = source.split('\n');
  const body = lines.map((l, i) => `<span class="ln">${i + 1}</span>${highlight(l)}`).join('\n');
  wsEl.innerHTML = `<div class="code-wrap ${flashClass}"><pre>${body}</pre></div><div id="testArea"></div>`;
}

function renderCodePartial(partial) {
  const lines = partial.split('\n');
  const body = lines.map((l, i) => `<span class="ln">${i + 1}</span>${highlight(l)}`).join('\n');
  let codeWrap = wsEl.querySelector('.code-wrap');
  if (!codeWrap) {
    wsEl.innerHTML = `<div class="code-wrap"><pre></pre></div><div id="testArea"></div>`;
    codeWrap = wsEl.querySelector('.code-wrap');
  }
  codeWrap.querySelector('pre').innerHTML = body;
}

function renderTests(results) {
  const area = document.getElementById('testArea');
  if (!area) return;
  const rows = results.map(r => `
    <div class="test-row ${r.pass ? 'pass' : 'fail'}">
      <span class="test-badge">${r.pass ? '✓' : '✕'}</span>
      <div style="flex:1">
        <div class="test-name">${esc(r.name)}</div>
        ${r.pass ? '' : `<div class="test-detail">${esc(r.call)} → expected <b>${esc(String(r.expect))}</b>, got <b>${esc(String(r.actual))}</b></div>`}
      </div>
    </div>`).join('');
  area.innerHTML = `<div style="margin-top:18px"><div class="sec-label">// test suite — server execution</div>${rows}</div>`;
}

function renderVerdict(event) {
  const area = document.getElementById('testArea');
  if (!area) return;
  if (event.status === 'win') {
    const v = document.createElement('div');
    v.className = 'verdict win';
    v.innerHTML = `<span class="vt">✓ shipped — task complete</span>
      Autonomously delivered a verified <code>${esc(event.specName)}()</code> with a passing test suite${event.selfFixed ? ', after self-diagnosing and repairing 1 bug' : ' on the first attempt'}.
      <div class="vstat">
        <div><b>${event.testsTotal || '—'}</b> tests</div>
        <div><b>${event.testsPassed}/${event.testsTotal || '—'}</b> passing</div>
        <div><b>${event.iterations}</b> iteration${event.iterations !== 1 ? 's' : ''}</div>
        <div><b>0</b> human edits</div>
      </div>
      <button class="copy-btn" id="copyCodeBtn">⧉ Copy code</button>`;
    area.appendChild(v);
    document.getElementById('copyCodeBtn').addEventListener('click', () => {
      const pre = wsEl.querySelector('pre');
      if (!pre) return;
      navigator.clipboard.writeText(pre.innerText).then(() => {
        const btn = document.getElementById('copyCodeBtn');
        if (btn) { btn.textContent = '✓ Copied'; setTimeout(() => { btn.textContent = '⧉ Copy code'; }, 2000); }
      });
    });
    area.scrollIntoView({ behavior: 'smooth', block: 'end' });
    statusText.textContent = 'shipped ✓';
  } else {
    statusText.textContent = 'escalated';
  }
}

/* ── History ── */
function timeAgo(ts) {
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 60)    return 'just now';
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

async function loadHistory() {
  try {
    const resp = await fetch(`/api/tasks?sessionId=${encodeURIComponent(sessionId)}`);
    const { tasks } = await resp.json();
    renderHistory(tasks);
  } catch (e) {
    console.error('History load failed:', e);
  }
}

function renderHistory(tasks) {
  const el = document.getElementById('history-list');
  if (!tasks.length) {
    el.innerHTML = '<div class="hist-empty">No tasks yet. Dispatch your first agent.</div>';
    return;
  }
  el.innerHTML = tasks.map(t => {
    const verdict = t.verdict || 'pending';
    const name = t.spec_name ? t.spec_name + '.js' : 'running…';
    const meta = `${verdict} · ${t.tests_passed}/${t.tests_total} tests · ${timeAgo(t.created_at)}`;
    const preview = t.request.length > 50 ? t.request.slice(0, 50) + '…' : t.request;
    return `<div class="hist-item ${esc(verdict)}" data-id="${esc(t.id)}">
      <button class="hist-del" data-del="${esc(t.id)}" title="Delete">✕</button>
      <div class="hist-name">${esc(name)}</div>
      <div class="hist-meta">${esc(meta)}</div>
      <div class="hist-req">${esc(preview)}</div>
    </div>`;
  }).join('');
}

document.getElementById('history-list').addEventListener('click', async e => {
  const del = e.target.closest('[data-del]');
  if (del) {
    e.stopPropagation();
    await fetch(`/api/tasks/${encodeURIComponent(del.dataset.del)}`, { method: 'DELETE' });
    await loadHistory();
    return;
  }
  const item = e.target.closest('[data-id]');
  if (item) loadSavedTask(item.dataset.id);
});

$('#clearAllBtn').addEventListener('click', async () => {
  try {
    await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/tasks`, { method: 'DELETE' });
    await loadHistory();
  } catch (e) {
    console.error('Clear all failed:', e);
  }
});

async function loadSavedTask(taskId) {
  try {
    const resp = await fetch(`/api/tasks/${encodeURIComponent(taskId)}`);
    const { task } = await resp.json();

    taskEl.value = task.request;
    clearLog();
    wsEl.innerHTML = '<div class="empty"><span class="big">loading…</span></div>';
    wsLabel.textContent = task.spec_name ? task.spec_name + '.js' : '—';
    statusText.textContent = task.verdict || 'idle';
    statusDot.classList.remove('live');
    iterBadge.innerHTML = '';

    const doneStages = ['plan', 'code', 'test', 'run'];
    if ((task.iterations || 0) > 0) doneStages.push('fix');
    if (task.verdict === 'shipped') doneStages.push('ship');
    renderPipeline(null, doneStages);

    if (task.log_json) {
      JSON.parse(task.log_json).forEach(e => logInstant(e.who, e.html));
    }
    if (task.final_source) renderCode(task.final_source);
    if (task.final_results_json) renderTests(JSON.parse(task.final_results_json));
  } catch (e) {
    console.error('Load saved task failed:', e);
  }
}

/* ── Agent event handler ── */
async function handleAgentEvent(event) {
  switch (event.type) {
    case 'start':
      break;
    case 'wsLabel':
      wsLabel.textContent = event.label;
      break;
    case 'stage':
      renderPipeline(event.stage, event.done);
      break;
    case 'log':
      await typeOut(event.html, event.who);
      break;
    case 'codeToken':
      renderCodePartial(event.partial);
      break;
    case 'code':
      renderCode(event.source, event.flash === 'ok' ? 'codeflash-ok' : event.flash ? 'codeflash' : '');
      break;
    case 'tests':
      renderTests(event.results);
      break;
    case 'iteration':
      iterBadge.innerHTML = event.attempt
        ? `<span class="iter-tag">iteration ${event.attempt}</span>`
        : '';
      break;
    case 'verdict':
      renderVerdict(event);
      break;
    case 'done':
      statusDot.classList.remove('live');
      loadHistory();
      break;
    case 'error':
      logInstant('sys', `Agent error: ${esc(event.message)}`);
      statusText.textContent = 'error';
      statusDot.classList.remove('live');
      break;
  }
}

/* ── Main dispatch ── */
let running = false;

async function dispatch() {
  if (running) return;
  const request = taskEl.value.trim();
  if (!request) { taskEl.focus(); return; }

  running = true;
  runBtn.disabled = true;
  runBtn.textContent = '⏳ Agent working…';
  statusDot.classList.add('live');
  statusText.textContent = 'running';
  clearLog();
  wsEl.innerHTML = '<div class="empty"><span class="big">workspace booting…</span></div>';
  iterBadge.innerHTML = '';
  wsLabel.textContent = '—';
  renderPipeline(null);

  try {
    const response = await fetch('/api/tasks/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task: request, sessionId }),
    });

    if (!response.ok) throw new Error(`Server error ${response.status}`);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            await handleAgentEvent(JSON.parse(line.slice(6)));
          } catch (e) {
            console.error('Event parse error:', e);
          }
        }
      }
    }
  } catch (err) {
    logInstant('sys', `Connection error: ${esc(err.message)}`);
    statusText.textContent = 'error';
    statusDot.classList.remove('live');
  }

  runBtn.disabled = false;
  runBtn.textContent = '▶ Dispatch Agent';
  running = false;
}

runBtn.addEventListener('click', dispatch);
taskEl.addEventListener('keydown', e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') dispatch(); });

/* ── Init ── */
loadHistory();
