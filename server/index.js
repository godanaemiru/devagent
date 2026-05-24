'use strict';
require('dotenv').config();
const express = require('express');
const path = require('path');
const { planTask, writeCode, writeTests, fixCode } = require('./agent');
const { runTests } = require('./sandbox');
const { ensureSession, createTask, updateTask, getTask, getSessionTasks, deleteTask, clearSessionTasks } = require('./db');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* ─── REST ─────────────────────────────────────────────────────── */

app.get('/api/tasks', (req, res) => {
  const { sessionId } = req.query;
  if (!sessionId) return res.status(400).json({ error: 'sessionId required' });
  ensureSession(sessionId);
  res.json({ tasks: getSessionTasks(sessionId) });
});

app.get('/api/tasks/:id', (req, res) => {
  const task = getTask(req.params.id);
  if (!task) return res.status(404).json({ error: 'not found' });
  res.json({ task });
});

app.delete('/api/tasks/:id', (req, res) => {
  deleteTask(req.params.id);
  res.status(204).end();
});

app.delete('/api/sessions/:sessionId/tasks', (req, res) => {
  clearSessionTasks(req.params.sessionId);
  res.status(204).end();
});

/* ─── AGENT LOOP (SSE) ──────────────────────────────────────────── */

app.post('/api/tasks/run', async (req, res) => {
  const { task: request, sessionId } = req.body;
  if (!request || !sessionId) return res.status(400).json({ error: 'task and sessionId required' });

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
    'Transfer-Encoding': 'chunked',
  });
  res.flushHeaders();

  let aborted = false;
  res.on('close', () => { aborted = true; });

  const send = (type, data = {}) => {
    if (!aborted) res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
  };

  ensureSession(sessionId);
  const taskId = createTask(sessionId, request);
  send('start', { taskId });

  const log = [];
  const addLog = (who, html) => {
    log.push({ who, html });
    send('log', { who, html });
  };

  const done = [];
  let finalSource = '';
  let finalResults = [];
  let verdict = 'escalated';

  try {
    /* ── 1. PLAN ── */
    send('stage', { stage: 'plan', done: [...done] });
    if (aborted) return res.end();
    addLog('plan', 'Received task. Analysing intent and decomposing into a plan…');

    const spec = await planTask(request);
    if (aborted) return res.end();

    send('wsLabel', { label: spec.name + '.js' });
    addLog('plan', `Identified function → <code>${esc(spec.signature)}</code>`);
    addLog('plan', esc(spec.summary));
    for (const step of spec.plan) {
      addLog('sys', `<span class="bullet">${esc(step)}</span>`);
    }
    done.push('plan');

    /* ── 2. CODE ── */
    send('stage', { stage: 'code', done: [...done] });
    if (aborted) return res.end();
    addLog('code', 'Writing implementation…');

    let codeBuf = '';
    finalSource = await writeCode(request, spec, (token) => {
      if (aborted) return;
      codeBuf += token;
      send('codeToken', { partial: codeBuf });
    });
    if (aborted) return res.end();

    send('code', { source: finalSource, flash: '' });
    addLog('code', `Wrote <code>${esc(spec.name)}()</code> — ${finalSource.split('\n').length} lines.`);
    done.push('code');

    /* ── 3. TEST ── */
    send('stage', { stage: 'test', done: [...done] });
    if (aborted) return res.end();
    addLog('test', 'Generating test suite…');

    const tests = await writeTests(request, finalSource, spec.name);
    if (aborted) return res.end();

    if (tests.length === 0) {
      addLog('test', 'Could not generate tests — shipping without test validation.');
      verdict = 'shipped';
      done.push('ship');
      send('stage', { stage: 'ship', done: [...done] });
      send('verdict', { status: 'win', specName: spec.name, selfFixed: false, testsTotal: 0, testsPassed: 0, iterations: 1 });
      updateTask(taskId, { spec_name: spec.name, verdict, iterations: 0, tests_total: 0, tests_passed: 0, log_json: JSON.stringify(log), final_source: finalSource, final_results_json: '[]' });
      send('done', { taskId });
      return res.end();
    }

    addLog('test', `Authored <code>${tests.length}</code> test cases covering edge conditions.`);
    done.push('test');

    /* ── 4. RUN ── */
    send('stage', { stage: 'run', done: [...done] });
    if (aborted) return res.end();
    addLog('run', 'Executing code against the suite in a sandboxed Node.js vm context…');
    let results = runTests(finalSource, tests);
    send('tests', { results });
    let passed = results.filter(r => r.pass).length;
    let failed = results.length - passed;

    if (failed > 0) {
      addLog('run', `Result: <b style="color:var(--green)">${passed} passed</b>, <b style="color:var(--red)">${failed} failed</b>. The agent will self-correct.`);
    } else {
      addLog('run', `Result: <b style="color:var(--green)">all ${passed} passed</b> on the first attempt.`);
    }
    finalResults = results;

    /* ── 5. SELF-FIX ── */
    let attempt = 1;
    while (failed > 0 && attempt <= 2 && !aborted) {
      send('iteration', { attempt });
      send('stage', { stage: 'fix', done: [...done] });

      const firstFail = results.find(r => !r.pass);
      addLog('fix', 'Test failure detected. Reading the diff and diagnosing root cause…');
      addLog('fix', `Failing case: <code>${esc(firstFail.call)}</code> → expected <b>${esc(String(firstFail.expect))}</b>, got <b style="color:var(--red)">${esc(String(firstFail.actual))}</b>`);
      addLog('fix', 'Patching the implementation…');

      let fixBuf = '';
      finalSource = await fixCode(finalSource, firstFail, (token) => {
        if (aborted) return;
        fixBuf += token;
        send('codeToken', { partial: fixBuf });
      });
      if (aborted) return res.end();

      send('code', { source: finalSource, flash: 'ok' });
      addLog('fix', 'Patch applied. Re-running full suite to confirm the fix…');
      if (!done.includes('fix')) done.push('fix');

      send('stage', { stage: 'run', done: [...done] });
      results = runTests(finalSource, tests);
      send('tests', { results });
      passed = results.filter(r => r.pass).length;
      failed = results.length - passed;
      addLog('run', `Result: <b style="color:var(--green)">${passed} passed</b>${failed ? `, <b style="color:var(--red)">${failed} failed</b>` : ''}.`);
      finalResults = results;
      attempt++;
    }
    send('iteration', { attempt: null });

    /* ── 6. SHIP ── */
    if (failed === 0) {
      verdict = 'shipped';
      done.push('ship');
      send('stage', { stage: 'ship', done: [...done] });
      addLog('ship', 'All tests green. Finalising and shipping the verified function.');
      send('verdict', {
        status: 'win',
        specName: spec.name,
        selfFixed: done.includes('fix'),
        testsTotal: tests.length,
        testsPassed: passed,
        iterations: done.includes('fix') ? 2 : 1,
      });
    } else {
      send('stage', { stage: 'fix', done: [...done] });
      addLog('fix', 'Could not converge within the retry budget. Escalating to a human reviewer.');
      send('verdict', { status: 'fail' });
    }

    updateTask(taskId, {
      spec_name: spec.name,
      verdict,
      iterations: attempt - 1,
      tests_total: tests.length,
      tests_passed: passed,
      log_json: JSON.stringify(log),
      final_source: finalSource,
      final_results_json: JSON.stringify(finalResults),
    });

    send('done', { taskId });

  } catch (err) {
    console.error('Agent error:', err);
    send('error', { message: err.message });
  }

  res.end();
});

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`DEVAGENT → http://localhost:${PORT}`));
}

module.exports = app;
