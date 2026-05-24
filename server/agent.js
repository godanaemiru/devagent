'use strict';
const OpenAI = require('openai');

const client = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: 'https://api.groq.com/openai/v1',
});
const MODEL = 'llama-3.3-70b-versatile';

function stripFences(text) {
  return text
    .replace(/^```(?:javascript|js|json)?\r?\n?/m, '')
    .replace(/\r?\n?```$/m, '')
    .trim();
}

function parseJSON(text) {
  const clean = stripFences(text);

  // Try from first JSON delimiter
  const start = clean.search(/[{[]/);
  if (start !== -1) {
    try { return JSON.parse(clean.slice(start)); } catch {}
  }

  // Try greedy extraction of array or object
  const arr = clean.match(/\[[\s\S]*\]/);
  if (arr) { try { return JSON.parse(arr[0]); } catch {} }

  const obj = clean.match(/\{[\s\S]*\}/);
  if (obj) { try { return JSON.parse(obj[0]); } catch {} }

  throw new Error('No JSON found in: ' + clean.slice(0, 120));
}

async function planTask(request) {
  const resp = await client.chat.completions.create({
    model: MODEL,
    max_tokens: 512,
    messages: [{
      role: 'user',
      content: `You are a coding agent. Analyze this task and respond with ONLY a JSON object — no other text, no markdown.

Task: "${request}"

{"name":"camelCaseName","signature":"name(param1, param2)","summary":"one line goal","plan":["step 1","step 2","step 3","step 4"]}`,
    }],
  });
  const result = parseJSON(resp.choices[0].message.content);
  // Normalise plan to array in case model returned a string
  if (!Array.isArray(result.plan)) {
    result.plan = typeof result.plan === 'string'
      ? result.plan.split('\n').map(s => s.replace(/^[-*\d.]+\s*/, '').trim()).filter(Boolean)
      : [];
  }
  return result;
}

async function writeCode(request, spec, onToken) {
  const stream = await client.chat.completions.create({
    model: MODEL,
    max_tokens: 2048,
    stream: true,
    messages: [{
      role: 'user',
      content: `You are a coding agent. Write a JavaScript function.

Task: "${request}"
Function signature: ${spec.signature}

Rules:
- Output ONLY the JavaScript function — no markdown fences, no explanation, no imports, no module.exports
- The code runs in a Node.js vm context where require is not available
- Use only built-in JS (String, Array, Math, RegExp, etc.)`,
    }],
  });

  let code = '';
  for await (const chunk of stream) {
    const text = chunk.choices[0]?.delta?.content || '';
    if (text) {
      code += text;
      if (onToken) onToken(text);
    }
  }
  return stripFences(code);
}

async function writeTests(request, code, funcName) {
  const resp = await client.chat.completions.create({
    model: MODEL,
    max_tokens: 2048,
    messages: [{
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
    }],
  });
  try {
    return parseJSON(resp.choices[0].message.content);
  } catch (err) {
    console.error('writeTests parse failed:', err.message);
    return [];
  }
}

async function fixCode(code, failingTest, onToken) {
  const stream = await client.chat.completions.create({
    model: MODEL,
    max_tokens: 2048,
    stream: true,
    messages: [{
      role: 'user',
      content: `You are a debugging agent. Fix this JavaScript function. Output ONLY the corrected function — no markdown, no explanation.

Current code:
${code}

Failing test: ${failingTest.call}
Expected: ${JSON.stringify(failingTest.expect)}
Got: ${failingTest.actual}

Fix the bug. Do not change the function signature.`,
    }],
  });

  let fixed = '';
  for await (const chunk of stream) {
    const text = chunk.choices[0]?.delta?.content || '';
    if (text) {
      fixed += text;
      if (onToken) onToken(text);
    }
  }
  return stripFences(fixed);
}

module.exports = { planTask, writeCode, writeTests, fixCode };
