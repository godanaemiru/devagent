'use strict';
const vm = require('vm');

function fmt(v) {
  return typeof v === 'string' ? v : JSON.stringify(v);
}

function deepEq(a, b) {
  if (typeof a === 'string' || typeof a === 'number' || typeof a === 'boolean') return a === b;
  return JSON.stringify(a) === JSON.stringify(b);
}

function runTests(source, tests) {
  const ctx = vm.createContext({});

  try {
    new vm.Script(source).runInContext(ctx, { timeout: 3000 });
  } catch (err) {
    return tests.map(t => ({
      name: t.name, call: t.call, expect: t.expect,
      actual: 'Error: ' + err.message, pass: false,
    }));
  }

  return tests.map(t => {
    let actual, error = null;
    try {
      actual = new vm.Script(t.call).runInContext(ctx, { timeout: 1000 });
    } catch (err) {
      error = String(err);
    }
    const pass = error === null && deepEq(actual, t.expect);
    return { name: t.name, call: t.call, expect: t.expect, actual: error != null ? error : fmt(actual), pass };
  });
}

module.exports = { runTests };
