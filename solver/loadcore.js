'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadCore(htmlPath) {
  const html = fs.readFileSync(htmlPath || path.join(__dirname, '..', 'index.html'), 'utf8');
  const m = html.match(/<script id="core-src">([\s\S]*?)<\/script>/);
  if (!m) throw new Error('core-src script missing from index.html');
  const context = { module: { exports: {} }, exports: {}, console: console };
  context.self = context;
  context.global = context;
  vm.runInNewContext(m[1], context, { filename: 'core.js' });
  return context.module.exports;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

module.exports = { loadCore: loadCore, mulberry32: mulberry32 };
