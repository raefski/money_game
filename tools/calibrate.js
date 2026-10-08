#!/usr/bin/env node
/* Fit charter prices to a target timeline with the balance bot, then write
   them into economy.js.  Usage: node tools/calibrate.js [scale]
   `scale` stretches the whole target timeline (default 1). Charter reserve
   gates are left as they are. */
'use strict';
const fs = require('fs');
const path = require('path');
const { run, E } = require('./balance.js');

const SCALE = Number(process.argv[2]) || 1;
// minute at which the bot should sign each charter
const TARGET = {
  c1849: 2, c1850: 4, c1853: 8, c1859: 12, c1860: 16, c1861: 20, c1867: 25, c1869: 30, c1873: 36, c1876: 43,
  c1879: 50, c1880: 56, c1887: 65, c1897: 74, c1900: 83, c1913: 94, c1934: 106, c1936: 118, c1944: 131, c1945: 144, c1968: 160,
};
const ids = Object.keys(TARGET);
const nice = (v) => Number(v.toPrecision(2));
const setCost = (id, v) => { E.CHARTER_BY_ID[id].cost = v; E.ITEM_BY_ID[id].cost = v; };

let res;
for (let iter = 0; iter < 10; iter++) {
  res = run(8);
  let err = 0;
  const line = [];
  for (const id of ids) {
    const T = res.times[id] != null ? res.times[id] / 60 : null;
    const goal = TARGET[id] * SCALE;
    err += T == null ? 3 : Math.abs(Math.log(T / goal));
    line.push(`${id.slice(1)}@${T == null ? '-' : T.toFixed(0)}`);
    const f = T == null ? 0.4 : Math.pow(goal / Math.max(T, 0.5), 0.9);
    setCost(id, E.CHARTER_BY_ID[id].cost * Math.min(3, Math.max(0.4, f)));
  }
  for (let i = 1; i < ids.length; i++) setCost(ids[i], Math.max(E.CHARTER_BY_ID[ids[i]].cost, E.CHARTER_BY_ID[ids[i - 1]].cost * 1.3));
  console.log(`iter ${iter}: error ${err.toFixed(2)} | ${line.join(' ')}`);
  if (err < 1.5) break;
}

// write the fitted prices into economy.js
const file = path.join(__dirname, '..', 'economy.js');
let src = fs.readFileSync(file, 'utf8');
for (const id of ids) {
  const re = new RegExp(`(\\{ id: '${id}',[^\\n]*?cost: )(\\d+(?:\\.\\d+)?(?:e\\d+)?)`);
  if (!re.test(src)) throw new Error(`charter ${id} not found`);
  src = src.replace(re, `$1${nice(E.CHARTER_BY_ID[id].cost)}`);
}
fs.writeFileSync(file, src);
console.log('wrote prices:', ids.map((id) => `${id.slice(1)} ${E.fmtUSD(nice(E.CHARTER_BY_ID[id].cost))}`).join(' | '));
