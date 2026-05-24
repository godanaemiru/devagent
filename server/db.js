'use strict';
const fs   = require('fs');
const path = require('path');

const DATA_DIR = process.env.VERCEL ? '/tmp' : path.join(__dirname, '..', 'data');
const DB_FILE  = path.join(DATA_DIR, 'devagent.json');

fs.mkdirSync(DATA_DIR, { recursive: true });

function load() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
  catch { return { sessions: {}, tasks: {} }; }
}

function save(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function ensureSession(id) {
  const db = load();
  if (!db.sessions[id]) {
    db.sessions[id] = { id, created_at: ts() };
    save(db);
  }
}

function createTask(sessionId, request) {
  const db = load();
  const id = crypto.randomUUID();
  db.tasks[id] = {
    id, session_id: sessionId, request,
    spec_name: null, verdict: null,
    iterations: 0, tests_total: 0, tests_passed: 0,
    log_json: null, final_source: null, final_results_json: null,
    created_at: ts(),
  };
  save(db);
  return id;
}

function updateTask(id, updates) {
  const db = load();
  if (db.tasks[id]) { Object.assign(db.tasks[id], updates); save(db); }
}

function getTask(id) {
  return load().tasks[id] || null;
}

function getSessionTasks(sessionId) {
  const tasks = Object.values(load().tasks)
    .filter(t => t.session_id === sessionId)
    .sort((a, b) => b.created_at - a.created_at);
  return tasks.map(({ id, request, spec_name, verdict, iterations, tests_total, tests_passed, created_at }) =>
    ({ id, request, spec_name, verdict, iterations, tests_total, tests_passed, created_at }));
}

function deleteTask(id) {
  const db = load(); delete db.tasks[id]; save(db);
}

function clearSessionTasks(sessionId) {
  const db = load();
  Object.keys(db.tasks).forEach(id => {
    if (db.tasks[id].session_id === sessionId) delete db.tasks[id];
  });
  save(db);
}

const ts = () => Math.floor(Date.now() / 1000);

module.exports = { ensureSession, createTask, updateTask, getTask, getSessionTasks, deleteTask, clearSessionTasks };
