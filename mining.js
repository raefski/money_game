/* ==========================================================================
   FULL FAITH & CREDIT — mining.js
   The mining shift: a timed round at the rock face. Your pick hits every rock
   inside its reach; broken rock pays gold. The pure model (spawning, strikes,
   dynamite, the timer) touches no DOM, so balancing runs the same rules in
   Node. createView() draws a shift on a canvas and turns mouse and touch
   input into strikes.
   ========================================================================== */
(function (root) {
  'use strict';

  // Logical field area in units². Width and height follow the screen's
  // aspect, but the area (and so the rock density) is the same everywhere.
  const AREA = 620000;

  const ORES = {
    rock: { r: 25, hp: 2, gold: 0.035, weight: 52 },
    quartz: { r: 29, hp: 4, gold: 0.2, weight: 38 },
    nugget: { r: 17, hp: 2, gold: 1.0, weight: 6 },
    vein: { r: 38, hp: 14, gold: 1.6, weight: 5 },   // after the Hydraulic Mining charter
    lode: { r: 64, hp: 90, gold: 40 },               // the Mother Lode: at most one per shift
  };
  const BLAST_DAMAGE = 0.6;   // dynamite hits for this share of pick damage
  const MAX_BLASTS = 30;      // chain reactions stop here, per strike
  const TOUCH_LIFT = 88;      // CSS px: default height of the pick above the fingertip on touch

  function rng(seed) {
    let s = (seed >>> 0) || 1;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }

  function fieldSize(aspect) {
    const a = Math.min(1.6, Math.max(0.45, aspect || 0.62));
    const h = Math.sqrt(AREA * a);
    return { w: AREA / h, h };
  }

  /* ------------------------------------------------------------------------
   * Model
   * --------------------------------------------------------------------- */
  function createShift(stats, opts = {}) {
    const f = fieldSize(opts.aspect);
    const s = {
      stats, w: f.w, h: f.h, t: 0, over: false, ores: [], nextId: 1, spawnAcc: 0,
      rand: rng(opts.seed || 1), gold: 0, ore: 0, crits: 0, best: 0, lodes: 0, lodeGold: 0, strikes: 0,
      events: [], lodeAt: null,
    };
    if (s.rand() < stats.lodeChance) s.lodeAt = stats.duration * (0.2 + s.rand() * 0.45);
    for (let i = 0; i < stats.cap; i++) spawn(s);
    s.events.length = 0; // the opening rocks don't need spawn effects
    return s;
  }

  function pickType(s) {
    let total = 0;
    const pool = [];
    for (const k of ['rock', 'quartz', 'nugget', 'vein']) {
      if (k === 'vein' && !s.stats.veins) continue;
      pool.push([k, ORES[k].weight]);
      total += ORES[k].weight;
    }
    let r = s.rand() * total;
    for (const [k, w] of pool) if ((r -= w) < 0) return k;
    return 'rock';
  }

  function spawn(s, type) {
    type = type || pickType(s);
    const base = ORES[type];
    const r = base.r * (0.9 + s.rand() * 0.2);
    let x = s.w / 2, y = s.h / 2;
    for (let tries = 0; tries < 16; tries++) {
      x = r + 8 + s.rand() * (s.w - 2 * r - 16);
      y = r + 8 + s.rand() * (s.h - 2 * r - 16);
      if (s.ores.every((o) => Math.hypot(o.x - x, o.y - y) > o.r + r + 4)) break;
    }
    const hp = base.hp * s.stats.hpMult;
    const o = { id: s.nextId++, type, x, y, r, hp, maxHp: hp, gold: base.gold * s.stats.goldMult, seed: Math.floor(s.rand() * 1e9), born: s.t };
    s.ores.push(o);
    s.events.push({ type: 'spawn', ore: o });
    return o;
  }

  function update(s, dt) {
    if (s.over) return;
    s.t += dt;
    const st = s.stats;
    let rocks = 0;
    for (const o of s.ores) if (o.type !== 'lode') rocks++;
    if (rocks < st.cap) {
      s.spawnAcc += dt;
      while (s.spawnAcc >= st.respawn && rocks < st.cap) { spawn(s); rocks++; s.spawnAcc -= st.respawn; }
    } else {
      s.spawnAcc = 0;
    }
    if (s.lodeAt !== null && s.t >= s.lodeAt) {
      s.lodeAt = null;
      s.events.push({ type: 'lode', ore: spawn(s, 'lode') });
    }
    if (s.t >= st.duration) {
      s.t = st.duration;
      s.over = true;
      s.events.push({ type: 'end' });
    }
  }

  function hurt(s, o, dmg, crit, queue) {
    if (o.dead) return 0;
    o.hp -= dmg;
    s.events.push({ type: 'hit', ore: o, dmg, crit });
    if (o.hp > 0) return 0;
    o.dead = true;
    s.ore++;
    s.gold += o.gold;
    if (o.type === 'lode') { s.lodes++; s.lodeGold += o.gold; }
    s.events.push({ type: 'break', ore: o, gold: o.gold, crit });
    if (s.stats.dynamite && s.rand() < s.stats.dynamite) queue.push({ x: o.x, y: o.y });
    return o.gold;
  }

  /** One swing at (x, y): every rock within reach takes damage. Returns gold won. */
  function strike(s, x, y, source = 'pick') {
    if (s.over) return null;
    const st = s.stats;
    s.strikes++;
    const crit = s.rand() < st.critChance;
    if (crit) s.crits++;
    const dmg = st.damage * (crit ? st.critMult : 1);
    const queue = [];
    let gold = 0, hits = 0;
    for (const o of s.ores) {
      if (Math.hypot(o.x - x, o.y - y) <= st.radius + o.r * 0.6) {
        hits++;
        gold += hurt(s, o, dmg, crit, queue);
      }
    }
    s.events.push({ type: 'swing', x, y, crit, hits, source });
    let blasts = 0;
    while (queue.length && blasts < MAX_BLASTS) {
      const b = queue.shift();
      blasts++;
      s.events.push({ type: 'blast', x: b.x, y: b.y, r: st.blast });
      for (const o of s.ores) {
        if (!o.dead && Math.hypot(o.x - b.x, o.y - b.y) <= st.blast + o.r * 0.5) gold += hurt(s, o, st.damage * BLAST_DAMAGE, false, queue);
      }
    }
    s.ores = s.ores.filter((o) => !o.dead);
    if (gold > s.best) s.best = gold;
    return { gold, crit, hits };
  }

  /** Where a sensible player would aim: the rock with the most breakable gold around it. */
  function bestAim(s, noise = 0) {
    const R = s.stats.radius, D = s.stats.damage;
    let best = null, score = -1;
    for (const c of s.ores) {
      let v = 0;
      for (const o of s.ores) {
        if (Math.hypot(o.x - c.x, o.y - c.y) <= R + o.r * 0.6) v += o.gold * Math.min(1, D / Math.max(o.hp, 1e-9)) + 0.001;
      }
      if (v > score) { score = v; best = c; }
    }
    if (!best) return { x: s.w / 2, y: s.h / 2 };
    return { x: best.x + (s.rand() - 0.5) * 2 * noise * R, y: best.y + (s.rand() - 0.5) * 2 * noise * R };
  }

  /** Play a whole shift with a simulated player who holds down and aims well. */
  function simulate(stats, opts = {}) {
    const s = createShift(stats, opts);
    const dt = 1 / 30;
    const noise = opts.noise == null ? 0.3 : opts.noise;
    const interval = Math.max(stats.swing, 1 / (opts.cps || 1e9));
    let nextPick = 0;
    let nextDrill = stats.drill ? stats.swing / stats.drill : Infinity;
    while (!s.over) {
      update(s, dt);
      if (s.over) break;
      if (s.t >= nextPick) { const p = bestAim(s, noise); strike(s, p.x, p.y); nextPick = Math.max(nextPick + interval, s.t); }
      if (s.t >= nextDrill) { const p = bestAim(s, noise); strike(s, p.x, p.y, 'drill'); nextDrill += stats.swing / stats.drill; }
      s.events.length = 0;
    }
    return { gold: s.gold, ore: s.ore, crits: s.crits, lodes: s.lodes, lodeGold: s.lodeGold, best: s.best, strikes: s.strikes, duration: stats.duration };
  }

  /* ------------------------------------------------------------------------
   * View: canvas rendering and input
   * --------------------------------------------------------------------- */
  const PALETTES = {
    california: { bg1: '#2c2218', bg2: '#110c07', streak: 'rgba(255, 210, 150, 0.05)', speck: 'rgba(255, 230, 190, 0.07)',
      rock: '#6f5e4c', rockLt: '#8e7b65', rockDk: '#4a3e31', quartz: '#ddd5c6', quartzLt: '#f3eee4', quartzDk: '#a89d8b', host: '#3b3129' },
    comstock: { bg1: '#21262f', bg2: '#0b0e13', streak: 'rgba(190, 210, 240, 0.05)', speck: 'rgba(220, 230, 255, 0.07)',
      rock: '#5d6372', rockLt: '#7b8292', rockDk: '#3d424e', quartz: '#cfd4de', quartzLt: '#eef1f6', quartzDk: '#9da4b2', host: '#2f333d' },
    blackhills: { bg1: '#1d221c', bg2: '#0a0c09', streak: 'rgba(200, 220, 180, 0.05)', speck: 'rgba(220, 235, 210, 0.06)',
      rock: '#4e5448', rockLt: '#6b7263', rockDk: '#33382f', quartz: '#d4d7c7', quartzLt: '#eff1e6', quartzDk: '#a2a693', host: '#2a2e25' },
    klondike: { bg1: '#1f2c39', bg2: '#0a1118', streak: 'rgba(200, 230, 255, 0.06)', speck: 'rgba(240, 248, 255, 0.12)',
      rock: '#63778b', rockLt: '#8398ac', rockDk: '#435466', quartz: '#e9f1f8', quartzLt: '#ffffff', quartzDk: '#b4c3d1', host: '#36465a', snow: true },
  };
  const GOLD = '#f5c542', GOLD_LT = '#ffe39a', GOLD_DK = '#a8740c';
  // Pick heads by tier (see Economy.PICK_HEADS): rusty iron → diamond-tipped.
  const PICKS = [
    { head: '#7d5a45', edge: '#a07a5e' }, { head: '#5f6874', edge: '#97a1ad' }, { head: '#9fabba', edge: '#e6ecf3' },
    { head: '#4f77a3', edge: '#b4d3f2' }, { head: '#c9ced8', edge: '#ffffff', glow: 'rgba(220, 232, 255, 0.55)' },
    { head: '#f5c542', edge: '#fff1b8', glow: 'rgba(255, 205, 80, 0.7)' }, { head: '#78e3ff', edge: '#effdff', glow: 'rgba(110, 225, 255, 0.8)' },
  ];
  const PAD_GAIN = 1.6;       // control pad: field distance moved per pad distance

  /** Per-rock shape, facets, flecks and crack lines, from its seed. */
  function shapeOf(o) {
    if (o.shape) return o.shape;
    const rand = rng(o.seed);
    const n = o.type === 'nugget' ? 9 : 8 + Math.floor(rand() * 3);
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rand() * 0.35;
      const k = o.type === 'nugget' ? 0.8 + rand() * 0.25 : 0.78 + rand() * 0.24;
      pts.push([Math.cos(a) * k, Math.sin(a) * k]);
    }
    const flecks = [];
    const fleckCount = o.type === 'quartz' ? 6 : o.type === 'rock' ? 2 : 0;
    for (let i = 0; i < fleckCount; i++) flecks.push([(rand() - 0.5) * 1.1, (rand() - 0.5) * 1.1, 0.05 + rand() * 0.07]);
    const veins = [];
    const veinCount = o.type === 'vein' ? 3 : o.type === 'lode' ? 6 : 0;
    for (let i = 0; i < veinCount; i++) {
      const a = rand() * Math.PI;
      const dx = Math.cos(a), dy = Math.sin(a);
      veins.push([-dx * 0.75, -dy * 0.75, (rand() - 0.5) * 0.6, (rand() - 0.5) * 0.6, dx * 0.75, dy * 0.75, 0.08 + rand() * 0.07]);
    }
    const cracks = [];
    for (let i = 0; i < 4; i++) {
      const a = rand() * Math.PI * 2;
      const seg = [[0, 0]];
      let x = 0, y = 0;
      for (let j = 0; j < 3; j++) {
        x += Math.cos(a + (rand() - 0.5) * 1.2) * 0.28;
        y += Math.sin(a + (rand() - 0.5) * 1.2) * 0.28;
        seg.push([x, y]);
      }
      cracks.push(seg);
    }
    o.shape = { pts, flecks, veins, cracks, tilt: rand() * Math.PI };
    return o.shape;
  }

  function createView(canvas, opts = {}) {
    const ctx = canvas.getContext('2d');
    const view = {
      shift: null, running: false, paused: false,
      aim: null, finger: null, holding: false, queued: false, lastStrike: -1e9, nextDrill: 0,
      particles: [], popups: [], rings: [], swingT: 0, shakeT: 0,
      scale: 1, ox: 0, oy: 0, cssW: 0, cssH: 0, dpr: 1, bg: null, bgKey: '',
      accent: '#f5c542', reduced: false, pointerType: 'mouse', lift: TOUCH_LIFT,
    };

    function readAccent() {
      const v = getComputedStyle(canvas).getPropertyValue('--accent').trim();
      if (v) view.accent = v;
    }

    function resize() {
      const rect = canvas.getBoundingClientRect();
      view.cssW = Math.max(1, rect.width);
      view.cssH = Math.max(1, rect.height);
      view.dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(view.cssW * view.dpr);
      canvas.height = Math.round(view.cssH * view.dpr);
      fit();
      view.bgKey = '';
      readAccent();
    }

    function fit() {
      const s = view.shift;
      const f = s ? { w: s.w, h: s.h } : fieldSize(view.cssH / view.cssW);
      view.scale = Math.min(view.cssW / f.w, view.cssH / f.h);
      view.ox = (view.cssW - f.w * view.scale) / 2;
      view.oy = (view.cssH - f.h * view.scale) / 2;
    }

    /**
     * Where a pointer aims, in field units. A fingertip would hide the rock it
     * is breaking, so on touch the pick floats view.lift px above it. Near the
     * bottom edge the lift shrinks, so every rock stays reachable.
     */
    function aimFrom(e) {
      const rect = canvas.getBoundingClientRect();
      const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
      if (e.pointerType !== 'touch') {
        view.finger = null;
        return { x: (cx - view.ox) / view.scale, y: (cy - view.oy) / view.scale };
      }
      const top = view.oy;
      const bottom = view.shift ? view.oy + view.shift.h * view.scale : view.cssH;
      const ay = Math.min(bottom, Math.max(top, cy - Math.min(view.lift, Math.max(0, bottom - cy))));
      view.finger = { x: (cx - view.ox) / view.scale, y: (cy - view.oy) / view.scale };
      return { x: (cx - view.ox) / view.scale, y: (ay - view.oy) / view.scale };
    }

    function paletteFor() {
      return PALETTES[(view.shift && view.shift.stats.map) || 'california'] || PALETTES.california;
    }

    /* ---- background: the rock face, cached per size and mine ---- */
    function background() {
      const pal = paletteFor();
      const key = `${canvas.width}x${canvas.height}|${(view.shift && view.shift.stats.map) || ''}`;
      if (key === view.bgKey && view.bg) return view.bg;
      const c = document.createElement('canvas');
      c.width = canvas.width;
      c.height = canvas.height;
      const g = c.getContext('2d');
      const grad = g.createLinearGradient(0, 0, 0, c.height);
      grad.addColorStop(0, pal.bg1);
      grad.addColorStop(1, pal.bg2);
      g.fillStyle = grad;
      g.fillRect(0, 0, c.width, c.height);
      const rand = rng(7 + c.width);
      g.strokeStyle = pal.streak;
      for (let i = 0; i < 9; i++) {
        g.lineWidth = (1 + rand() * 3) * view.dpr;
        g.beginPath();
        let y = rand() * c.height;
        g.moveTo(0, y);
        for (let x = 0; x <= c.width; x += c.width / 8) { y += (rand() - 0.5) * 30 * view.dpr; g.lineTo(x, y); }
        g.stroke();
      }
      g.fillStyle = pal.speck;
      for (let i = 0; i < 260; i++) g.fillRect(rand() * c.width, rand() * c.height, (1 + rand() * 2) * view.dpr, (1 + rand() * 2) * view.dpr);
      if (pal.snow) {
        g.fillStyle = 'rgba(255,255,255,0.18)';
        for (let i = 0; i < 120; i++) { g.beginPath(); g.arc(rand() * c.width, rand() * c.height, (0.8 + rand() * 1.6) * view.dpr, 0, Math.PI * 2); g.fill(); }
      }
      const vig = g.createRadialGradient(c.width / 2, c.height / 2, c.height * 0.2, c.width / 2, c.height / 2, Math.max(c.width, c.height) * 0.75);
      vig.addColorStop(0, 'rgba(255, 200, 120, 0.06)');
      vig.addColorStop(1, 'rgba(0, 0, 0, 0.55)');
      g.fillStyle = vig;
      g.fillRect(0, 0, c.width, c.height);
      view.bg = c;
      view.bgKey = key;
      return c;
    }

    /* ---- rocks ---- */
    function polygon(pts, r) {
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x * r, y * r) : ctx.moveTo(x * r, y * r)));
      ctx.closePath();
    }

    function drawOre(o, now) {
      const pal = paletteFor();
      const sh = shapeOf(o);
      const age = now - o.born;
      const pop = age < 0.18 ? 0.6 + (age / 0.18) * 0.4 : 1;
      let jx = 0, jy = 0;
      if (o.shake > 0) { jx = (Math.random() - 0.5) * 3; jy = (Math.random() - 0.5) * 3; }
      const r = o.r * pop;
      ctx.save();
      ctx.translate(o.x + jx, o.y + jy);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath();
      ctx.ellipse(r * 0.12, r * 0.82, r * 0.9, r * 0.24, 0, 0, Math.PI * 2);
      ctx.fill();
      if (o.type === 'lode') {
        const pulse = 0.55 + 0.25 * Math.sin(now * 5);
        const glow = ctx.createRadialGradient(0, 0, r * 0.4, 0, 0, r * 1.7);
        glow.addColorStop(0, `rgba(255, 210, 90, ${pulse})`);
        glow.addColorStop(1, 'rgba(255, 180, 0, 0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(0, 0, r * 1.7, 0, Math.PI * 2);
        ctx.fill();
      }
      if (o.type === 'nugget') {
        const g = ctx.createLinearGradient(-r, -r, r, r);
        g.addColorStop(0, '#fff1b8');
        g.addColorStop(0.45, GOLD);
        g.addColorStop(1, GOLD_DK);
        ctx.fillStyle = g;
        polygon(sh.pts, r);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        ctx.beginPath();
        ctx.ellipse(-r * 0.3, -r * 0.35, r * 0.28, r * 0.14, -0.6, 0, Math.PI * 2);
        ctx.fill();
      } else {
        const quartz = o.type === 'quartz';
        const host = o.type === 'vein' || o.type === 'lode';
        const g = ctx.createLinearGradient(-r, -r, r, r);
        g.addColorStop(0, quartz ? pal.quartzLt : host ? pal.rockLt : pal.rockLt);
        g.addColorStop(0.55, quartz ? pal.quartz : host ? pal.host : pal.rock);
        g.addColorStop(1, quartz ? pal.quartzDk : pal.rockDk);
        ctx.fillStyle = g;
        polygon(sh.pts, r);
        ctx.fill();
        // facets: a lighter wedge top-left, a darker one bottom-right
        ctx.fillStyle = 'rgba(255,255,255,0.10)';
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(sh.pts[4 % sh.pts.length][0] * r, sh.pts[4 % sh.pts.length][1] * r); ctx.lineTo(sh.pts[5 % sh.pts.length][0] * r, sh.pts[5 % sh.pts.length][1] * r); ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(0,0,0,0.16)';
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(sh.pts[0][0] * r, sh.pts[0][1] * r); ctx.lineTo(sh.pts[1][0] * r, sh.pts[1][1] * r); ctx.closePath(); ctx.fill();
        for (const v of sh.veins) {
          ctx.strokeStyle = GOLD;
          ctx.lineWidth = v[6] * r;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(v[0] * r, v[1] * r);
          ctx.quadraticCurveTo(v[2] * r, v[3] * r, v[4] * r, v[5] * r);
          ctx.stroke();
          ctx.strokeStyle = GOLD_LT;
          ctx.lineWidth = v[6] * r * 0.35;
          ctx.stroke();
        }
        for (const f of sh.flecks) {
          ctx.fillStyle = o.type === 'rock' ? 'rgba(245,197,66,0.55)' : GOLD;
          ctx.beginPath();
          ctx.arc(f[0] * r, f[1] * r, f[2] * r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      // tougher rock looks it: the more swings of your pick it takes, the darker,
      // more layered and more heavily outlined it is
      const tough = toughness(o);
      if (tough > 0 && o.type !== 'nugget') {
        ctx.save();
        polygon(sh.pts, r);
        ctx.clip();
        ctx.fillStyle = `rgba(10, 8, 14, ${0.1 + tough * 0.1})`;
        ctx.fillRect(-r, -r, r * 2, r * 2);
        ctx.strokeStyle = `rgba(20, 18, 26, ${0.35 + tough * 0.15})`;
        ctx.lineWidth = r * 0.07;
        for (let i = 0; i < tough + 1; i++) {
          const y = -r * 0.55 + i * (r * 1.1 / (tough + 1)) + r * 0.2;
          ctx.beginPath();
          ctx.moveTo(-r, y + Math.sin(sh.tilt + i) * r * 0.12);
          ctx.quadraticCurveTo(0, y - r * 0.18, r, y + Math.cos(sh.tilt + i) * r * 0.12);
          ctx.stroke();
        }
        ctx.restore();
        ctx.strokeStyle = tough >= 3 ? 'rgba(150, 165, 190, 0.55)' : 'rgba(0, 0, 0, 0.55)';
        ctx.lineWidth = 1.2 + tough * 0.9;
        polygon(sh.pts, r);
        ctx.stroke();
      }
      // cracks open up as the rock takes damage
      const dmg = 1 - Math.max(0, o.hp) / o.maxHp;
      if (dmg > 0.05) {
        ctx.strokeStyle = 'rgba(10, 8, 6, 0.75)';
        ctx.lineWidth = Math.max(1.2, r * 0.05);
        const segs = Math.ceil(dmg * 3);
        for (const c of sh.cracks.slice(0, 1 + Math.floor(dmg * 3))) {
          ctx.beginPath();
          c.slice(0, segs + 1).forEach(([x, y], i) => (i ? ctx.lineTo(x * r, y * r) : ctx.moveTo(x * r, y * r)));
          ctx.stroke();
        }
      }
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 1.2;
      polygon(sh.pts, r);
      ctx.stroke();
      if (o.flash > 0) {
        ctx.fillStyle = `rgba(255,255,255,${o.flash * 0.55})`;
        polygon(sh.pts, r);
        ctx.fill();
      }
      // tough rock that has been hit shows how much is left
      if (tough > 0 && o.hp < o.maxHp && o.hp > 0) {
        const bw = r * 1.4, bh = Math.max(3, r * 0.14), by = -r - bh * 2.2;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
        ctx.fillRect(-bw / 2 - 1, by - 1, bw + 2, bh + 2);
        ctx.fillStyle = tough >= 3 ? '#ff8a1f' : GOLD;
        ctx.fillRect(-bw / 2, by, bw * Math.max(0, o.hp) / o.maxHp, bh);
      }
      ctx.restore();
    }

    /** 0 = one swing breaks it; 1 = 2–3 swings; 2 = 4–8; 3 = 9 or more. */
    function toughness(o) {
      const d = view.shift ? view.shift.stats.damage : 1;
      const hits = Math.ceil(o.maxHp / Math.max(1e-9, d) - 1e-9);
      return hits <= 1 ? 0 : hits <= 3 ? 1 : hits <= 8 ? 2 : 3;
    }

    /* ---- particles ---- */
    function burst(x, y, color, n, speed, life, size) {
      for (let i = 0; i < n && view.particles.length < 420; i++) {
        const a = Math.random() * Math.PI * 2;
        const v = speed * (0.4 + Math.random() * 0.8);
        view.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - speed * 0.4, life, max: life, size: size * (0.6 + Math.random() * 0.8), color, rot: Math.random() * 6, spin: (Math.random() - 0.5) * 12, gold: false });
      }
    }

    function goldFlakes(x, y, n) {
      for (let i = 0; i < n && view.particles.length < 420; i++) {
        const a = Math.random() * Math.PI * 2;
        const v = 120 + Math.random() * 160;
        view.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 120, life: 1.1, max: 1.1, size: 4 + Math.random() * 3, color: GOLD, rot: Math.random() * 6, spin: (Math.random() - 0.5) * 14, gold: true, home: 0.28 + Math.random() * 0.15 });
      }
    }

    function popup(x, y, text, kind) {
      if (view.popups.length > 40) view.popups.shift();
      view.popups.push({ x, y, text, kind, life: kind === 'lode' ? 1.8 : 0.9, max: kind === 'lode' ? 1.8 : 0.9 });
    }

    function stepParticles(dt) {
      const target = { x: 30 / view.scale - view.ox / view.scale, y: 20 / view.scale - view.oy / view.scale };
      for (const p of view.particles) {
        p.life -= dt;
        if (p.gold && p.max - p.life > p.home) {
          const dx = target.x - p.x, dy = target.y - p.y;
          const d = Math.hypot(dx, dy) || 1;
          p.vx += (dx / d) * 2600 * dt;
          p.vy += (dy / d) * 2600 * dt;
          p.vx *= 0.92; p.vy *= 0.92;
          if (d < 24) p.life = 0;
        } else {
          p.vy += 900 * dt;
        }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot += p.spin * dt;
      }
      view.particles = view.particles.filter((p) => p.life > 0);
      for (const t of view.popups) { t.life -= dt; t.y -= 38 * dt; }
      view.popups = view.popups.filter((t) => t.life > 0);
      for (const r of view.rings) r.life -= dt;
      view.rings = view.rings.filter((r) => r.life > 0);
      if (view.shift) for (const o of view.shift.ores) { if (o.flash > 0) o.flash = Math.max(0, o.flash - dt * 7); if (o.shake > 0) o.shake -= dt; }
      if (view.swingT > 0) view.swingT -= dt;
      if (view.shakeT > 0) view.shakeT -= dt;
    }

    /* ---- events from the model ---- */
    const COLORS = { rock: '#8e7b65', quartz: '#e8e2d6', nugget: GOLD, vein: '#4a3e31', lode: GOLD };

    function consume() {
      const s = view.shift;
      let swung = false, cracked = false;
      for (const ev of s.events) {
        if (ev.type === 'hit') {
          ev.ore.flash = 1;
          ev.ore.shake = 0.12;
          if (!view.reduced) burst(ev.ore.x, ev.ore.y, COLORS[ev.ore.type] || '#888', 2, 160, 0.4, 4);
          cracked = true;
        } else if (ev.type === 'break') {
          const o = ev.ore;
          if (!view.reduced) {
            burst(o.x, o.y, COLORS[o.type] || '#888', o.type === 'lode' ? 26 : 9, 260, 0.6, o.type === 'lode' ? 9 : 6);
            goldFlakes(o.x, o.y, Math.min(o.type === 'lode' ? 30 : 12, 2 + Math.round(Math.sqrt(o.gold / (s.stats.goldMult || 1)) * 4)));
          }
          popup(o.x, o.y - o.r * 0.6, `+${opts.fmtGold ? opts.fmtGold(ev.gold) : ev.gold.toFixed(2)} oz`, o.type === 'lode' ? 'lode' : ev.crit ? 'crit' : 'gold');
          if (o.type === 'lode') { view.shakeT = 0.4; view.rings.push({ x: o.x, y: o.y, r: o.r * 3, life: 0.6, max: 0.6, color: GOLD }); }
          if (opts.onDeposit) opts.onDeposit(ev.gold, o);
          if (opts.sound) opts.sound.crack(o.type);
        } else if (ev.type === 'blast') {
          view.rings.push({ x: ev.x, y: ev.y, r: ev.r, life: 0.35, max: 0.35, color: '#ff8a1f' });
          view.shakeT = Math.max(view.shakeT, 0.15);
          if (opts.sound) opts.sound.blast();
        } else if (ev.type === 'swing') {
          swung = true;
          if (ev.crit) popup(ev.x, ev.y - 30, 'CRIT!', 'crit');
        } else if (ev.type === 'lode') {
          view.rings.push({ x: ev.ore.x, y: ev.ore.y, r: ev.ore.r * 2.5, life: 0.8, max: 0.8, color: GOLD });
          if (opts.onEvent) opts.onEvent({ type: 'lode' });
        } else if (ev.type === 'spawn') {
          ev.ore.born = s.t;
        }
      }
      s.events.length = 0;
      if (swung && opts.sound) opts.sound.strike(cracked);
    }

    function doStrike(source) {
      const s = view.shift;
      if (!s || !view.aim) return;
      strike(s, view.aim.x, view.aim.y, source);
      if (source === 'pick') { view.lastStrike = s.t; view.swingT = 0.14; }
      consume();
    }

    /* ---- drawing ---- */
    function draw() {
      const s = view.shift;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(background(), 0, 0);
      let sx = 0, sy = 0;
      if (view.shakeT > 0 && !view.reduced) { sx = (Math.random() - 0.5) * 8; sy = (Math.random() - 0.5) * 8; }
      ctx.setTransform(view.dpr * view.scale, 0, 0, view.dpr * view.scale, view.dpr * (view.ox + sx), view.dpr * (view.oy + sy));
      const now = s ? s.t : 0;
      if (s) for (const o of s.ores) drawOre(o, now);
      for (const r of view.rings) {
        const k = 1 - r.life / r.max;
        ctx.strokeStyle = r.color;
        ctx.globalAlpha = 1 - k;
        ctx.lineWidth = 6 * (1 - k) + 1;
        ctx.beginPath();
        ctx.arc(r.x, r.y, r.r * (0.4 + k * 0.8), 0, Math.PI * 2);
        ctx.stroke();
        if (r.color !== GOLD) {
          ctx.fillStyle = 'rgba(255, 138, 31, 0.18)';
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
      for (const p of view.particles) {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.globalAlpha = Math.min(1, p.life / p.max * 2);
        ctx.fillStyle = p.color;
        if (p.gold) {
          ctx.beginPath();
          ctx.moveTo(0, -p.size); ctx.lineTo(p.size * 0.7, 0); ctx.lineTo(0, p.size); ctx.lineTo(-p.size * 0.7, 0);
          ctx.closePath();
          ctx.fill();
        } else {
          ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.7);
        }
        ctx.restore();
      }
      ctx.globalAlpha = 1;
      ctx.textAlign = 'center';
      for (const t of view.popups) {
        const a = Math.min(1, t.life / t.max * 2);
        const size = t.kind === 'lode' ? 34 : t.kind === 'crit' ? 22 : 17;
        ctx.font = `700 ${size}px "JetBrains Mono", ui-monospace, monospace`;
        ctx.lineWidth = 4;
        ctx.strokeStyle = `rgba(0,0,0,${0.7 * a})`;
        ctx.strokeText(t.text, t.x, t.y);
        ctx.fillStyle = t.kind === 'crit' ? `rgba(255,138,31,${a})` : `rgba(255,227,154,${a})`;
        ctx.fillText(t.text, t.x, t.y);
      }
      // on touch, a faint tether from the fingertip up to the floating pick
      if (s && view.running && view.holding && view.finger && view.aim) {
        const u = 1 / view.scale;  // one CSS pixel, in field units
        ctx.save();
        ctx.strokeStyle = view.accent;
        ctx.fillStyle = view.accent;
        ctx.globalAlpha = 0.45;
        ctx.lineWidth = 1.5 * u;
        ctx.setLineDash([4 * u, 4 * u]);
        ctx.beginPath();
        ctx.moveTo(view.finger.x, view.finger.y);
        ctx.lineTo(view.aim.x, view.aim.y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(view.finger.x, view.finger.y, 4 * u, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      // the pick: its reach as a ring, and the head swinging on each strike
      if (s && view.aim && (view.running || view.pointerType === 'mouse')) {
        const R = s.stats.radius;
        const ready = Math.min(1, (s.t - view.lastStrike) / s.stats.swing);
        ctx.save();
        ctx.translate(view.aim.x, view.aim.y);
        ctx.strokeStyle = view.accent;
        ctx.globalAlpha = view.running ? 0.9 : 0.4;
        ctx.lineWidth = 2;
        ctx.setLineDash([7, 6]);
        ctx.beginPath();
        ctx.arc(0, 0, R, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        if (view.running && ready < 1) {
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(0, 0, R + 5, -Math.PI / 2, -Math.PI / 2 + ready * Math.PI * 2);
          ctx.stroke();
        }
        ctx.fillStyle = view.accent;
        ctx.globalAlpha = view.running ? 0.08 : 0.04;
        ctx.beginPath();
        ctx.arc(0, 0, R, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        const swing = view.swingT > 0 ? Math.sin((view.swingT / 0.14) * Math.PI) * 0.9 : 0;
        ctx.translate(R * 0.35, -R * 0.35);
        ctx.rotate(-0.6 + swing);
        drawPick(s.stats.pickTier || 0);
        ctx.restore();
      }
    }

    /** The pick head changes with Stronger Pick upgrades: bigger, brighter, glowing. */
    function drawPick(tier) {
      const P = PICKS[Math.min(tier, PICKS.length - 1)];
      // grows with each head; drawn larger on small screens so the upgrade is easy to see
      const k = (1 + tier * 0.14) * Math.max(1, 0.8 / view.scale);
      ctx.scale(k, k);
      ctx.lineCap = 'round';
      ctx.strokeStyle = tier >= 5 ? '#6b3f1d' : '#a0703f';
      ctx.lineWidth = 5;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(20, 20); ctx.stroke();
      if (tier >= 3) { ctx.strokeStyle = P.edge; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(14, 14); ctx.lineTo(18, 18); ctx.stroke(); }
      if (P.glow) { ctx.shadowColor = P.glow; ctx.shadowBlur = 10 + tier * 2; }
      ctx.strokeStyle = P.head;
      ctx.lineWidth = 6 + tier * 0.6;
      ctx.beginPath(); ctx.moveTo(-14, 5); ctx.quadraticCurveTo(-2, -11, 16, -13); ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = P.edge;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-12, 2); ctx.quadraticCurveTo(-2, -12, 14, -14); ctx.stroke();
      if (tier >= 6) { ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(16, -13, 2.6, 0, Math.PI * 2); ctx.arc(-14, 5, 2.6, 0, Math.PI * 2); ctx.fill(); }
    }

    /* ---- input ---- */
    function onDown(e) {
      if (e.button != null && e.button > 0) return;
      view.pointerType = e.pointerType || 'mouse';
      view.aim = aimFrom(e);
      if (!view.running) return;
      e.preventDefault();
      view.holding = true;
      try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
      const s = view.shift;
      if (s.t - view.lastStrike >= s.stats.swing) doStrike('pick');
      else view.queued = true;
    }
    function onMove(e) {
      view.pointerType = e.pointerType || 'mouse';
      if (e.pointerType === 'touch' && !view.holding) return;
      view.aim = aimFrom(e);
    }
    function onUp() {
      view.holding = false;
      view.finger = null;
    }
    function onKey(e) {
      if (!view.running || (e.key !== ' ' && e.key !== 'Enter')) return;
      e.preventDefault();
      if (!view.aim) view.aim = { x: view.shift.w / 2, y: view.shift.h / 2 };
      if (!e.repeat || view.shift.t - view.lastStrike >= view.shift.stats.swing) view.queued = true;
    }
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') view.holding = false; });
    canvas.addEventListener('keydown', onKey);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    /* ---- public API ---- */
    /**
     * A control pad under the rock face for touchscreens: drag to move the pick
     * like a laptop trackpad, hold to keep swinging, so no finger covers the rocks.
     */
    view.attachPad = (pad, onIdleTap) => {
      let id = null, last = null;
      pad.addEventListener('pointerdown', (e) => {
        if (e.button != null && e.button > 0) return;
        e.preventDefault();
        if (!view.running || view.paused) { if (onIdleTap) onIdleTap(); return; }
        const s = view.shift;
        id = e.pointerId;
        last = { x: e.clientX, y: e.clientY };
        try { pad.setPointerCapture(id); } catch (_) { /* ignore */ }
        view.pointerType = 'pad';
        view.finger = null;
        if (!view.aim) view.aim = { x: s.w / 2, y: s.h / 2 };
        view.holding = true;
        pad.classList.add('active');
        if (s.t - view.lastStrike >= s.stats.swing) doStrike('pick');
        else view.queued = true;
      });
      pad.addEventListener('pointermove', (e) => {
        if (e.pointerId !== id || !last || !view.shift || !view.aim) return;
        const s = view.shift, k = PAD_GAIN / view.scale;
        view.aim = {
          x: Math.min(s.w, Math.max(0, view.aim.x + (e.clientX - last.x) * k)),
          y: Math.min(s.h, Math.max(0, view.aim.y + (e.clientY - last.y) * k)),
        };
        last = { x: e.clientX, y: e.clientY };
      });
      const up = (e) => {
        if (e.pointerId !== id) return;
        id = null;
        last = null;
        view.holding = false;
        pad.classList.remove('active');
      };
      pad.addEventListener('pointerup', up);
      pad.addEventListener('pointercancel', up);
      pad.addEventListener('contextmenu', (e) => e.preventDefault());
    };

    view.start = (stats, seed) => {
      view.shift = createShift(stats, { aspect: view.cssH / view.cssW, seed: seed || Math.floor(Math.random() * 1e9) });
      view.running = true;
      view.lastStrike = -1e9;
      view.aim = { x: view.shift.w / 2, y: view.shift.h / 2 };
      view.nextDrill = stats.drill ? stats.swing / stats.drill : Infinity;
      view.particles = [];
      view.popups = [];
      view.rings = [];
      view.bgKey = '';
      fit();
      canvas.classList.add('live');
      if (opts.onEvent) opts.onEvent({ type: 'start' });
    };
    /** Show the rock face without a shift running (before the first shift, between shifts). */
    view.preview = (stats) => {
      if (view.running) return;
      view.shift = createShift(Object.assign({}, stats, { lodeChance: 0 }), { aspect: view.cssH / view.cssW, seed: 42 });
      view.bgKey = '';
      fit();
    };
    view.setStats = (stats) => {
      if (!view.shift) return;
      const s = view.shift;
      s.stats = Object.assign({}, stats);
      if (view.running && stats.drill && !Number.isFinite(view.nextDrill)) view.nextDrill = s.t + stats.swing / stats.drill;
    };
    view.frame = (dt) => {
      dt = Math.min(dt || 0, 0.1);
      const s = view.shift;
      if (s && view.running && !view.paused && dt > 0) {
        update(s, dt);
        consume();
        if (!s.over) {
          if ((view.holding || view.queued) && view.aim && s.t - view.lastStrike >= s.stats.swing) { view.queued = false; doStrike('pick'); }
          if (s.stats.drill && view.aim && s.t >= view.nextDrill) { view.nextDrill = s.t + s.stats.swing / s.stats.drill; doStrike('drill'); }
        }
        if (s.over) {
          view.running = false;
          view.holding = false;
          canvas.classList.remove('live');
          if (opts.onEvent) opts.onEvent({ type: 'end', result: { gold: s.gold, ore: s.ore, crits: s.crits, lodes: s.lodes, lodeGold: s.lodeGold, best: s.best, strikes: s.strikes, duration: s.stats.duration } });
        }
      }
      stepParticles(dt);
      draw();
    };
    view.resize = resize;
    view.setReduced = (r) => { view.reduced = !!r; };
    view.refreshTheme = readAccent;
    view.setLift = (px) => { view.lift = Math.max(0, Number(px) || TOUCH_LIFT); };
    view.abort = () => { view.running = false; view.holding = false; canvas.classList.remove('live'); };
    resize();
    return view;
  }

  const Mining = { AREA, ORES, PALETTES, PICKS, TOUCH_LIFT, fieldSize, createShift, update, strike, bestAim, simulate, createView };
  root.Mining = Mining;
  if (typeof module !== 'undefined' && module.exports) module.exports = Mining;
})(typeof window !== 'undefined' ? window : globalThis);
