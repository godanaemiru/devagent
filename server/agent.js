'use strict';
const https = require('https');

const MODEL = 'llama-3.3-70b-versatile';

function stripFences(text) {
  return text
    .replace(/^```(?:javascript|js|json)?\r?\n?/m, '')
    .replace(/\r?\n?```$/m, '')
    .trim();
}

function parseJSON(text) {
  const clean = stripFences(text);

  const start = clean.search(/[{[]/);
  if (start !== -1) {
    try { return JSON.parse(clean.slice(start)); } catch {}
  }

  const arr = clean.match(/\[[\s\S]*\]/);
  if (arr) { try { return JSON.parse(arr[0]); } catch {} }

  const obj = clean.match(/\{[\s\S]*\}/);
  if (obj) { try { return JSON.parse(obj[0]); } catch {} }

  throw new Error('No JSON found in: ' + clean.slice(0, 120));
}

function groqPost(messages, maxTokens) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      messages,
    });
    const req = https.request({
      hostname: 'api.groq.com',
      path: '/openai/v1/chat/completions',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${(process.env.GROQ_API_KEY || '').trim()}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(Buffer.concat(chunks).toString());
          if (parsed.error) return reject(new Error(parsed.error.message));
          resolve(parsed.choices[0].message.content);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function groqStream(messages, maxTokens, onToken) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      stream: true,
      messages,
    });
    const req = https.request({
      hostname: 'api.groq.com',
      path: '/openai/v1/chat/completions',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${(process.env.GROQ_API_KEY || '').trim()}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let buf = '';
      let full = '';
      res.on('data', chunk => {
        buf += chunk.toString();
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const line of lines) {
          if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
          try {
            const text = JSON.parse(line.slice(6)).choices?.[0]?.delta?.content || '';
            if (text) { full += text; onToken(text); }
          } catch {}
        }
      });
      res.on('end', () => resolve(full));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function planTask(request) {
  const text = await groqPost([{
    role: 'user',
    content: `You are a coding agent. Analyze this task and respond with ONLY a JSON object — no other text, no markdown.

Task: "${request}"

{"name":"camelCaseName","signature":"name(param1, param2)","summary":"one line goal","plan":["step 1","step 2","step 3","step 4"]}`,
  }], 512);
  const result = parseJSON(text);
  if (!Array.isArray(result.plan)) {
    result.plan = typeof result.plan === 'string'
      ? result.plan.split('\n').map(s => s.replace(/^[-*\d.]+\s*/, '').trim()).filter(Boolean)
      : [];
  }
  return result;
}

async function writeCode(request, spec, onToken) {
  const code = await groqStream([{
    role: 'user',
    content: `You are a coding agent. Write a JavaScript function.

Task: "${request}"
Function signature: ${spec.signature}

Rules:
- Output ONLY the JavaScript function — no markdown fences, no explanation, no imports, no module.exports
- The code runs in a Node.js vm context where require is not available
- Use only built-in JS (String, Array, Math, RegExp, etc.)`,
  }], 2048, onToken);
  return stripFences(code);
}

async function writeTests(request, code, funcName) {
  try {
    const text = await groqPost([{
      role: 'user',
      content: `You are a test engineer. Write tests for this JavaScript function. Respond with ONLY a JSON array — no markdown, no explanation.

Task: "${request}"

Code:
${code}

Format: [{"name":"description","call":"${funcName}(args)","expect":value}]

Rules:
- Exactly 5 tests covering happy path and edge cases
- "call" must be a valid JS expression using only the function and literals
- "expect" must be JSON-serializable (string, number, boolean, or array of primitives only)
- The function is already defined in scope — do not redefine it
- Keep test names short (under 40 chars)`,
    }], 2048);
    return parseJSON(text);
  } catch (err) {
    console.error('writeTests parse failed:', err.message);
    return [];
  }
}

async function fixCode(code, failingTest, onToken) {
  const fixed = await groqStream([{
    role: 'user',
    content: `You are a debugging agent. Fix this JavaScript function. Output ONLY the corrected function — no markdown, no explanation.

Current code:
${code}

Failing test: ${failingTest.call}
Expected: ${JSON.stringify(failingTest.expect)}
Got: ${failingTest.actual}

Fix the bug. Do not change the function signature.`,
  }], 2048, onToken);
  return stripFences(fixed);
}

module.exports = { planTask, writeCode, writeTests, fixCode };
