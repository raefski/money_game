/* ==========================================================================
   FULL FAITH & CREDIT — fiat.js
   The Fiat Era (after the Nixon Shock). Pure model first — the floating gold
   price, the Fed's upgrades and history, and the Fed Desk session — then a
   canvas view of the desk. Like mining.js, the model touches no DOM.

   The Fed Desk: a timed session where you set the interest rate. Growth and
   inflation respond with momentum and get hit by shocks. Inflation inside the
   1–3% target band builds a combo on what the economy earns you; let it run
   past 6% and it starts to spiral.
   ========================================================================== */
(function (root) {
  'use strict';

  const TARGET_LO = 1, TARGET_HI = 3;    // inflation target band, %
  const SPIRAL_AT = 6;                   // above this, expectations come unanchored

  /* ------------------------------------------------------------------------
   * History, upgrades, state
   * --------------------------------------------------------------------- */
  // Each step sets where the free-floating gold price heads next.
  const HISTORY = [
    { id: 'f1971', year: 1971.62, title: 'The Nixon Shock', cost: 0, gold: 43,
      text: 'The dollar floats. Gold trades at whatever the market will pay, and money is whatever the Fed makes it.' },
    { id: 'f1973', year: 1973.8, title: 'OPEC Oil Embargo', cost: 2e9, gold: 97, effects: { base: 2, shocks: 1.6 },
      text: 'Oil prices quadruple. Shocks hit the economy harder and more often, but nominal output booms.' },
    { id: 'f1974', year: 1974.5, title: 'The Petrodollar Deal', cost: 2e10, gold: 154, effects: { base: 3 },
      text: 'Saudi oil is priced in dollars and the proceeds flow back into U.S. Treasuries: the [[petrodollar|petrodollar]] system.' },
    { id: 'f1979', year: 1979.6, title: 'Volcker Takes the Fed', cost: 2e11, gold: 307, effects: { maxRate: 20, spiral: 0.5 },
      text: 'Paul Volcker is ready to raise rates as high as it takes. Rates can now go to 20%, and spirals are easier to break.' },
    { id: 'f1980', year: 1980.05, title: 'Gold Hits $850', cost: 2e12, gold: 850, effects: { base: 2 },
      text: 'Inflation fear sends gold to a record $850 an ounce: the best moment ever to sell a vault.' },
    { id: 'f1987', year: 1987.8, title: 'Black Monday', cost: 2e13, gold: 447, effects: { base: 3, shocks: 1.3 },
      text: 'Stocks fall 22% in a day and the Fed floods the system with liquidity. Banking and the petrodollar come next.' },
  ];
  const HISTORY_BY_ID = Object.fromEntries(HISTORY.map((h) => [h.id, h]));

  const ITEMS = [
    { id: 'presses', name: 'Printing Presses', icon: 'press', base: 5e7, growth: 1.6, max: 30,
      value: (l) => Math.pow(1.3, l), show: (v) => `×${v < 100 ? v.toFixed(2) : Math.round(v)} income`,
      desc: 'More presses, more money in circulation: everything the desk earns is multiplied.' },
    { id: 'staff', name: 'Dual-Mandate Staff', icon: 'chart', base: 2e8, growth: 2.2, max: 10,
      value: (l) => 3 + 0.5 * l, show: (v) => `combo up to ×${v.toFixed(1)}`,
      desc: 'Economists who keep both prices and jobs in view: inside the target band your combo climbs higher.' },
    { id: 'guidance', name: 'Forward Guidance', icon: 'dial', base: 1e9, growth: 2.4, max: 10,
      value: (l) => Math.pow(0.88, l), show: (v) => `shocks ${Math.round(v * 100)}% as strong`,
      desc: 'Telling markets what you will do softens every shock.' },
    { id: 'meetings', name: 'Longer FOMC Meetings', icon: 'clock', base: 4e8, growth: 2.5, max: 12,
      value: (l) => 30 + 5 * l, show: (v) => `${v}s sessions`,
      desc: 'More time at the desk: longer sessions, more income per session.' },
  ];
  const ITEM_BY_ID = Object.fromEntries(ITEMS.map((i) => [i.id, i]));

  function createFiat(vault, credibility) {
    return { dollars: 0, vault: Math.max(0, vault || 0), sold: 0, items: {}, charters: { f1971: true }, goldPrice: 35, peakGold: 35,
      sessions: 0, bestSession: 0, earned: 0, credibility: credibility || 0 };
  }

  function sanitize(raw, fallbackCred) {
    const f = createFiat(0, fallbackCred);
    if (!raw || typeof raw !== 'object') return f;
    const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
    for (const k of ['dollars', 'vault', 'sold', 'goldPrice', 'peakGold', 'sessions', 'bestSession', 'earned', 'credibility']) f[k] = Math.max(0, num(raw[k], f[k]));
    if (raw.charters) for (const id of Object.keys(raw.charters)) if (HISTORY_BY_ID[id] && raw.charters[id]) f.charters[id] = true;
    if (raw.items) for (const id of Object.keys(raw.items)) if (ITEM_BY_ID[id]) f.items[id] = Math.min(ITEM_BY_ID[id].max, Math.max(0, Math.floor(num(raw.items[id], 0))));
    return f;
  }

  const level = (f, id) => f.items[id] || 0;
  const val = (f, id) => ITEM_BY_ID[id].value(level(f, id));

  function latest(f) {
    let h = HISTORY[0];
    for (const x of HISTORY) if (f.charters[x.id]) h = x;
    return h;
  }
  function next(f) { return HISTORY.find((h) => !f.charters[h.id]) || null; }

  /** Everything a desk session needs, from the fiat state. */
  function stats(f) {
    let base = 2e6, shocks = 1, maxRate = 12, spiral = 1;
    for (const h of HISTORY) {
      if (!f.charters[h.id] || !h.effects) continue;
      const e = h.effects;
      if (e.base) base *= e.base;
      if (e.shocks) shocks *= e.shocks;
      if (e.maxRate) maxRate = e.maxRate;
      if (e.spiral) spiral *= e.spiral;
    }
    const cred = f.credibility;
    return {
      base: base * val(f, 'presses') * (1 + 0.1 * cred),
      duration: val(f, 'meetings'),
      comboMax: val(f, 'staff'),
      shock: shocks * val(f, 'guidance'),
      maxRate,
      spiral: spiral / (1 + cred / 25),   // a credible central bank keeps expectations anchored
      oil: !!f.charters.f1973,
    };
  }

  function levelCost(it, lvl) { return Math.ceil(it.base * Math.pow(it.growth, lvl)); }

  function buy(f, id) {
    const it = ITEM_BY_ID[id];
    if (it) {
      const l = level(f, id);
      if (l >= it.max) return { ok: false, reason: 'maxed' };
      const cost = levelCost(it, l);
      if (f.dollars < cost) return { ok: false, reason: 'funds' };
      f.dollars -= cost;
      f.items[id] = l + 1;
      return { ok: true, cost, item: it };
    }
    const h = HISTORY_BY_ID[id];
    if (!h || f.charters[id] || next(f) !== h) return { ok: false, reason: 'locked' };
    if (f.dollars < h.cost) return { ok: false, reason: 'funds' };
    f.dollars -= h.cost;
    f.charters[id] = true;
    return { ok: true, cost: h.cost, history: h };
  }

  /** The free-floating gold price drifts toward the latest history step's level. */
  function simulate(f, dt) {
    const target = latest(f).gold;
    f.goldPrice = target + (f.goldPrice - target) * Math.exp(-dt / 90);
    f.peakGold = Math.max(f.peakGold, f.goldPrice);
  }

  /** Sell a share of the vault at today's gold price. Returns dollars raised. */
  function sellGold(f, share) {
    const oz = f.vault * Math.min(1, Math.max(0, share));
    if (!(oz > 0)) return 0;
    const dollars = oz * f.goldPrice;
    f.vault -= oz;
    f.sold += oz;
    f.dollars += dollars;
    return dollars;
  }

  /* ------------------------------------------------------------------------
   * The Fed Desk session (model)
   * --------------------------------------------------------------------- */
  function rng(seed) {
    let s = (seed >>> 0) || 1;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }

  function createSession(st, seed) {
    const s = { st, t: 0, over: false, rate: 4, pi: 2.6, y: 0, combo: 1, bestCombo: 1, earned: 0, inBand: 0,
      rand: rng(seed || 1), nextShock: 5, shock: null, samples: [], sampleAcc: 0, events: [] };
    return s;
  }

  const SHOCKS = [
    { id: 'oil', name: 'OIL SHOCK', pi: 4, y: -1.5, oilOnly: true },
    { id: 'boom', name: 'CREDIT BOOM', pi: 1.2, y: 3 },
    { id: 'slump', name: 'DEMAND SLUMP', pi: -1, y: -3.5 },
    { id: 'panic', name: 'MARKET PANIC', pi: -0.5, y: -4.5 },
    { id: 'wages', name: 'WAGE SPIRAL', pi: 2.5, y: 0.5 },
  ];

  /** Advance a session by dt seconds. Returns the dollars earned in this step. */
  function update(s, dt, targetRate) {
    if (s.over) return 0;
    const st = s.st;
    s.t += dt;
    s.rate = Math.min(st.maxRate, Math.max(0, targetRate));
    // shocks arrive every few seconds and push over about two seconds
    if (s.t >= s.nextShock) {
      const pool = SHOCKS.filter((k) => !k.oilOnly || st.oil);
      const k = pool[Math.floor(s.rand() * pool.length)];
      s.shock = { k, left: 2 };
      s.events.push({ type: 'shock', name: k.name });
      s.nextShock = s.t + 5 + s.rand() * 4;
    }
    let dpi = 0, dy = 0;
    if (s.shock) {
      const share = Math.min(dt, s.shock.left) / 2;
      dpi += s.shock.k.pi * st.shock * share;
      dy += s.shock.k.y * st.shock * share;
      s.shock.left -= dt;
      if (s.shock.left <= 0) s.shock = null;
    }
    const neutral = s.pi + 1;                        // a rate above inflation + 1% slows the economy
    dy += dt * (-0.55 * (s.rate - neutral) - 0.35 * s.y);
    let pull = 0.32 * s.y + 0.05 * (s.pi - 2);       // a hot economy pushes prices up, and inflation feeds on itself
    if (s.pi > SPIRAL_AT) pull += 0.22 * (s.pi - SPIRAL_AT) * st.spiral;
    dpi += dt * pull;
    s.y = Math.max(-8, Math.min(8, s.y + dy));
    s.pi = Math.max(-4, Math.min(30, s.pi + dpi));
    // combo: inside the band and not in recession it builds; otherwise it falls away
    const good = s.pi >= TARGET_LO && s.pi <= TARGET_HI && s.y > -1.5;
    if (good) { s.combo = Math.min(st.comboMax, s.combo + dt * 0.45); s.inBand += dt; }
    else s.combo = Math.max(1, s.combo - dt * (s.pi > SPIRAL_AT || s.y < -3 ? 2 : 0.8));
    s.bestCombo = Math.max(s.bestCombo, s.combo);
    // what the economy earns you: growth helps, inflation taxes it, recession halves it
    const growth = 1 + Math.max(0, s.y) * 0.12;
    const tax = Math.max(0.05, 1 - Math.max(0, s.pi - TARGET_HI) / 12);
    const slump = s.y < -2 ? 0.5 : 1;
    const gain = st.base * growth * s.combo * tax * slump * dt;
    s.earned += gain;
    s.sampleAcc += dt;
    if (s.sampleAcc >= 0.1) {
      s.sampleAcc = 0;
      s.samples.push({ t: s.t, pi: s.pi, y: s.y, rate: s.rate });
      if (s.samples.length > 200) s.samples.shift();
    }
    if (s.t >= st.duration) { s.t = st.duration; s.over = true; s.events.push({ type: 'end' }); }
    return gain;
  }

  /* ------------------------------------------------------------------------
   * The Fed Desk view
   * --------------------------------------------------------------------- */
  function createDeskView(canvas, opts = {}) {
    const ctx = canvas.getContext('2d');
    const v = { session: null, running: false, paused: false, target: 4, dpr: 1, w: 1, h: 1, pops: [], payAcc: 0, payT: 0, tag: null, tagT: 0, drag: null };
    const fmt = opts.fmt || ((n) => n.toFixed(0));

    function resize() {
      const r = canvas.getBoundingClientRect();
      v.w = Math.max(1, r.width);
      v.h = Math.max(1, r.height);
      v.dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(v.w * v.dpr);
      canvas.height = Math.round(v.h * v.dpr);
    }

    // chart geometry: inflation axis from −4% to 14%, the rate gauge on the right
    const PI_MIN = -4, PI_MAX = 14;
    function geom() {
      const gauge = Math.max(46, v.w * 0.13);
      return { x0: 10, x1: v.w - gauge - 10, y0: 54, y1: v.h - 30, gx: v.w - gauge, gw: gauge };
    }
    const yOf = (g, pi) => g.y1 - ((pi - PI_MIN) / (PI_MAX - PI_MIN)) * (g.y1 - g.y0);

    function draw() {
      const s = v.session;
      const st = s ? s.st : { maxRate: 12 };
      ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
      const bg = ctx.createLinearGradient(0, 0, 0, v.h);
      bg.addColorStop(0, '#0b1a17');
      bg.addColorStop(1, '#050c0b');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, v.w, v.h);
      const g = geom();
      // grid
      ctx.strokeStyle = 'rgba(46, 230, 166, 0.07)';
      ctx.lineWidth = 1;
      for (let p = PI_MIN; p <= PI_MAX; p += 2) { const y = yOf(g, p); ctx.beginPath(); ctx.moveTo(g.x0, y); ctx.lineTo(g.x1, y); ctx.stroke(); }
      // target band
      const inBand = s && s.pi >= TARGET_LO && s.pi <= TARGET_HI;
      ctx.fillStyle = inBand ? 'rgba(46, 230, 166, 0.22)' : 'rgba(46, 230, 166, 0.12)';
      ctx.fillRect(g.x0, yOf(g, TARGET_HI), g.x1 - g.x0, yOf(g, TARGET_LO) - yOf(g, TARGET_HI));
      ctx.fillStyle = 'rgba(207, 233, 223, 0.55)';
      ctx.font = '600 10px "JetBrains Mono", ui-monospace, monospace';
      ctx.textAlign = 'left';
      ctx.fillText('TARGET 1–3%', g.x0 + 6, yOf(g, TARGET_HI) - 4);
      // spiral zone
      ctx.fillStyle = 'rgba(255, 92, 92, 0.07)';
      ctx.fillRect(g.x0, yOf(g, PI_MAX), g.x1 - g.x0, yOf(g, SPIRAL_AT) - yOf(g, PI_MAX));
      ctx.fillStyle = 'rgba(255, 140, 140, 0.5)';
      ctx.fillText('SPIRAL', g.x0 + 6, yOf(g, SPIRAL_AT) - 4);
      // lines: last 15 s
      if (s && s.samples.length > 1) {
        const span = 15, tEnd = s.t;
        const xOf = (t) => g.x1 - ((tEnd - t) / span) * (g.x1 - g.x0);
        const line = (key, color, width, scale = 1, off = 0) => {
          ctx.strokeStyle = color;
          ctx.lineWidth = width;
          ctx.beginPath();
          let first = true;
          for (const p of s.samples) {
            if (tEnd - p.t > span) continue;
            const x = xOf(p.t), y = yOf(g, p[key] * scale + off);
            if (first) { ctx.moveTo(x, y); first = false; } else ctx.lineTo(x, y);
          }
          ctx.stroke();
        };
        ctx.setLineDash([5, 5]);
        line('rate', 'rgba(220, 230, 240, 0.55)', 1.5);
        ctx.setLineDash([]);
        line('y', 'rgba(94, 200, 242, 0.85)', 2, 1, 5);   // growth, drawn around the 5% line
        line('pi', s.pi > SPIRAL_AT ? '#ff6b5c' : inBand ? '#2ee6a6' : '#f5c542', 3);
      }
      // the rate gauge
      ctx.fillStyle = 'rgba(255,255,255,0.04)';
      ctx.fillRect(g.gx, g.y0, g.gw - 8, g.y1 - g.y0);
      const rate = s ? s.rate : v.target;
      const ry = g.y1 - (rate / st.maxRate) * (g.y1 - g.y0);
      ctx.fillStyle = 'rgba(46, 230, 166, 0.25)';
      ctx.fillRect(g.gx, ry, g.gw - 8, g.y1 - ry);
      ctx.fillStyle = '#e8fff6';
      ctx.fillRect(g.gx - 4, ry - 2, g.gw, 4);
      ctx.textAlign = 'center';
      ctx.font = '700 12px "JetBrains Mono", ui-monospace, monospace';
      ctx.fillText(`${rate.toFixed(1)}%`, g.gx + (g.gw - 8) / 2, Math.max(g.y0 + 12, ry - 8));
      ctx.font = '600 9px "JetBrains Mono", ui-monospace, monospace';
      ctx.fillStyle = 'rgba(207,233,223,0.6)';
      ctx.fillText('FED RATE', g.gx + (g.gw - 8) / 2, g.y1 + 14);
      // readouts
      if (s) {
        ctx.textAlign = 'left';
        ctx.font = '700 15px "JetBrains Mono", ui-monospace, monospace';
        ctx.fillStyle = s.pi > SPIRAL_AT ? '#ff6b5c' : inBand ? '#2ee6a6' : '#f5c542';
        ctx.fillText(`INFLATION ${s.pi.toFixed(1)}%`, 12, 22);
        ctx.fillStyle = '#5ec8f2';
        ctx.font = '600 12px "JetBrains Mono", ui-monospace, monospace';
        ctx.fillText(`GROWTH ${s.y >= 0 ? '+' : ''}${s.y.toFixed(1)}%`, 12, 40);
        ctx.textAlign = 'right';
        ctx.font = '700 16px "JetBrains Mono", ui-monospace, monospace';
        ctx.fillStyle = s.combo > 1.05 ? '#2ee6a6' : 'rgba(207,233,223,0.5)';
        ctx.fillText(`×${s.combo.toFixed(1)}`, v.w - 12, 22);
        if (inBand) { ctx.font = '700 10px "JetBrains Mono", ui-monospace, monospace'; ctx.fillText('ON TARGET', v.w - 12, 36); }
        if (v.tag && v.tagT > 0) {
          ctx.font = '700 11px "JetBrains Mono", ui-monospace, monospace';
          ctx.fillStyle = `rgba(255, 170, 90, ${Math.min(1, v.tagT)})`;
          ctx.fillText(v.tag, g.x1, 40 + 12);
        }
      }
      // income popups, rising from the line
      ctx.textAlign = 'center';
      for (const p of v.pops) {
        ctx.globalAlpha = Math.min(1, p.life * 1.5);
        ctx.font = `700 ${p.big ? 18 : 14}px "JetBrains Mono", ui-monospace, monospace`;
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0,0,0,0.7)';
        ctx.strokeText(p.text, p.x, p.y);
        ctx.fillStyle = p.big ? '#b6ffe4' : '#2ee6a6';
        ctx.fillText(p.text, p.x, p.y);
        ctx.globalAlpha = 1;
      }
    }

    // input: drag up to raise the rate, down to cut it (anywhere on the chart, or on the pad)
    function bindDrag(el) {
      el.addEventListener('pointerdown', (e) => {
        if (e.button != null && e.button > 0) return;
        if (!v.running) { if (opts.onIdleTap) opts.onIdleTap(); return; }
        e.preventDefault();
        v.drag = { id: e.pointerId, y: e.clientY };
        try { el.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
        el.classList.add('active');
      });
      el.addEventListener('pointermove', (e) => {
        if (!v.drag || e.pointerId !== v.drag.id) return;
        const st = v.session ? v.session.st : { maxRate: 12 };
        v.target = Math.min(st.maxRate, Math.max(0, v.target - (e.clientY - v.drag.y) * (st.maxRate / Math.max(160, v.h * 0.7))));
        v.drag.y = e.clientY;
      });
      const up = (e) => { if (v.drag && e.pointerId === v.drag.id) { v.drag = null; el.classList.remove('active'); } };
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      el.addEventListener('contextmenu', (e) => e.preventDefault());
    }
    bindDrag(canvas);
    canvas.addEventListener('keydown', (e) => {
      if (!v.running) return;
      const st = v.session.st;
      if (e.key === 'ArrowUp') { v.target = Math.min(st.maxRate, v.target + 0.5); e.preventDefault(); }
      if (e.key === 'ArrowDown') { v.target = Math.max(0, v.target - 0.5); e.preventDefault(); }
    });

    v.attachPad = bindDrag;
    v.start = (st, seed) => {
      v.session = createSession(st, seed || Math.floor(Math.random() * 1e9));
      v.target = v.session.rate;
      v.running = true;
      v.paused = false;
      v.pops = [];
      v.payAcc = 0;
      v.payT = 0;
      canvas.classList.add('live');
    };
    v.frame = (dt) => {
      dt = Math.min(dt || 0, 0.1);
      const s = v.session;
      if (s && v.running && !v.paused && dt > 0) {
        const gain = update(s, dt, v.target);
        if (opts.onEarn) opts.onEarn(gain);
        v.payAcc += gain;
        v.payT += dt;
        if (v.payT >= 1) {   // one popup a second with what the desk earned
          const g = geom();
          v.pops.push({ text: `+$${fmt(v.payAcc)}`, x: g.x0 + (g.x1 - g.x0) * 0.75, y: yOf(g, s.pi) - 10, life: 1.2, big: s.combo >= 3 });
          if (v.pops.length > 6) v.pops.shift();
          v.payAcc = 0;
          v.payT = 0;
        }
        for (const ev of s.events) {
          if (ev.type === 'shock') { v.tag = ev.name; v.tagT = 2.5; if (opts.onShock) opts.onShock(ev.name); }
          if (ev.type === 'end') {
            v.running = false;
            v.drag = null;
            canvas.classList.remove('live');
            if (opts.onEnd) opts.onEnd({ earned: s.earned, bestCombo: s.bestCombo, inBand: s.inBand, duration: s.st.duration });
          }
        }
        s.events.length = 0;
      }
      for (const p of v.pops) { p.life -= dt; p.y -= 30 * dt; }
      v.pops = v.pops.filter((p) => p.life > 0);
      if (v.tagT > 0) v.tagT -= dt;
      draw();
    };
    v.resize = resize;
    v.abort = () => { v.running = false; v.drag = null; canvas.classList.remove('live'); };
    resize();
    return v;
  }

  const Fiat = { HISTORY, HISTORY_BY_ID, ITEMS, ITEM_BY_ID, TARGET_LO, TARGET_HI, SPIRAL_AT,
    createFiat, sanitize, level, latest, next, stats, levelCost, buy, simulate, sellGold, createSession, update, createDeskView };
  root.Fiat = Fiat;
  if (typeof module !== 'undefined' && module.exports) module.exports = Fiat;
})(typeof window !== 'undefined' ? window : globalThis);
