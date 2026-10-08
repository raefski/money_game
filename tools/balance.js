#!/usr/bin/env node
/* Balance check: a simulated player plays shifts (holding down, aiming at the
   best cluster with some error, 5 s between shifts) and buys whatever pays back
   fastest. Prints when each charter is signed and how much of the income comes
   from crews.  Usage: node tools/balance.js [hours]   (default 5) */
'use strict';
const path = require('path');
const E = require(path.join(__dirname, '..', 'economy.js'));
const M = require(path.join(__dirname, '..', 'mining.js'));

const HOURS = Number(process.argv[2]) || 5;
const BETWEEN_SHIFTS = 5;   // seconds spent on the report screen
const AIM_NOISE = Number(process.env.AIM_NOISE || 0.3); // aim error, as a share of the pick's reach

const cache = new Map();
function shiftGold(mine) {
  const key = JSON.stringify(mine);
  if (!cache.has(key)) {
    let g = 0;
    for (let i = 0; i < 2; i++) g += M.simulate(mine, { seed: 900 + i, aspect: 0.62, noise: AIM_NOISE }).gold;
    cache.set(key, g / 2);
  }
  return cache.get(key);
}
const shiftRate = (st) => { const d = E.derive(st); return shiftGold(d.mine) * d.dollarsPerOz / (d.mine.duration + BETWEEN_SHIFTS); };
const income = (st) => { const d = E.derive(st); return shiftRate(st) + d.paceShare * (shiftGold(d.mine) / d.mine.duration) * d.dollarsPerOz; };
const clone = (st) => JSON.parse(JSON.stringify(st));

function bestMap(st) {
  let best = null, bv = -1;
  for (const m of E.derive(st).maps) { st.settings.map = m; const v = shiftRate(st); if (v > bv) { bv = v; best = m; } }
  st.settings.map = best;
}

const s = E.createState(0);
const times = {};
const passive = [];
let t = 0, n = 0;
while (t < HOURS * 3600 && !s.run.charters.c1968) {
  bestMap(s);
  const d = E.derive(s);
  const res = M.simulate(d.mine, { seed: ++n, aspect: 0.62, noise: AIM_NOISE });
  E.deposit(s, res.gold, d);
  E.recordShift(s, res);
  const dt = d.mine.duration + BETWEEN_SHIFTS;
  const shift$ = res.gold * d.dollarsPerOz, crews$ = d.dollarRate * dt;
  passive.push([t, crews$ / Math.max(1e-9, shift$ + crews$)]);
  E.simulate(s, dt);
  t += dt;
  // buy greedily: best payback first, waiting for something better only if it is close
  for (let guard = 0; guard < 60; guard++) {
    const base = income(s);
    let best = null;
    const consider = (id, cost, apply, isCharter) => {
      const c = clone(s); apply(c);
      let gain = income(c) - base;
      if (isCharter) gain = Math.max(gain, base * 0.35); // history opens new things: always worth it
      if (!(gain > 0)) return;
      const score = cost / gain + Math.max(0, cost - s.dollars) / Math.max(base, 1e-9);
      if (!best || score < best.score) best = { id, cost, score };
    };
    for (const it of E.ITEMS) {
      if (E.status(s, it) !== 'available') continue;
      const q = E.quote(s, it, 1);
      if (it.kind === 'permit') {
        consider(it.id, q.cost + E.BUILDING_BY_ID[it.site].unitCost, (c) => { c.dollars = 1e300; E.buy(c, it.id, 1); c.run.buildings[it.site]++; }, false);
      } else {
        consider(it.id, q.cost, (c) => { c.dollars = 1e300; E.buy(c, it.id, 1); }, it.kind === 'charter');
      }
    }
    for (const b of E.BUILDINGS) {
      if (E.hasPermit(s, b.id)) consider(`site:${b.id}`, E.buildingCost(b, s.run.buildings[b.id], 1), (c) => { c.run.buildings[b.id]++; }, false);
    }
    if (!best || best.cost > s.dollars) break;
    if (best.id.startsWith('site:')) E.buyBuilding(s, best.id.slice(5), 1);
    else {
      const r = E.buy(s, best.id, 1);
      if (r.ok && r.item.kind === 'charter') times[best.id] = t;
      if (r.ok && r.item.kind === 'permit') E.buyBuilding(s, r.item.site, 1);
    }
  }
}

const min = (x) => (x / 60).toFixed(0);
console.log(`Simulated ${min(t)} min, ${s.run.shifts} shifts.`);
console.log('Charter signed at minute:');
console.log('  ' + E.CHARTERS.slice(1).map((c) => `${Math.floor(c.year)}@${times[c.id] != null ? min(times[c.id]) : '-'}`).join(' '));
const at = (m) => { const e = passive.find(([tt]) => tt / 60 >= m); return e ? `${Math.round(e[1] * 100)}%` : '-'; };
console.log('Share of income from crews at minute 15/30/60/90/120/180: ' + [15, 30, 60, 90, 120, 180].map(at).join(' '));
console.log('Crews per site: ' + E.BUILDINGS.map((b) => `${b.id} ${s.run.buildings[b.id]}`).join(', '));

// DUMP=1: what a shift looks like on each mine at the end of the run
if (process.env.DUMP) {
  const d = E.derive(s);
  console.log('Pick at the end:', JSON.stringify({ radius: Math.round(d.mine.radius), damage: Math.round(d.mine.damage), swing: d.mine.swing.toFixed(2), duration: d.mine.duration, cap: d.mine.cap, dynamite: d.mine.dynamite }));
  console.log('Levels:', ['radius', 'damage', 'speed', 'duration', 'ground', 'assay', 'crit', 'critmult', 'luck', 'dynamite', 'drill'].map((k) => `${k} ${E.level(s, k)}`).join(', '));
  for (const m of d.maps) {
    s.settings.map = m;
    const mine = E.derive(s).mine;
    const r = M.simulate(mine, { seed: 5, aspect: 0.62, noise: AIM_NOISE });
    console.log(`  ${m.padEnd(10)} hp×${E.MAP_BY_ID[m].hp} gold ${E.fmt(r.gold, 1)} oz in ${mine.duration}s, rock broken ${r.ore}`);
  }
}
