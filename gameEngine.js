/* ==========================================================================
   FULL FAITH & CREDIT — gameEngine.js
   Game loop, persistence, input and the view layer for the four pages:
   Mine (timed shifts on a canvas), Upgrades (the shop), Territory (crews)
   and Treasury (the Mint, history and the gold window).

   Time model: requestAnimationFrame drives the shift and rendering. Crews
   are simulated by real elapsed wall-clock time (Date.now), so a hidden tab
   or a closed browser is credited exactly; shifts pause instead.
   ========================================================================== */
(function () {
  'use strict';

  const E = window.Economy;
  const A = window.SVGAssets;
  const M = window.Mining;
  if (!E || !A || !M) {
    document.body.insertAdjacentHTML('afterbegin', '<p style="padding:20px;font-family:monospace">Failed to load game scripts.</p>');
    return;
  }

  /* ------------------------------------------------------------------------
   * Constants & helpers
   * --------------------------------------------------------------------- */
  const SAVE_KEY = 'ffc.save.v2';
  const V1_KEY = 'ffc.save.v1';
  const V1_ARCHIVE = 'ffc.save.v1.archive';
  const EXPORT_PREFIX = 'FFC2:';
  const AUTOSAVE_MS = 10000;
  const SLOW_TICK_S = 0.2;
  const SPARK_EVERY_S = 2;
  const SPARK_POINTS = 60;
  const AWAY_NOTICE_S = 60;
  const FOREMAN_DELAY_S = 3;
  const DEBUG = /[?&]debug(=|&|$)/.test(location.search);
  const ROMAN = ['0', 'I', 'II', 'III', 'IV', 'V'];
  const PAGES = ['mine', 'upgrades', 'territory', 'treasury'];
  const PLACES = [
    [0, 'COLOMA, CA · 38.80°N 120.89°W'],
    [1859, 'VIRGINIA CITY, NV · 39.31°N 119.65°W'],
    [1876, 'LEAD, SD · 44.35°N 103.77°W'],
    [1897, 'DAWSON CITY, YT · 64.06°N 139.43°W'],
    [1936, 'FORT KNOX, KY · 37.88°N 85.96°W'],
  ];
  const { fmt, fmtTime, fmtUSD, fmtClock } = E;

  const $ = (id) => document.getElementById(id);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);
  const firstSentence = (s) => { const m = String(s).match(/^.*?[.!?](?=\s|$)/); return m ? m[0] : String(s); };
  const oz = (v) => `${fmt(v, v < 10 ? 2 : 1)} oz`;
  /** Rates can be tiny early on: keep two significant digits below 1. */
  const rate = (v) => fmt(v, v <= 0 ? 2 : v < 0.01 ? 4 : v < 0.1 ? 3 : v < 10 ? 2 : 1);
  const usdRate = (v) => (v > 0 && v < 1 ? `$${v.toFixed(v < 0.01 ? 4 : v < 0.1 ? 3 : 2)}` : fmtUSD(v));
  const reducedMotion = () => document.body.classList.contains('reduce-motion') || matchMedia('(prefers-reduced-motion: reduce)').matches;
  const phone = () => matchMedia('(max-width: 860px)').matches;

  /** Escape text, then turn [[term-id|label]] into glossary spans. */
  function rich(text, focusable = true) {
    return esc(text).replace(/\[\[([a-z0-9-]+)\|([^\]]+)\]\]/g, (_, id, label) =>
      `<span class="term" data-tip="term:${id}"${focusable ? ' tabindex="0"' : ''}>${label}</span>`);
  }
  /** The same text with the [[…]] markup removed. */
  function plain(text) {
    return String(text).replace(/\[\[[a-z0-9-]+\|([^\]]+)\]\]/g, '$1');
  }

  function setText(el, value) {
    if (el && el._v !== value) { el._v = value; el.textContent = value; }
  }
  function setHTML(el, value) {
    if (el && el._h !== value) { el._h = value; el.innerHTML = value; }
  }
  function setWidth(el, frac) {
    const w = `${(clamp(frac, 0, 1) * 100).toFixed(2)}%`;
    if (el && el._w !== w) { el._w = w; el.style.width = w; }
  }
  function toggleClass(el, cls, on) {
    if (el && el.classList.contains(cls) !== on) el.classList.toggle(cls, on);
  }
  function restartAnim(el, cls) {
    if (!el) return;
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  }

  function b64encode(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  function b64decode(b64) {
    const bin = atob(b64);
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  }

  /* ------------------------------------------------------------------------
   * Game container
   * --------------------------------------------------------------------- */
  const G = {
    state: null,
    d: null,              // Economy.derive(state), refreshed every frame
    lastSim: 0,           // wall-clock ms the crews have been simulated to
    lastFrame: 0,
    slowAcc: 0,
    sparkAcc: 0,
    sessionStart: Date.now(),
    nextSave: 0,
    away: null,           // snapshot taken when the tab is hidden
    conflict: false,      // another tab is writing the same save
  };

  /* ------------------------------------------------------------------------
   * Persistence
   * --------------------------------------------------------------------- */
  const Store = {
    ok: true,
    /** {data} for a v2 save, {data, legacy, text} for a v1 save, null, or {error}. */
    read() {
      let text = null, legacy = false;
      try {
        text = localStorage.getItem(SAVE_KEY);
        if (!text) { text = localStorage.getItem(V1_KEY); legacy = !!text; }
      } catch (err) { this.ok = false; return { error: 'unavailable' }; }
      if (!text) return null;
      try { return { data: JSON.parse(text), legacy, text }; } catch (err) {
        try { localStorage.setItem(`${legacy ? V1_KEY : SAVE_KEY}.corrupt.${Date.now()}`, text); } catch (_) { /* ignore */ }
        return { error: 'corrupt' };
      }
    },
    /** Keep the old save under a new key, so the pre-shift version is never lost. */
    archiveV1(text) {
      try { localStorage.setItem(V1_ARCHIVE, text); localStorage.removeItem(V1_KEY); } catch (_) { /* ignore */ }
    },
    write(state) {
      state.savedAt = Date.now();
      try {
        localStorage.setItem(SAVE_KEY, JSON.stringify(state));
        this.ok = true;
      } catch (err) {
        this.ok = false;
        console.warn('[FFC] save failed', err);
      }
      return this.ok;
    },
    clear() {
      try { localStorage.removeItem(SAVE_KEY); } catch (_) { /* ignore */ }
    },
    exportString(state) {
      return EXPORT_PREFIX + b64encode(JSON.stringify(state));
    },
    importString(str) {
      const s = String(str || '').trim().replace(/^FFC[12]:/, '');
      return JSON.parse(b64decode(s));
    },
  };

  function save(manual = false) {
    if (G.conflict) return false;
    catchUp();
    const ok = Store.write(G.state);
    G.nextSave = Date.now() + AUTOSAVE_MS;
    View.saveFlash(ok, manual);
    return ok;
  }

  /* ------------------------------------------------------------------------
   * Simulation: crews mine between shifts, by wall-clock time.
   * --------------------------------------------------------------------- */
  function catchUp() {
    const now = Date.now();
    let dt = (now - G.lastSim) / 1000;
    G.lastSim = now;
    if (!(dt > 0)) return; // clock went backwards: never un-earn gold
    if (dt > E.MAX_OFFLINE_SECONDS) dt = E.MAX_OFFLINE_SECONDS;
    E.simulate(G.state, dt);
    G.state.stats.playTime += dt;
  }

  function runOffline(seconds) {
    const s = G.state;
    const before = { reserves: s.run.reserves, dollars: s.dollars, rate: E.derive(s).siteRate };
    const capped = seconds > E.MAX_OFFLINE_SECONDS;
    E.simulate(s, Math.min(seconds, E.MAX_OFFLINE_SECONDS));
    return { seconds, capped, gold: s.run.reserves - before.reserves, dollars: s.dollars - before.dollars, rate: before.rate };
  }

  function refresh() {
    G.d = E.derive(G.state);
  }

  function addLog(title, text, kind = 'info', year) {
    const log = G.state.log;
    log.push({ y: year || Math.floor(G.d ? G.d.year : 1848), title, text, k: kind });
    if (log.length > 40) log.splice(0, log.length - 40);
    View.logDirty = true;
  }

  /* ------------------------------------------------------------------------
   * Purchases
   * --------------------------------------------------------------------- */
  function deny(el) {
    if (el) restartAnim(el, 'denied');
    Sound.deny();
  }

  /** Buy a shop item. Level items use the Upgrades page amount unless one is given. */
  function buyItem(id, el, amount) {
    const it = E.ITEM_BY_ID[id];
    if (!it) return false;
    const amt = it.kind === 'level' ? (amount != null ? amount : G.state.settings.shopAmount) : 1;
    const res = E.buy(G.state, id, amt);
    if (!res.ok) { deny(el); return false; }
    refresh();
    if (it.kind === 'charter') onCharter(it);
    else if (it.kind === 'permit') {
      const b = E.BUILDING_BY_ID[it.site];
      addLog('Permit granted', `${b.name}: hire crews in Territory.`, 'build');
      toast({ kicker: 'PERMIT GRANTED', title: b.name, text: `${E.effectLine(G.state, it, G.d)}. Hire crews on the Territory page.`, icon: A.picto(b.id) });
      Sound.buy(true);
    } else if (it.kind === 'tool') {
      addLog('New tool', `${it.name}. ${it.desc}`, 'research');
      toast({ kicker: 'NEW TOOL', title: it.name, text: it.desc, icon: A.picto(it.icon) });
      Sound.buy(true);
    } else if (it.kind === 'tier') {
      const b = E.BUILDING_BY_ID[it.site];
      addLog('Site improved', `${b.name}: ${it.name} (tier ${ROMAN[it.tier]}).`, 'build');
      toast({ kicker: `${b.name.toUpperCase()} · TIER ${ROMAN[it.tier]}`, title: it.name, text: plain(it.desc), icon: A.picto(b.id), timeout: 4500 });
      Sites.evolve(it.site);
      Sound.buy(true);
    } else {
      Sound.buy(false);
    }
    if (el) restartAnim(el.closest('.scard, .qbuy, .tl-item') || el, 'bought');
    View.slow();
    return true;
  }

  function onCharter(c) {
    const effects = E.charterEffects(c, G.d);
    addLog(c.title, plain(c.text), 'milestone', Math.floor(c.year));
    Ticker.breaking(c);
    toast({ kicker: `CHARTER SIGNED · ${Math.floor(c.year)}`, title: c.title, text: effects.length ? effects.join(' · ') : plain(c.text), year: Math.floor(c.year), timeout: 8000 });
    Sound.chime();
    View.flashKPI('kpi-date-wrap');
    const e = c.effects || {};
    if (e.price || e.cover) View.flashKPI('kpi-rate-wrap');
    if (e.map) { G.state.settings.map = null; Mine.mapsChanged(); } // move to the new field
    if (c.id === E.NIXON.charter) toast({ kicker: 'THE GOLD WINDOW', title: 'Closing the window is possible', text: 'See the Treasury page.', icon: A.uiIcon('vault') });
  }

  function buyCrew(id, el) {
    const def = E.BUILDING_BY_ID[id];
    if (!E.hasPermit(G.state, id)) return buyItem(`permit_${id}`, el);
    const before = G.state.run.buildings[id];
    const res = E.buyBuilding(G.state, id, G.state.settings.buyAmount);
    if (!res.ok) { deny(el); return false; }
    refresh();
    if (before === 0) {
      addLog('First crew', `${def.name} crews are mining between shifts.`, 'build');
      toast({ kicker: 'CREWS AT WORK', title: def.name, text: `Mining ${E.pct(G.d.buildingShare[id])} of your pace between shifts.`, icon: A.picto(id), timeout: 4500 });
    }
    if (el) restartAnim(el, 'bought');
    Sound.buy(false);
    View.slow();
    return true;
  }

  /* ------------------------------------------------------------------------
   * Sound: small synthesized cues
   * --------------------------------------------------------------------- */
  const Sound = {
    ctx: null,
    noiseBuf: null,
    last: {},
    on() { return G.state && G.state.settings.sound; },
    ensure() {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        try { this.ctx = new AC(); } catch (_) { return null; }
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    },
    /** Skip a cue that fired less than `ms` ago (drills and chain blasts fire fast). */
    gate(key, ms) {
      const now = performance.now();
      if (now - (this.last[key] || 0) < ms) return false;
      this.last[key] = now;
      return true;
    },
    tone(freq, dur, type = 'sine', gain = 0.04, delay = 0, slide = 0) {
      const ctx = this.ensure();
      if (!ctx) return;
      const t = ctx.currentTime + delay;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t);
      if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + dur + 0.02);
    },
    noise(dur, gain, freq, delay = 0) {
      const ctx = this.ensure();
      if (!ctx) return;
      if (!this.noiseBuf) {
        const len = Math.floor(ctx.sampleRate * 0.6);
        this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
        const ch = this.noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
      }
      const t = ctx.currentTime + delay;
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(freq, t);
      const g = ctx.createGain();
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f).connect(g).connect(ctx.destination);
      src.start(t);
      src.stop(t + dur + 0.02);
    },
    pick(cracked) {
      if (!this.on() || !this.gate('pick', 45)) return;
      const f = cracked ? 1250 + Math.random() * 400 : 700 + Math.random() * 200;
      this.tone(f, 0.07, 'triangle', cracked ? 0.04 : 0.02);
      this.noise(0.05, cracked ? 0.05 : 0.025, 3200);
    },
    crack(type) {
      if (!this.on() || !this.gate('crack', 40)) return;
      if (type === 'nugget' || type === 'vein') { [1568, 2093].forEach((f, i) => this.tone(f, 0.18, 'sine', 0.03, i * 0.04)); return; }
      if (type === 'lode') { this.lode(); return; }
      this.noise(0.12, 0.07, 1800);
      this.tone(220 + Math.random() * 60, 0.1, 'square', 0.012, 0, 0.6);
    },
    blast() {
      if (!this.on() || !this.gate('blast', 90)) return;
      this.noise(0.45, 0.16, 600);
      this.tone(90, 0.35, 'sine', 0.08, 0, 0.5);
    },
    lode() { if (!this.on()) return; [784, 988, 1175, 1568].forEach((f, i) => this.tone(f, 0.45, 'triangle', 0.035, i * 0.08)); },
    shiftEnd() { if (!this.on()) return; [659, 523].forEach((f, i) => this.tone(f, 0.3, 'sine', 0.03, i * 0.12)); },
    start() { if (!this.on()) return; [523, 784].forEach((f, i) => this.tone(f, 0.16, 'square', 0.014, i * 0.07)); },
    buy(big) { if (!this.on()) return; this.tone(big ? 520 : 330, 0.12, 'square', 0.018); this.tone(big ? 780 : 495, 0.16, 'sine', 0.03, 0.05); },
    deny() { if (!this.on()) return; this.tone(150, 0.12, 'sawtooth', 0.015); },
    chime() { if (!this.on()) return; [784, 988, 1319].forEach((f, i) => this.tone(f, 0.5, 'sine', 0.03, i * 0.09)); },
  };

  /* ------------------------------------------------------------------------
   * Pages: Mine, Upgrades, Territory, Treasury
   * --------------------------------------------------------------------- */
  const Pages = {
    current: 'mine',
    init() {
      $('tabs').querySelectorAll('[data-page]').forEach((b) => {
        b.querySelector('.tab-ico').innerHTML = A.uiIcon(b.querySelector('.tab-ico').dataset.icon);
        b.addEventListener('click', () => this.show(b.dataset.page));
      });
      $('tabs').addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        const i = PAGES.indexOf(this.current) + (e.key === 'ArrowRight' ? 1 : -1);
        this.show(PAGES[(i + PAGES.length) % PAGES.length]);
        $(`tab-${this.current}`).focus();
      });
      document.addEventListener('click', (e) => {
        const b = e.target.closest('[data-goto]');
        if (b) this.show(b.dataset.goto);
      });
    },
    show(page, { scroll = true } = {}) {
      if (!PAGES.includes(page)) page = 'mine';
      const from = this.current;
      if (from === 'mine' && page !== 'mine') Mine.leave();
      this.current = page;
      G.state.settings.tab = page;
      for (const p of PAGES) {
        const on = p === page;
        $(`page-${p}`).hidden = !on;
        const tab = $(`tab-${p}`);
        tab.setAttribute('aria-selected', String(on));
        tab.tabIndex = on ? 0 : -1;
      }
      document.body.dataset.page = page;
      Tip.hide();
      if (page === 'mine') Mine.enter();
      if (scroll && from !== page && phone()) window.scrollTo(0, 0);
      View.slow();
    },
  };

  /* ------------------------------------------------------------------------
   * The mine: timed shifts on a canvas (Mining.createView)
   * --------------------------------------------------------------------- */
  const Mine = {
    view: null,
    phase: 'ready',       // ready | running | paused | report
    tally: { gold: 0, dollars: 0 },
    report: null,
    foremanT: null,
    reportAt: 0,
    statsKey: '',
    mapsKey: null,
    bannerT: 0,
    init() {
      const canvas = $('mine-canvas');
      this.view = M.createView(canvas, {
        onDeposit: (gold) => this.deposit(gold),
        onEvent: (ev) => this.onEvent(ev),
        sound: { strike: (c) => Sound.pick(c), crack: (t) => Sound.crack(t), blast: () => Sound.blast() },
        fmtGold: (v) => fmt(v, v < 10 ? 2 : 1),
      });
      this.view.setReduced(reducedMotion());
      if (window.ResizeObserver) new ResizeObserver(() => this.resize()).observe($('mine-wrap'));
      let fitQueued = false;
      window.addEventListener('resize', () => {
        if (fitQueued) return;
        fitQueued = true;
        requestAnimationFrame(() => { fitQueued = false; this.fitHeight(); if (!window.ResizeObserver) this.resize(); });
      });
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => this.fitHeight());
      $('mine-overlay').addEventListener('click', (e) => {
        const b = e.target.closest('[data-act]');
        if (b) { this.act(b.dataset.act); return; }
        if (this.phase === 'ready' || this.phase === 'paused') this.act(this.phase === 'ready' ? 'start' : 'resume');
      });
      canvas.addEventListener('keydown', (e) => {
        if ((e.key === ' ' || e.key === 'Enter') && !this.view.running) { e.preventDefault(); this.act(this.phase === 'paused' ? 'resume' : 'start'); }
      });
      $('map-chips').addEventListener('click', (e) => {
        const b = e.target.closest('[data-map]');
        if (!b) return;
        G.state.settings.map = b.dataset.map;
        refresh();
        this.renderMaps();
        if (!this.view.running && this.phase !== 'report') this.view.preview(G.d.mine);
        this.renderOverlay();
      });
      this.renderOverlay();
    },
    /** Size the rock face to fill the screen between the header and the bottom bar. */
    fitHeight() {
      const wrap = $('mine-wrap');
      if (Pages.current !== 'mine' || !wrap.offsetParent) return;
      const r = wrap.getBoundingClientRect();
      const small = phone();
      const bar = small ? $('tabs').offsetHeight : (document.querySelector('.statusbar') || {}).offsetHeight || 0;
      const h = Math.round(clamp(window.innerHeight - (r.top + window.scrollY) - bar - (small ? 10 : 14), small ? 300 : 380, 900));
      // Mid-shift, ignore small changes (phone toolbars) so the field does not jump.
      if (Math.abs(h - r.height) > 2 && !(this.view.running && Math.abs(h - r.height) < 80)) wrap.style.height = `${h}px`;
    },
    resize() {
      if (Pages.current !== 'mine' || document.hidden) return;
      this.view.resize();
      if (!this.view.shift || (this.phase === 'ready' && !this.view.running)) this.view.preview(G.d.mine);
    },
    enter() {
      this.fitHeight();
      requestAnimationFrame(() => this.resize());
      this.renderOverlay();
    },
    leave() {
      if (this.phase === 'running') this.pause();
    },
    act(a) {
      if (a === 'start') this.start();
      else if (a === 'resume') this.resume();
      else if (a === 'stay') { this.foremanT = null; this.renderOverlay(); }
      else if (a === 'upgrades') Pages.show('upgrades');
    },
    start() {
      if (this.view.running) return;
      if (this.phase === 'report' && performance.now() - this.reportAt < 600) return; // a held tap at the buzzer
      Sound.ensure();
      refresh();
      this.tally = { gold: 0, dollars: 0 };
      this.foremanT = null;
      this.view.resize();
      this.view.start(G.d.mine);
      this.statsKey = JSON.stringify(G.d.mine);
      Sound.start();
      try { $('mine-canvas').focus({ preventScroll: true }); } catch (_) { /* ignore */ }
    },
    pause() {
      if (!this.view.running) return;
      this.view.paused = true;
      this.view.holding = false;
      this.phase = 'paused';
      this.renderOverlay();
    },
    resume() {
      if (this.phase !== 'paused') return;
      this.view.paused = false;
      this.phase = 'running';
      this.view.setStats(G.d.mine);
      this.statsKey = JSON.stringify(G.d.mine);
      this.renderOverlay();
    },
    deposit(gold) {
      const dollars = E.deposit(G.state, gold, G.d);
      this.tally.gold += gold;
      this.tally.dollars += dollars;
    },
    onEvent(ev) {
      if (ev.type === 'start') {
        this.phase = 'running';
        this.renderOverlay();
      } else if (ev.type === 'lode') {
        const b = $('mine-banner');
        b.hidden = false;
        restartAnim(b, 'show');
        this.bannerT = 2.2;
        Sound.lode();
      } else if (ev.type === 'end') {
        const r = ev.result;
        const records = E.recordShift(G.state, r);
        refresh();
        this.report = Object.assign({}, r, { dollars: this.tally.dollars, records, no: G.state.run.shifts });
        this.phase = 'report';
        this.reportAt = performance.now();
        this.foremanT = G.d.mine.foreman ? FOREMAN_DELAY_S : null;
        Sound.shiftEnd();
        if (r.lodes) addLog('Mother Lode', `A Mother Lode paid ${oz(r.lodeGold)} this shift.`, 'lucky');
        if (records.shift) {
          addLog('Record shift', `${oz(r.gold)} in one shift.`, 'lucky');
          toast({ kicker: 'NEW RECORD', title: 'Best shift yet', text: `${oz(r.gold)}, worth ${fmtUSD(this.tally.dollars)} at the Mint.`, icon: A.picto('pick', P_GOLD), timeout: 3500 });
        }
        this.renderOverlay();
        View.slow();
      }
    },
    /** Upgrades bought mid-shift apply at once; the field preview follows between shifts. */
    statsChanged() {
      const key = JSON.stringify(G.d.mine);
      if (key === this.statsKey) return;
      this.statsKey = key;
      if (this.view.running) this.view.setStats(G.d.mine);
      else if (this.phase === 'ready' && Pages.current === 'mine') this.view.preview(G.d.mine);
    },
    mapsChanged() {
      refresh();
      this.renderMaps();
      if (!this.view.running && this.phase !== 'report' && Pages.current === 'mine') this.view.preview(G.d.mine);
    },
    frame(dt) {
      if (Pages.current !== 'mine' || document.hidden) return;
      this.view.frame(dt);
      if (this.bannerT > 0) {
        this.bannerT -= dt;
        if (this.bannerT <= 0) $('mine-banner').hidden = true;
      }
      if (this.phase === 'report' && this.foremanT != null && !Modal.isOpen) {
        this.foremanT -= dt;
        setText($('foreman-t'), String(Math.max(1, Math.ceil(this.foremanT))));
        if (this.foremanT <= 0) this.start();
      }
      this.hud();
    },
    hud() {
      const s = this.view.shift;
      const dur = G.d.mine.duration;
      if (this.view.running || this.phase === 'paused') {
        const left = Math.max(0, s.stats.duration - s.t);
        setText($('mine-time'), `${left.toFixed(1)}s`);
        setWidth($('mine-time-fill'), left / s.stats.duration);
        toggleClass($('mine-wrap'), 'ending', left < 3 && this.view.running);
      } else {
        setText($('mine-time'), `${dur.toFixed(1)}s`);
        setWidth($('mine-time-fill'), this.phase === 'report' ? 0 : 1);
        toggleClass($('mine-wrap'), 'ending', false);
      }
      const show = this.phase === 'ready' ? null : this.tally;
      setText($('mine-gold'), show ? oz(show.gold) : '0 oz');
      setText($('mine-dollars'), show ? `+${fmtUSD(show.dollars)}` : `${fmtUSD(G.d.dollarsPerOz)}/oz`);
    },
    renderOverlay() {
      const el = $('mine-overlay');
      const d = G.d, m = d.mine;
      const swings = `${(1 / m.swing).toFixed(1)} swings/s`;
      let html = '';
      if (this.phase === 'ready') {
        const first = G.state.run.shifts === 0;
        const touch = matchMedia('(pointer: coarse)').matches;
        html = `<div class="mo-card">
          <div class="mo-kicker">SHIFT ${G.state.run.shifts + 1} · ${esc(d.map.name.toUpperCase())}</div>
          <h3>${first ? 'Your first shift' : 'Ready at the rock face'}</h3>
          <p>${touch ? (first
            ? 'Hold your finger <b>just below</b> a rock: the pick floats above your fingertip, so you can watch the rock crack. It hits <b>every rock inside its ring</b>, so aim for clusters.'
            : 'Hold just below the rock: the pick floats above your finger. Aim the ring at clusters of rock and nuggets.')
            : first ? 'Tap a rock to swing your pick, or hold down to keep swinging. The pick hits <b>every rock inside its ring</b>, so aim for clusters.' : 'Tap or hold on the rock. Aim the ring at clusters of rock and nuggets.'}</p>
          <div class="mo-stats"><span>${m.duration.toFixed(0)}s shift</span><span>reach ${Math.round(m.radius)}</span><span>${swings}</span></div>
          <button type="button" class="btn btn-primary btn-big" data-act="start">${A.uiIcon('pick')}Start shift</button>
        </div>`;
      } else if (this.phase === 'paused') {
        const s = this.view.shift;
        html = `<div class="mo-card">
          <div class="mo-kicker">SHIFT PAUSED</div>
          <h3>${Math.max(0, s.stats.duration - s.t).toFixed(1)}s left on the clock</h3>
          <p>Shifts pause when you leave the mine. Crews keep working.</p>
          <button type="button" class="btn btn-primary btn-big" data-act="resume">${A.uiIcon('play')}Resume</button>
        </div>`;
      } else if (this.phase === 'report' && this.report) {
        const r = this.report;
        const ready = Shop.affordableCount();
        html = `<div class="mo-card report">
          <div class="mo-kicker">ASSAY REPORT · SHIFT ${r.no}</div>
          <div class="mo-big">+${esc(oz(r.gold))}</div>
          <div class="mo-sub">The Mint paid <b>${esc(fmtUSD(r.dollars))}</b> at ${esc(fmtUSD(d.dollarsPerOz))}/oz</div>
          <dl class="mo-grid">
            <div><dt>Rock broken</dt><dd>${fmt(r.ore)}</dd></div>
            <div><dt>Best swing</dt><dd>${esc(oz(r.best))}</dd></div>
            <div><dt>Crits</dt><dd>${fmt(r.crits)}</dd></div>
            <div><dt>Pace</dt><dd>${esc(rate(d.pace))} oz/s</dd></div>
          </dl>
          ${r.lodes ? `<div class="mo-flag lode">${A.uiIcon('spark')}Mother Lode: +${esc(oz(r.lodeGold))}</div>` : ''}
          ${r.records.shift ? `<div class="mo-flag">${A.uiIcon('spark')}New record shift</div>` : ''}
          <div class="mo-actions">
            <button type="button" class="btn btn-primary btn-big" data-act="start">${A.uiIcon('pick')}Next shift</button>
            <button type="button" class="btn" data-act="upgrades">Upgrades${ready ? ` <b class="pill">${ready}</b>` : ''}</button>
          </div>
          ${this.foremanT != null ? `<div class="mo-foreman">${A.picto('whistle')}<span>Foreman starts the next shift in <b id="foreman-t">${Math.ceil(this.foremanT)}</b>s</span><button type="button" class="link-btn" data-act="stay">Stay</button></div>` : ''}
        </div>`;
      }
      el.hidden = !html;
      setHTML(el, html);
      toggleClass($('mine-wrap'), 'running', this.phase === 'running');
    },
    renderMaps() {
      const d = G.d;
      const key = d.maps.join(',') + '|' + d.map.id;
      if (key === this.mapsKey) return;
      this.mapsKey = key;
      const box = $('map-chips');
      box.hidden = d.maps.length < 2;
      requestAnimationFrame(() => this.fitHeight()); // a new row of chips can move the rock face
      box.innerHTML = d.maps.map((id) => {
        const m = E.MAP_BY_ID[id];
        return `<button type="button" role="radio" class="chip" data-map="${id}" data-tip="map:${id}" aria-checked="${id === d.map.id}">${esc(m.name)}</button>`;
      }).join('');
      setText($('mine-place'), d.map.place);
    },
    /** Pick stats panel on the mine page. */
    renderStats() {
      const d = G.d, m = d.mine;
      const rows = [
        ['Reach', `${Math.round(m.radius)}`, 'Radius of the ring. Every rock inside it takes the hit.'],
        ['Damage', fmt(m.damage, 1), 'Damage per swing. Harder rock needs more hits.'],
        ['Swings', `${(1 / m.swing).toFixed(1)}/s`, 'Hold down to keep swinging at this pace.'],
      ];
      if (m.critChance > 0) rows.push(['Crits', `${Math.round(m.critChance * 100)}% · ×${m.critMult.toFixed(1)}`, 'Chance of a critical swing, and how much harder it hits.']);
      rows.push(['Shift', `${m.duration.toFixed(1)}s`, 'Length of each shift.']);
      rows.push(['Rock face', `${m.cap} rocks`, 'Rocks in the face at once. Broken rock is replaced.']);
      rows.push(['Gold per rock', `×${fmt(m.goldMult, 2)}`, `Assaying, history and this mine (${d.map.name}: ×${d.map.gold} gold, ×${d.map.hp} rock).`]);
      rows.push(['Mother Lode', `${Math.round(m.lodeChance * 100)}% a shift`, 'Chance that a huge glowing lode appears during a shift.']);
      if (m.dynamite) rows.push(['Dynamite', `${Math.round(m.dynamite * 100)}% blast`, 'Chance that broken rock explodes into its neighbours.']);
      if (m.drill) rows.push(['Rock drill', `${(m.drill / m.swing).toFixed(1)} hits/s`, 'Strikes on its own wherever the ring rests.']);
      rows.push(['Your pace', `${rate(d.pace)} oz/s`, 'Gold per second over your recent shifts, not counting Mother Lodes. Crews mine a share of it.']);
      setHTML($('pick-stats'), rows.map(([k, v, tip]) => `<div class="stat-line" data-tip="text:stat" data-tip-text="${esc(tip)}"><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join(''));
    },
  };
  const P_GOLD = '#f5c542';

  /* ------------------------------------------------------------------------
   * Upgrades page (the shop)
   * --------------------------------------------------------------------- */
  const Shop = {
    key: null,
    cat: 'all',
    cards: new Map(),
    init() {
      $('shop-filter').addEventListener('click', (e) => {
        const b = e.target.closest('[data-filter]');
        if (!b) return;
        G.state.settings.shopFilter = b.dataset.filter;
        this.syncControls();
        View.slow();
      });
      $('shop-amount').addEventListener('click', (e) => {
        const b = e.target.closest('[data-amt]');
        if (!b) return;
        G.state.settings.shopAmount = b.dataset.amt === 'max' ? 'max' : Number(b.dataset.amt);
        this.syncControls();
        View.slow();
      });
      $('cat-nav').addEventListener('click', (e) => {
        const b = e.target.closest('[data-cat]');
        if (!b) return;
        this.cat = b.dataset.cat;
        this.key = null;
        View.slow();
      });
      $('shop').addEventListener('click', (e) => {
        const b = e.target.closest('[data-buy]');
        if (b) buyItem(b.dataset.buy, b);
      });
      $('quick-buys').addEventListener('click', (e) => {
        const b = e.target.closest('[data-buy]');
        if (b) buyItem(b.dataset.buy, b, 1);
      });
      this.syncControls();
    },
    syncControls() {
      const st = G.state.settings;
      $('shop-filter').querySelectorAll('[data-filter]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.filter === st.shopFilter)));
      $('shop-amount').querySelectorAll('[data-amt]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.amt === String(st.shopAmount))));
    },
    /** Items shown on the page: every level, tool and permit; the next tier of each
     *  site; the next charter plus two previews. */
    visible() {
      const s = G.state, d = G.d;
      const next = E.nextCharter(s);
      const ni = next ? E.CHARTERS.indexOf(next) : -1;
      const out = [];
      for (const it of E.ITEMS) {
        if (it.kind === 'tier' && (!E.hasPermit(s, it.site) || it.tier !== d.tiers[it.site] + 1)) continue;
        if (it.kind === 'charter') {
          const ci = E.CHARTERS.indexOf(E.CHARTER_BY_ID[it.id]);
          if (ni < 0 || ci < ni || ci > ni + 2) continue;
        }
        out.push(it);
      }
      return out;
    },
    cost(it) {
      return E.quote(G.state, it, it.kind === 'level' ? G.state.settings.shopAmount : 1);
    },
    canBuy(it) {
      return E.status(G.state, it) === 'available' && this.cost(it).cost <= G.state.dollars;
    },
    affordableCount() {
      let n = 0;
      for (const it of this.visible()) if (this.canBuy(it)) n++;
      return n;
    },
    render() {
      const s = G.state;
      const items = this.visible();
      const ready = s.settings.shopFilter === 'ready';
      const rows = items.map((it) => ({ it, st: E.status(s, it) }));
      const shown = rows.filter(({ it, st }) => (this.cat === 'all' || it.cat === this.cat) && (!ready || (st === 'available' && this.cost(it).cost <= s.dollars)));
      const key = [this.cat, s.settings.shopFilter, s.settings.shopAmount, s.settings.notation,
        ...shown.map(({ it, st }) => `${it.id}:${st}:${E.level(s, it.id)}`)].join('|');
      if (key !== this.key) {
        this.key = key;
        this.build(shown);
      }
      // live: prices (MAX depends on dollars), affordability, progress
      for (const { it, st } of shown) {
        const c = this.cards.get(it.id);
        if (!c) continue;
        if (st !== 'available') continue;
        const q = this.cost(it);
        const can = q.cost <= s.dollars;
        toggleClass(c.root, 'can', can);
        setText(c.cost, fmtUSD(q.cost));
        if (c.qty && it.kind === 'level') setText(c.qty, `×${q.n}`);
        const p = `${(clamp(s.dollars / q.cost, 0, 1) * 100).toFixed(1)}%`;
        if (c.p !== p) { c.p = p; c.buy.style.setProperty('--p', p); }
      }
      // category chips with affordable counts
      const counts = {};
      for (const { it, st } of rows) if (st === 'available' && this.cost(it).cost <= s.dollars) counts[it.cat] = (counts[it.cat] || 0) + 1;
      const total = Object.values(counts).reduce((a, b) => a + b, 0);
      const nav = [{ id: 'all', name: 'All' }].concat(E.CATEGORIES).map((c) => {
        const n = c.id === 'all' ? total : counts[c.id] || 0;
        return `<button type="button" class="chip" data-cat="${c.id}" aria-pressed="${this.cat === c.id}">${esc(c.name)}${n ? ` <b>${n}</b>` : ''}</button>`;
      }).join('');
      setHTML($('cat-nav'), nav);
      const owned = E.ITEMS.filter((it) => it.kind !== 'charter' && E.owns(s, it.id)).length + Object.keys(s.run.charters).length - 1;
      setText($('shop-count'), `${owned} OWNED`);
    },
    build(rows) {
      this.cards.clear();
      const s = G.state;
      const cats = (this.cat === 'all' ? E.CATEGORIES : E.CATEGORIES.filter((c) => c.id === this.cat));
      let html = '';
      for (const cat of cats) {
        const list = rows.filter(({ it }) => it.cat === cat.id);
        if (!list.length) continue;
        const rank = { available: 0, locked: 1, maxed: 2, owned: 3 };
        list.sort((a, b) => rank[a.st] - rank[b.st]);
        const open = list.filter((r) => r.st === 'available' || r.st === 'locked');
        const done = list.filter((r) => r.st === 'maxed' || r.st === 'owned');
        html += `<section class="shop-cat"><header class="shop-cat-head"><h3>${esc(cat.name)}</h3><span>${esc(cat.blurb)}</span></header>
          <div class="shop-grid">${open.map((r) => this.card(r.it, r.st)).join('')}</div>
          ${done.length ? `<div class="owned-strip">${done.map((r) => this.ownedChip(r.it, r.st)).join('')}</div>` : ''}</section>`;
      }
      if (!html) {
        html = `<p class="empty">${s.settings.shopFilter === 'ready' ? 'Nothing affordable right now. Mine another shift, or switch to All to read what is coming.' : 'Nothing here yet.'}</p>`;
      }
      const box = $('shop');
      box.innerHTML = html;
      box.querySelectorAll('.scard').forEach((root) => {
        const buy = root.querySelector('.scard-buy');
        this.cards.set(root.dataset.id, { root, buy, cost: root.querySelector('.scard-cost'), qty: root.querySelector('.scard-qty'), p: null });
      });
    },
    icon(it) {
      if (it.kind === 'permit' || it.kind === 'tier') return A.picto(it.site);
      return A.picto(it.icon);
    },
    card(it, st) {
      const s = G.state, d = G.d;
      const lvl = E.level(s, it.id);
      const badge = it.kind === 'level' ? `LV ${lvl} / ${it.max}`
        : it.kind === 'tier' ? `TIER ${ROMAN[it.tier]}`
          : it.kind === 'charter' ? String(Math.floor(it.year))
            : it.kind === 'permit' ? 'PERMIT' : 'TOOL';
      const effect = E.effectLine(s, it, d);
      const desc = it.kind === 'charter' ? it.text : it.desc;
      const req = st === 'locked' ? E.missing(s, it) : [];
      const q = this.cost(it);
      const buy = st === 'available'
        ? `<button type="button" class="scard-buy" data-buy="${it.id}"><span class="scard-cost">${esc(fmtUSD(q.cost))}</span>${it.kind === 'level' ? `<span class="scard-qty">×${q.n}</span>` : `<span class="scard-qty">${it.kind === 'charter' ? 'SIGN' : 'BUY'}</span>`}</button>`
        : `<div class="scard-buy locked">${A.uiIcon('lock')}<span>${esc(fmtUSD(q.cost))}</span></div>`;
      return `<article class="scard ${st}${it.kind === 'charter' ? ' charter' : ''}" data-id="${it.id}" data-kind="${it.kind}">
        <div class="scard-ico">${this.icon(it)}</div>
        <div class="scard-main">
          <div class="scard-top"><h4>${esc(it.name)}</h4><span class="scard-lv">${esc(badge)}</span></div>
          <div class="scard-effect">${esc(effect)}</div>
          <p class="scard-desc">${rich(desc)}</p>
          ${req.length ? `<ul class="scard-req">${req.map((r) => `<li>${A.uiIcon('lock')}<span>${esc(r)}</span></li>`).join('')}</ul>` : ''}
        </div>
        ${buy}
      </article>`;
    },
    ownedChip(it, st) {
      const label = it.kind === 'level' ? `${it.name} · MAX` : it.name;
      return `<span class="ochip" title="${esc(E.effectLine(G.state, it, G.d))}">${this.icon(it)}<span>${esc(label)}</span>${A.uiIcon('check')}</span>`;
    },
    /** Mine page: the cheapest few things worth buying right now. */
    renderQuick() {
      const s = G.state;
      const pool = this.visible().filter((it) => E.status(s, it) === 'available' && it.kind !== 'tier');
      pool.sort((a, b) => E.quote(s, a, 1).cost - E.quote(s, b, 1).cost);
      const pick = pool.slice(0, 4);
      const key = pick.map((it) => `${it.id}:${E.level(s, it.id)}`).join(',') + '|' + s.settings.notation;
      const box = $('quick-buys');
      if (box._key !== key) {
        box._key = key;
        box.innerHTML = pick.length ? pick.map((it) => {
          const lvl = E.level(s, it.id);
          const effect = it.kind === 'level' ? `${it.show(it.value(lvl))} → ${it.show(it.value(lvl + 1))}` : E.effectLine(s, it, G.d);
          return `<button type="button" class="qbuy" data-buy="${it.id}"><span class="qbuy-ico">${this.icon(it)}</span><span class="qbuy-main"><b>${esc(it.name)}</b><small>${esc(effect)}</small></span><span class="qbuy-cost"></span></button>`;
        }).join('') : '<p class="empty">Everything available is bought. Sign the next charter to unlock more.</p>';
      }
      box.querySelectorAll('.qbuy').forEach((b) => {
        const it = E.ITEM_BY_ID[b.dataset.buy];
        const cost = E.quote(s, it, 1).cost;
        toggleClass(b, 'can', cost <= s.dollars);
        setText(b.querySelector('.qbuy-cost'), fmtUSD(cost));
        const p = `${(clamp(s.dollars / cost, 0, 1) * 100).toFixed(1)}%`;
        if (b._p !== p) { b._p = p; b.style.setProperty('--p', p); }
      });
    },
  };

  /* ------------------------------------------------------------------------
   * Territory: the panorama and the crews
   * --------------------------------------------------------------------- */
  const Sites = {
    cards: new Map(),
    sceneKeys: {},
    infraKey: null,
    observer: null,
    init() {
      $('buy-seg').addEventListener('click', (e) => {
        const b = e.target.closest('button[data-amt]');
        if (!b) return;
        G.state.settings.buyAmount = b.dataset.amt === 'max' ? 'max' : Number(b.dataset.amt);
        this.syncSeg();
        View.slow();
      });
      this.syncSeg();
      if ('IntersectionObserver' in window) {
        this.observer = new IntersectionObserver((entries) => {
          entries.forEach((en) => en.target.classList.toggle('offscreen', !en.isIntersecting));
        }, { rootMargin: '80px' });
        this.observer.observe($('scene-wrap'));
      }
      const grid = $('bgrid');
      E.BUILDINGS.forEach((b) => {
        const c = this.createCard(b);
        this.cards.set(b.id, c);
        grid.appendChild(c.root);
      });
      this.initScene();
    },
    syncSeg() {
      const amt = String(G.state.settings.buyAmount);
      document.querySelectorAll('#buy-seg button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.amt === amt)));
    },
    reset() {
      this.cards.forEach((c) => { c.artKey = null; c.stateKey = null; });
      this.initScene();
    },
    initScene() {
      $('scene').setAttribute('viewBox', A.SCENE.viewBox);
      $('scene').innerHTML = `${A.sceneBase()}<g id="scene-infra"></g>${A.SLOT_ORDER.map((id) => `<g id="slot-${id}"></g>`).join('')}${A.sceneHaze()}`;
      this.sceneKeys = {};
      this.infraKey = null;
    },
    createCard(def) {
      const root = document.createElement('button');
      root.type = 'button';
      root.className = 'bcard';
      root.dataset.id = def.id;
      root.dataset.tip = `site:${def.id}`;
      root.dataset.tipPos = 'side';
      root.innerHTML = `<div class="bcard-art"><div class="bcard-svg"></div><span class="bcard-tier"></span><span class="bcard-count">0</span>
          <div class="locked-overlay">${A.uiIcon('lock')}<span class="lo-title">LOCKED</span><span class="lo-sub"></span></div></div>
        <div class="bcard-body">
          <div class="bcard-row"><span class="bcard-name">${esc(def.name)}</span><span class="bcard-year">${def.year}</span></div>
          <div class="bcard-row small"><span class="bcard-out"></span></div>
          <span class="meter thin"><span></span></span>
          <div class="bcard-row small"><span class="bcard-next"></span></div>
          <div class="bcard-buy"><span class="bcard-qty">BUY ×1</span><span class="bcard-cost"></span></div>
        </div>`;
      root.addEventListener('click', () => {
        if (root.classList.contains('locked')) { Sound.deny(); return; }
        buyCrew(def.id, root);
      });
      const art = root.querySelector('.bcard-art');
      if (this.observer) this.observer.observe(art);
      return {
        root, art,
        svg: root.querySelector('.bcard-svg'),
        tier: root.querySelector('.bcard-tier'),
        count: root.querySelector('.bcard-count'),
        out: root.querySelector('.bcard-out'),
        next: root.querySelector('.bcard-next'),
        share: root.querySelector('.meter > span'),
        qty: root.querySelector('.bcard-qty'),
        cost: root.querySelector('.bcard-cost'),
        loSub: root.querySelector('.lo-sub'),
        artKey: null,
        stateKey: null,
      };
    },
    evolve(id) {
      const c = this.cards.get(id);
      if (c) restartAnim(c.art, 'evolve');
    },
    render() {
      const s = G.state, d = G.d;
      let built = 0, sites = 0;
      for (const b of E.BUILDINGS) {
        const c = this.cards.get(b.id);
        const owned = s.run.buildings[b.id];
        const permit = E.hasPermit(s, b.id);
        const open = !!s.run.charters[b.permitCharter];
        built += owned;
        if (owned) sites++;
        const state = permit ? 'active' : open ? 'permit' : 'locked';
        const tier = d.tiers[b.id];
        const artKey = `${tier}|${state === 'locked'}`;
        if (c.artKey !== artKey) {
          c.artKey = artKey;
          c.svg.innerHTML = A.building(b.id, tier, state === 'locked' ? { locked: true, label: `${b.name} (locked)` } : { label: `${b.name}, ${b.tiers[tier]}` });
        }
        if (c.stateKey !== state) {
          c.stateKey = state;
          c.root.classList.remove('locked', 'permit', 'active');
          c.root.classList.add(state);
          if (state === 'locked') {
            const ch = E.CHARTER_BY_ID[b.permitCharter];
            setText(c.loSub, `${ch.title.toUpperCase()} · ${Math.floor(ch.year)}`);
          }
        }
        toggleClass(c.root, 'unbuilt', owned === 0);
        setText(c.tier, tier ? `${ROMAN[tier]} · ${b.tiers[tier].toUpperCase()}` : b.tiers[0].toUpperCase());
        setText(c.count, String(owned));
        const limit = d.limit[b.id];
        if (state === 'locked') {
          setText(c.out, `Crews up to ${E.pct(limit)} of your pace`);
          setText(c.next, 'Opens with a charter');
          setWidth(c.share, 0);
          setText(c.qty, 'LOCKED');
          setText(c.cost, '');
          toggleClass(c.root, 'can', false);
        } else if (state === 'permit') {
          const it = E.ITEM_BY_ID[`permit_${b.id}`];
          setText(c.out, `Crews up to ${E.pct(limit)} of your pace`);
          setText(c.next, 'Needs a permit first');
          setWidth(c.share, 0);
          setText(c.qty, 'PERMIT');
          setText(c.cost, fmtUSD(it.cost));
          toggleClass(c.root, 'can', s.dollars >= it.cost);
        } else {
          const share = d.buildingShare[b.id];
          setText(c.out, owned ? `${E.pct(share)} of pace · ${rate(d.buildingRate[b.id])} oz/s` : `No crews yet · limit ${E.pct(limit)}`);
          setWidth(c.share, limit > 0 ? share / limit : 0);
          setText(c.next, `Next crew +${E.pct(d.nextShare[b.id])} · limit ${E.pct(limit)}`);
          const q = E.purchaseQuote(s, b, s.settings.buyAmount);
          const can = s.dollars >= q.cost;
          setText(c.qty, q.isMax ? `MAX ×${can ? q.n : 1}` : `HIRE ×${q.n}`);
          setText(c.cost, fmtUSD(q.cost));
          toggleClass(c.root, 'can', can);
        }
      }
      setText($('ops-count'), `${fmt(built)} ${built === 1 ? 'CREW' : 'CREWS'}`);
      setText($('scene-sites'), `${sites} / ${E.BUILDINGS.length} SITES`);
      setText($('crew-share'), E.pct(d.paceShare));
      const maxShare = E.BUILDINGS.reduce((a, b) => a + (E.hasPermit(s, b.id) ? d.limit[b.id] : 0), 0);
      setText($('crew-cap'), maxShare ? `(limit ${E.pct(maxShare)} with your permits)` : '(buy a permit to hire crews)');
      setWidth($('crew-fill'), maxShare ? d.paceShare / maxShare : 0);
      setText($('crew-pace'), `${rate(d.pace)} oz/s`);
      setText($('crew-rate'), `${rate(d.siteRate)} oz/s · ${usdRate(d.dollarRate)}/s`);
      setWidth($('industry-fill'), d.industry);
      setText($('industry-val'), `${Math.round(d.industry * 100)}%`);
      this.renderScene();
    },
    renderScene() {
      const s = G.state, d = G.d;
      for (const id of A.SLOT_ORDER) {
        const def = E.BUILDING_BY_ID[id];
        const owned = s.run.buildings[id] > 0;
        const visible = !!s.run.charters[def.permitCharter];
        const tier = d.tiers[id];
        const key = `${owned}|${visible}|${tier}`;
        if (this.sceneKeys[id] === key) continue;
        const wasOwned = (this.sceneKeys[id] || '').startsWith('true');
        this.sceneKeys[id] = key;
        const g = $(`slot-${id}`);
        g.innerHTML = A.sceneSlot(id, tier, owned, visible);
        if (owned && !wasOwned && g.firstElementChild) g.firstElementChild.classList.add('fresh');
      }
      const ch = s.run.charters;
      const flags = { telegraph: !!ch.c1861, railroad: !!ch.c1869, fed: !!ch.c1913 };
      const ikey = `${flags.telegraph}${flags.railroad}${flags.fed}`;
      if (ikey !== this.infraKey) {
        this.infraKey = ikey;
        $('scene-infra').innerHTML = A.sceneInfra(flags);
      }
      const smog = document.querySelector('#scene .scene-smog');
      const stars = document.querySelector('#scene .scene-stars');
      if (smog) smog.style.opacity = (d.industry * 0.95).toFixed(3);
      if (stars) stars.style.opacity = (1 - d.industry * 0.7).toFixed(3);
    },
  };

  /* ------------------------------------------------------------------------
   * Treasury: the Mint, the history timeline and the gold window
   * --------------------------------------------------------------------- */
  const Treasury = {
    tlKey: null,
    vaultKey: null,
    init() {
      $('timeline').addEventListener('click', (e) => {
        const b = e.target.closest('[data-buy]');
        if (b) buyItem(b.dataset.buy, b);
      });
      $('btn-nixon').addEventListener('click', showNixonPreview);
      this.renderFiatPreview();
    },
    render() {
      const s = G.state, d = G.d;
      setText($('mint-rate'), fmtUSD(d.dollarsPerOz));
      setHTML($('mint-formula'), `${rich(`$${d.price.toFixed(2)} [[mint-price|official price]] ÷ ${Math.round(d.cover * 100)}% [[gold-cover|gold cover]]`)}`);
      const rows = [
        ['Vault reserves', oz(s.run.reserves)],
        ['Dollars issued this era', fmtUSD(s.run.minted)],
        ['Dollars spent', fmtUSD(s.run.spent)],
        ['Crews', `${rate(d.siteRate)} oz/s → ${usdRate(d.dollarRate)}/s`],
        ['Your pace', `${rate(d.pace)} oz/s`],
        ['Official gold price', `$${d.price.toFixed(2)}/oz`],
      ];
      setHTML($('mint-stats'), rows.map(([k, v]) => `<div class="stat-line"><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join(''));
      this.renderTimeline();
      this.renderNixon();
    },
    renderTimeline() {
      const s = G.state;
      const next = E.nextCharter(s);
      const ni = next ? E.CHARTERS.indexOf(next) : E.CHARTERS.length;
      const st = next ? E.status(s, E.ITEM_BY_ID[next.id]) : '';
      const key = `${ni}|${st}|${next ? E.missing(s, E.ITEM_BY_ID[next.id]).join(';') : ''}|${s.settings.notation}`;
      if (key !== this.tlKey) {
        this.tlKey = key;
        const items = E.CHARTERS.map((c, i) => {
          const yr = Math.floor(c.year);
          if (i < ni) return `<li class="tl-item done"><span class="tl-year">${yr}</span><span class="tl-title">${esc(c.title)}</span>${A.uiIcon('check')}</li>`;
          if (i === ni) {
            const it = E.ITEM_BY_ID[c.id];
            const req = E.missing(s, it);
            const effects = E.charterEffects(c, G.d);
            return `<li class="tl-item next"><span class="tl-year">${yr}</span><div class="tl-body"><span class="tl-title">${esc(c.title)}</span>
              <p>${rich(c.text)}</p>${effects.length ? `<div class="tl-effects">${effects.map((e) => `<span>${esc(e)}</span>`).join('')}</div>` : ''}
              ${req.length ? `<ul class="scard-req">${req.map((r) => `<li>${A.uiIcon('lock')}<span>${esc(r)}</span></li>`).join('')}</ul>` : ''}
              <button type="button" class="btn${req.length ? '' : ' btn-primary'} tl-sign" data-buy="${c.id}"${req.length ? ' disabled' : ''}>${A.uiIcon('spark')}Sign · <span class="tl-cost">${esc(fmtUSD(c.cost))}</span></button></div></li>`;
          }
          if (i <= ni + 2) return `<li class="tl-item future"><span class="tl-year">${yr}</span><span class="tl-title">${esc(c.title)}</span></li>`;
          return '';
        }).join('');
        const more = E.CHARTERS.length - (ni + 3);
        $('timeline').innerHTML = items + (more > 0 ? `<li class="tl-item more"><span class="tl-year">…</span><span class="tl-title">${more} more until 1971</span></li>` : '');
      }
      const btn = $('timeline').querySelector('.tl-sign');
      if (btn && next) toggleClass(btn, 'can', !btn.disabled && s.dollars >= next.cost);
      setText($('history-count'), `${Math.min(ni, E.CHARTERS.length)} / ${E.CHARTERS.length}`);
    },
    renderNixon() {
      const s = G.state;
      const N = E.NIXON;
      const signed = !!s.run.charters[N.charter];
      const res = s.run.reserves;
      const ready = signed && res >= N.reserves;
      const c = E.CHARTER_BY_ID[N.charter];
      setText($('peg-price'), `$${G.d.price.toFixed(2)} / oz`);
      setText($('nixon-req'), signed ? `${fmt(N.reserves)} oz in the vault` : `${c.title} (${Math.floor(c.year)})`);
      setWidth($('nixon-fill'), Math.log10(res + 1) / Math.log10(N.reserves + 1));
      setText($('nixon-pct'), `${fmt(res, 1)} / ${fmt(N.reserves)} oz`);
      setText($('nixon-eta'), ready ? 'READY' : signed ? 'of the vault target' : 'charter not yet signed');
      const cred = N.credibility(res);
      setText($('nixon-cred'), cred ? `+${cred} CBC` : '+0');
      const vkey = String(ready);
      if (vkey !== this.vaultKey) {
        this.vaultKey = vkey;
        $('vault-door').innerHTML = A.vaultDoor(ready);
        $('window-tag').innerHTML = `${A.uiIcon(ready ? 'unlock' : 'lock')}${ready ? 'READY' : 'LOCKED'}`;
        const btn = $('btn-nixon');
        btn.disabled = !ready;
        btn.classList.toggle('ready', ready);
        btn.innerHTML = `${A.uiIcon(ready ? 'unlock' : 'lock')}Sever the gold peg`;
      }
    },
    renderFiatPreview() {
      const F = E.FIAT_PREVIEW;
      const node = (n, root) => `<div class="fnode${root ? ' root' : ''}" data-tip="term:${n.term}" tabindex="0" aria-label="${esc(n.name)} (locked)">
          ${A.fiatIcon(n.icon)}<span class="fnode-name">${esc(n.name)}</span><span class="fnode-sub">${esc(n.sub)}</span><span class="lockbadge">${A.uiIcon('lock')}</span></div>`;
      $('fiat-tree').innerHTML = `<div class="tree-root">${node(F.root, true)}</div>
        <div class="tree-branches">${F.branches.map((b) => `<div class="branch"><div class="branch-label">${esc(b.label)}</div>${b.nodes.map((n) => node(n)).join('')}</div>`).join('')}</div>`;
      const inst = {
        cpi: '<path d="M14 26a26 26 0 0 1 52 0" fill="none" stroke="currentColor" stroke-width="3" opacity=".35"/><path d="M14 26a26 26 0 0 1 34-24.7" fill="none" stroke="currentColor" stroke-width="3"/><line x1="40" y1="26" x2="56" y2="10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="40" cy="26" r="3" fill="currentColor"/>',
        rate: '<line x1="8" y1="16" x2="72" y2="16" stroke="currentColor" stroke-width="2" opacity=".4"/><line x1="8" y1="16" x2="46" y2="16" stroke="currentColor" stroke-width="3"/>' + [8, 24, 40, 56, 72].map((x) => `<line x1="${x}" y1="22" x2="${x}" y2="26" stroke="currentColor" opacity=".5"/>`).join('') + '<circle cx="46" cy="16" r="6" fill="#06120f" stroke="currentColor" stroke-width="2"/>',
        vel: '<path d="M4 22C14 22 16 8 26 8S36 24 46 20S58 6 66 10S74 16 78 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="4" y1="27" x2="78" y2="27" stroke="currentColor" opacity=".3"/>',
      };
      $('fiat-instruments').innerHTML = F.instruments.map((i) => `<div class="inst" data-tip="term:${i.term}" tabindex="0"><svg viewBox="0 0 80 30" aria-hidden="true">${inst[i.id] || ''}</svg><span>${esc(i.name.toUpperCase())}</span></div>`).join('');
    },
  };

  /* ------------------------------------------------------------------------
   * Wire ticker
   * --------------------------------------------------------------------- */
  const Ticker = {
    track: null,
    offset: 0,
    speed: 46,
    queue: [],
    lastHeadline: -1,
    count: 0,
    init() {
      this.track = $('ticker-track');
      this.track.innerHTML = '';
      this.offset = 0;
      for (let i = 0; i < 12; i++) this.append();
    },
    breaking(c) {
      this.queue.push(`<span class="tk breaking"><b>BREAKING</b>${esc(Math.floor(c.year))}: ${esc(c.title.toUpperCase())}</span>`);
    },
    item(i) {
      const s = G.state, d = G.d;
      const kind = i % 6;
      if (this.queue.length && kind % 2 === 0) return this.queue.shift();
      if (kind === 0) return `<span class="tk">GOLD/USD <b data-live="price"></b> <span class="muted">OFFICIAL</span></span>`;
      if (kind === 1) return `<span class="tk">TREASURY RESERVES <b data-live="reserves"></b> <span data-live="delta"></span></span>`;
      if (kind === 2 || kind === 4) {
        const pool = E.HEADLINES.map((h, idx) => [h, idx]).filter(([h]) => d.year >= h[0] && d.year <= h[1]);
        if (pool.length) {
          let pick = pool[Math.floor(Math.random() * pool.length)];
          if (pick[1] === this.lastHeadline && pool.length > 1) pick = pool[(pool.indexOf(pick) + 1) % pool.length];
          this.lastHeadline = pick[1];
          return `<span class="tk news"><b>${E.dateLabel(d.year)}</b> ${esc(pick[0][2])}</span>`;
        }
      }
      if (kind === 3) return `<span class="tk">MINT ISSUES <b data-live="mint"></b> <span class="muted">PER OZ</span></span>`;
      const owned = E.BUILDINGS.filter((b) => s.run.buildings[b.id] > 0);
      if (owned.length) {
        const b = owned[Math.floor(Math.random() * owned.length)];
        return `<span class="tk">${esc(b.name.toUpperCase())} <b>×${s.run.buildings[b.id]}</b> <span class="muted">${rate(d.buildingRate[b.id])} OZ/S</span></span>`;
      }
      return `<span class="tk">ASSAY OFFICE <b>OPEN</b> <span class="muted">DUST BOUGHT AT $${d.price.toFixed(2)}/OZ</span></span>`;
    },
    append() {
      this.track.insertAdjacentHTML('beforeend', this.item(this.count++));
      const el = this.track.lastElementChild;
      this.refreshLive(el);
      el._width = el.offsetWidth; // measured once; live quotes barely change width
    },
    /** Market quotes in the tape stay live while they scroll past. */
    refreshLive(scope = this.track) {
      if (!scope) return;
      const s = G.state, d = G.d;
      const delta = Spark.change();
      const values = {
        price: `$${d.price.toFixed(2)}`,
        reserves: `${fmt(s.run.reserves, 1)} OZ`,
        delta: delta == null ? '' : `${delta >= 0 ? '▲' : '▼'}${Math.abs(delta * 100).toFixed(2)}%`,
        mint: fmtUSD(d.dollarsPerOz),
      };
      scope.querySelectorAll('[data-live]').forEach((el) => {
        const key = el.dataset.live;
        setText(el, values[key]);
        if (key === 'delta') el.className = delta == null ? '' : delta >= 0 ? 'up' : 'down';
      });
    },
    update(dt) {
      if (!this.track || !dt || reducedMotion()) return;
      this.offset -= this.speed * dt;
      const first = this.track.firstElementChild;
      if (first) {
        const w = first._width || first.offsetWidth;
        if (this.offset + w < 0) {
          this.offset += w;
          first.remove();
          this.append();
        }
      }
      this.track.style.transform = `translate3d(${this.offset.toFixed(1)}px,0,0)`;
    },
  };

  /* ------------------------------------------------------------------------
   * Tooltips: one floating element, content providers keyed by data-tip.
   * --------------------------------------------------------------------- */
  const TEXT_TIPS = {
    date: () => ['Historical date', 'History moves forward only when you sign a charter (Upgrades → History, or the Treasury page). It runs from Sutter\'s Mill (1848) to the closing of the gold window (1971).'],
    dollars: () => ['Dollars', 'Cash to spend on upgrades, permits, crews and charters. The Mint issues dollars for every ounce that goes into the Treasury vault.'],
    reserves: () => ['Vault reserves', 'All the gold you have mined this era. It stays in the vault as reserves that back the dollar; charters need a minimum amount in the vault.'],
    mint: () => {
      const d = G.d;
      return ['The Mint pays', `Dollars issued per ounce: the [[mint-price|official price]] ($${d.price.toFixed(2)}) divided by the [[gold-cover|gold cover]] (${Math.round(d.cover * 100)}%). The Federal Reserve Act, the Gold Reserve Act and the 1945 cover cut each raise it.`];
    },
    crews: () => {
      const d = G.d;
      return ['Crews', `Crews mine ${E.pct(d.paceShare)} of your pace (${rate(d.pace)} oz/s) between shifts, even while the game is closed. Each site's crews approach that site's limit with [[diminishing-returns|diminishing returns]].`];
    },
    industry: () => ['Industrial index', 'How heavily industrialized your territory has become, weighted by site type and tier. The smog thickens and the stars fade as it rises.'],
    codex: () => ['Economics codex', 'Every real-world term in the game, with definitions. Terms you have studied are marked.'],
    stats: () => ['Statistics', 'Lifetime records for this save.'],
    sound: () => ['Sound', G.state.settings.sound ? 'Sound effects are on.' : 'Sound effects are off.'],
    settings: () => ['Settings & saves', 'Number format, motion, sound, and export/import of your save.'],
    stat: (el) => [el.querySelector('dt').textContent, el.dataset.tipText || ''],
  };

  function markStudied(id) {
    if (E.GLOSSARY[id] && !G.state.codex[id]) G.state.codex[id] = true;
  }

  function glossFooter(text) {
    const ids = E.termsIn(text).filter((id) => E.GLOSSARY[id]);
    if (!ids.length) return '';
    ids.forEach(markStudied);
    return `<div class="tt-gloss">${ids.map((id) => `<div><b>${esc(E.GLOSSARY[id].title)}</b>: ${esc(firstSentence(E.GLOSSARY[id].body))}</div>`).join('')}</div>`;
  }

  const TIPS = {
    term(id) {
      const t = E.GLOSSARY[id];
      if (!t) return '';
      markStudied(id);
      return `<div class="tt-head"><span class="tt-title">${esc(t.title)}</span><span class="tt-tag${t.era === 'fiat' ? ' fiat' : ''}">${t.era === 'fiat' ? 'FIAT ERA · LOCKED' : 'ECONOMICS'}</span></div>
        <div class="tt-body">${esc(t.body)}</div>${t.game ? `<div class="tt-game">${esc(t.game)}</div>` : ''}`;
    },
    site(id) {
      const def = E.BUILDING_BY_ID[id];
      const s = G.state, d = G.d;
      const owned = s.run.buildings[id];
      const tier = d.tiers[id];
      const permit = E.hasPermit(s, id);
      const ch = E.CHARTER_BY_ID[def.permitCharter];
      const nextTier = tier < 5 ? E.ITEM_BY_ID[`${id}-${tier + 1}`] : null;
      let stats;
      if (!s.run.charters[def.permitCharter]) stats = `<div class="tt-foot">Opens with the charter <b>${esc(ch.title)}</b> (${Math.floor(ch.year)}).</div>`;
      else if (!permit) stats = `<div class="tt-foot">Buy the permit (here or in Upgrades → Sites) to hire crews.</div>`;
      else {
        const q = E.purchaseQuote(s, def, s.settings.buyAmount);
        stats = `<dl class="tt-stats">
          <dt>Crews</dt><dd>${fmt(owned)}</dd>
          <dt>Mining</dt><dd>${E.pct(d.buildingShare[id])} of pace · ${rate(d.buildingRate[id])} oz/s</dd>
          <dt>Site limit</dt><dd>${E.pct(d.limit[id])} of pace</dd>
          <dt>Next crew</dt><dd>+${E.pct(d.nextShare[id])} · ${usdRate(d.nextRate[id] * d.dollarsPerOz)}/s</dd>
          <dt>Hire ×${q.n}${q.isMax ? ' (max)' : ''}</dt><dd>${fmtUSD(q.cost)}</dd>
          ${nextTier ? `<dt>Next tier</dt><dd>${esc(nextTier.name)} · ${nextTier.requires.owned} crews</dd>` : ''}
        </dl>`;
      }
      return `<div class="tt-head"><span class="tt-title">${esc(def.name)}</span><span class="tt-tag">${tier ? `TIER ${ROMAN[tier]}` : 'BASE'}</span></div>
        <span class="tt-chip">${esc(def.tiers[tier].toUpperCase())}</span>
        <div class="tt-body">${rich(def.desc, false)}</div>
        <div class="tt-quote">${esc(def.quote)}</div>${stats}${glossFooter(def.desc)}`;
    },
    map(id) {
      const m = E.MAP_BY_ID[id];
      if (!m) return '';
      const body = `${m.desc} [[${m.term}|Learn more]].`;
      return `<div class="tt-head"><span class="tt-title">${esc(m.name)}</span><span class="tt-tag">${esc(m.place)}</span></div>
        <div class="tt-body">${rich(body, false)}</div>
        <dl class="tt-stats"><dt>Rock strength</dt><dd>×${m.hp}</dd><dt>Gold per rock</dt><dd>×${m.gold}</dd></dl>${glossFooter(body)}`;
    },
    text(key, el) {
      const fn = TEXT_TIPS[key];
      if (!fn) return '';
      const [title, body] = fn(el);
      return `<div class="tt-head"><span class="tt-title">${esc(title)}</span></div><div class="tt-body">${rich(body, false)}</div>${glossFooter(body)}`;
    },
  };

  const Tip = {
    el: null,
    target: null,
    sticky: false,
    press: null,        // an in-progress touch on a [data-tip] element
    longFired: false,   // the last touch became a long-press: swallow its click
    LONG_MS: 450,
    SLOP: 10,
    init() {
      this.el = $('tooltip');
      const focusVisible = (el) => { try { return el.matches(':focus-visible'); } catch (_) { return true; } };

      // Mouse and pen: hover.
      document.addEventListener('pointerover', (e) => {
        if (e.pointerType === 'touch') return;
        const t = e.target.closest('[data-tip]');
        if (t && t !== this.target) this.show(t);
        else if (!t && this.target && !this.sticky) this.hide();
      });
      document.addEventListener('pointerout', (e) => {
        if (!this.target || this.sticky || e.pointerType === 'touch') return;
        const to = e.relatedTarget;
        if (to && this.target.contains(to)) return;
        if (!to || !to.closest || !to.closest('[data-tip]')) this.hide();
      });

      // Touch: there is no hover. A tap on plain text (terms, stats) opens its tooltip; buttons
      // keep their tap action, and a long-press on one opens the tooltip instead.
      document.addEventListener('pointerdown', (e) => {
        this.longFired = false;
        if (e.pointerType !== 'touch') return;
        const t = e.target.closest('[data-tip]');
        if (!t) { if (!this.el.contains(e.target)) this.hide(); return; }
        this.cancelPress();
        const press = { t, id: e.pointerId, x: e.clientX, y: e.clientY, timer: null };
        if (t.matches('button')) {
          press.timer = setTimeout(() => {
            if (this.press !== press) return;
            this.press = null;
            this.longFired = true;
            this.show(t, true);
          }, this.LONG_MS);
        }
        this.press = press;
      });
      document.addEventListener('pointermove', (e) => {
        const p = this.press;
        if (p && e.pointerId === p.id && Math.hypot(e.clientX - p.x, e.clientY - p.y) > this.SLOP) this.cancelPress();
      });
      document.addEventListener('pointerup', (e) => {
        const p = this.press;
        if (!p || e.pointerId !== p.id) return;
        this.cancelPress();
        if (p.t.matches('button') || !p.t.contains(e.target)) return;
        if (this.sticky && this.target === p.t) this.hide(); else this.show(p.t, true);
      });
      // A scroll gesture cancels the pointer, so panning the page never opens a tooltip.
      document.addEventListener('pointercancel', () => this.cancelPress());
      document.addEventListener('click', (e) => {
        if (!this.longFired) return;
        this.longFired = false;
        if (e.target.closest('[data-tip]')) { e.preventDefault(); e.stopPropagation(); }
      }, true);
      document.addEventListener('contextmenu', (e) => {
        const onTip = e.target.closest && e.target.closest('[data-tip]');
        if (this.longFired || (onTip && matchMedia('(pointer: coarse)').matches)) e.preventDefault();
      });

      // Keyboard: only a visible focus ring opens one, so tapping a button never pops a tooltip.
      document.addEventListener('focusin', (e) => {
        const t = e.target.closest && e.target.closest('[data-tip]');
        if (t && focusVisible(e.target)) this.show(t);
      });
      document.addEventListener('focusout', (e) => {
        // Touch sheets are sticky: a long-press can blur its button, which must not close the sheet.
        if (this.target && !this.sticky && e.target.closest && e.target.closest('[data-tip]') === this.target) this.hide();
      });
      document.addEventListener('scroll', (e) => {
        if (this.target && !this.el.contains(e.target)) this.hide();
      }, true);
      // Phone browsers fire resize when their toolbars slide in and out; only a width change matters.
      let lastW = window.innerWidth;
      window.addEventListener('resize', () => { if (window.innerWidth !== lastW) { lastW = window.innerWidth; this.hide(); } });
    },
    cancelPress() {
      if (!this.press) return;
      clearTimeout(this.press.timer);
      this.press = null;
    },
    content() {
      const spec = this.target.dataset.tip || '';
      const i = spec.indexOf(':');
      const kind = spec.slice(0, i), id = spec.slice(i + 1);
      return TIPS[kind] ? TIPS[kind](id, this.target) : '';
    },
    show(target, sticky = false) {
      this.target = target;
      this.sticky = sticky;
      const html = this.content();
      if (!html) { this.hide(); return; }
      setHTML(this.el, html);
      this.el.classList.add('show');
      toggleClass(this.el, 'sticky', sticky);
      this.position();
    },
    hide() {
      this.target = null;
      this.sticky = false;
      this.el.classList.remove('show', 'sticky');
    },
    refresh() {
      if (!this.target) return;
      if (!document.contains(this.target) || this.target.closest('[hidden]')) { this.hide(); return; }
      const before = this.el._h;
      setHTML(this.el, this.content());
      if (this.el._h !== before) this.position();
    },
    position() {
      // On a phone the tooltip becomes a bottom sheet; CSS places it.
      const sheet = window.innerWidth <= 600 && matchMedia('(pointer: coarse)').matches;
      toggleClass(this.el, 'sheet', sheet);
      if (sheet) { this.el.style.transform = ''; return; }
      const t = this.target.getBoundingClientRect();
      const w = this.el.offsetWidth, h = this.el.offsetHeight;
      const vw = window.innerWidth, vh = window.innerHeight, m = 8;
      let x, y;
      if (this.target.dataset.tipPos === 'side' && vw > 760) {
        x = t.right + 10;
        if (x + w > vw - m) x = t.left - 10 - w;
        y = t.top;
      } else {
        x = t.left + t.width / 2 - w / 2;
        y = t.bottom + 8;
        if (y + h > vh - m) y = t.top - 8 - h;
      }
      x = clamp(x, m, Math.max(m, vw - w - m));
      y = clamp(y, m, Math.max(m, vh - h - m));
      this.el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    },
  };

  /* ------------------------------------------------------------------------
   * Toasts & modals
   * --------------------------------------------------------------------- */
  function toast({ kicker = '', title = '', text = '', icon = '', year = null, timeout = 6500 }) {
    const box = $('toasts');
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = `<div class="toast-ico${year ? ' year' : ''}">${year ? esc(year) : icon || A.uiIcon('spark')}</div>
      <div><div class="toast-kicker">${esc(kicker)}</div><div class="toast-title">${esc(title)}</div>${text ? `<div class="toast-text">${rich(text)}</div>` : ''}</div>`;
    let gone = false;
    const dismiss = () => {
      if (gone) return;
      gone = true;
      el.classList.add('out');
      setTimeout(() => el.remove(), 300);
    };
    el.addEventListener('click', (e) => { if (!e.target.closest('.term')) dismiss(); });
    box.appendChild(el);
    const small = phone(); // keep the stack from covering the screen
    while (box.children.length > (small ? 1 : 4)) box.firstElementChild.remove();
    setTimeout(dismiss, small ? Math.min(timeout, 3500) : timeout);
  }

  const Modal = {
    backdrop: null,
    box: null,
    lastFocus: null,
    dismissible: true,
    onClose: null,
    init() {
      this.backdrop = $('modal-backdrop');
      this.box = $('modal');
      this.backdrop.addEventListener('click', (e) => { if (e.target === this.backdrop && this.dismissible) this.close(); });
      document.addEventListener('keydown', (e) => {
        if (!this.isOpen) return;
        if (e.key === 'Escape' && this.dismissible) { e.preventDefault(); this.close(); }
        if (e.key === 'Tab') {
          const f = [...this.box.querySelectorAll('button, [href], input, textarea, [tabindex]:not([tabindex="-1"])')].filter((el) => !el.disabled && !el.hidden && el.offsetParent !== null);
          if (!f.length) return;
          const first = f[0], last = f[f.length - 1];
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
      });
    },
    get isOpen() { return !this.backdrop.hidden; },
    open(o) {
      if (!this.isOpen) this.lastFocus = document.activeElement;
      this.dismissible = o.dismissible !== false;
      this.onClose = o.onClose || null;
      const actions = o.actions || [{ label: 'Close', primary: true }];
      this.box.className = `modal${o.wide ? ' wide' : ''}`;
      this.box.innerHTML = `${this.dismissible ? `<button class="icon-btn modal-close" type="button" aria-label="Close">${A.uiIcon('close')}</button>` : ''}
        ${o.kicker ? `<div class="modal-kicker">${esc(o.kicker)}</div>` : ''}
        <h3 id="modal-title">${esc(o.title)}</h3>
        <div class="modal-body">${o.body || ''}</div>
        ${actions.length ? `<div class="modal-actions">${actions.map((a, i) => `<button type="button" class="btn${a.primary ? ' btn-primary' : ''}${a.danger ? ' btn-danger' : ''}" data-i="${i}">${esc(a.label)}</button>`).join('')}</div>` : ''}`;
      this.box.querySelectorAll('.modal-actions .btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const a = actions[Number(btn.dataset.i)];
          const keepOpen = a.onClick ? a.onClick(this.box) === false : false;
          if (!keepOpen) this.close();
        });
      });
      const x = this.box.querySelector('.modal-close');
      if (x) x.addEventListener('click', () => this.close());
      this.backdrop.hidden = false;
      Tip.hide();
      if (Mine.phase === 'running') Mine.pause();
      if (o.onOpen) o.onOpen(this.box);
      const focusEl = this.box.querySelector('[autofocus]') || this.box.querySelector('.modal-actions .btn-primary') || this.box.querySelector('.modal-actions .btn') || x;
      if (focusEl) focusEl.focus();
    },
    close() {
      if (!this.isOpen) return;
      this.backdrop.hidden = true;
      this.box.innerHTML = '';
      const cb = this.onClose;
      this.onClose = null;
      if (cb) cb();
      if (this.lastFocus && document.contains(this.lastFocus) && this.lastFocus.focus) this.lastFocus.focus();
    },
  };

  /* ------------------------------------------------------------------------
   * Sparkline: vault reserves over the last two minutes (single series).
   * --------------------------------------------------------------------- */
  const Spark = {
    data: [],
    W: 300,
    H: 64,
    hover: -1,
    init() {
      const wrap = $('spark-wrap');
      const measure = () => { this.W = Math.max(120, Math.round(wrap.clientWidth)); this.draw(); };
      if (window.ResizeObserver) new ResizeObserver(measure).observe(wrap);
      measure();
      wrap.addEventListener('pointermove', (e) => {
        if (this.data.length < 2) return;
        const r = wrap.getBoundingClientRect();
        const step = this.W / SPARK_POINTS;
        const fromRight = Math.round((r.right - e.clientX) / step);
        this.hover = clamp(this.data.length - 1 - fromRight, 0, this.data.length - 1);
        this.draw();
      });
      wrap.addEventListener('pointerleave', () => { this.hover = -1; this.draw(); });
    },
    reset() { this.data = []; this.sample(); },
    /** Fractional change in reserves across the window, or null if undefined. */
    change() {
      const n = this.data.length;
      if (n < 2 || !(this.data[0].v > 0)) return null;
      return (this.data[n - 1].v - this.data[0].v) / this.data[0].v;
    },
    sample() {
      this.data.push({ t: Date.now(), v: G.state.run.reserves });
      if (this.data.length > SPARK_POINTS + 1) this.data.shift();
      if (Pages.current === 'treasury') this.draw();
    },
    draw() {
      const svg = $('sparkline');
      const { W, H } = this;
      svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
      const n = this.data.length;
      const readout = $('spark-readout');
      if (n < 2) {
        svg.innerHTML = `<line class="spark-base" x1="0" y1="${H - 0.5}" x2="${W}" y2="${H - 0.5}"/>`;
        readout.hidden = true;
        setText($('spark-delta'), '—');
        return;
      }
      const vs = this.data.map((p) => p.v);
      let min = Math.min(...vs), max = Math.max(...vs);
      if (max - min < 1e-9) { min -= 1; max += 1; }
      const pad = 7;
      const step = W / SPARK_POINTS;
      const x = (i) => W - (n - 1 - i) * step;
      const y = (v) => pad + (1 - (v - min) / (max - min)) * (H - pad * 2);
      let line = '';
      this.data.forEach((p, i) => { line += `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.v).toFixed(1)}`; });
      const area = `${line}L${x(n - 1).toFixed(1)} ${H}L${x(0).toFixed(1)} ${H}Z`;
      const lastY = y(vs[n - 1]);
      let hover = '';
      if (this.hover >= 0 && this.hover < n) {
        const hx = x(this.hover);
        hover = `<line class="spark-cross" x1="${hx.toFixed(1)}" y1="0" x2="${hx.toFixed(1)}" y2="${H}"/><circle class="spark-dot" cx="${hx.toFixed(1)}" cy="${y(vs[this.hover]).toFixed(1)}" r="4"/>`;
        const ago = Math.round((this.data[n - 1].t - this.data[this.hover].t) / 1000);
        readout.innerHTML = `<b>${esc(fmt(vs[this.hover], 1))} oz</b><span>${ago ? `−${ago}s` : 'now'}</span>`;
        readout.style.left = `${clamp(hx, 50, W - 50)}px`;
        readout.hidden = false;
      } else {
        readout.hidden = true;
      }
      svg.innerHTML = `<path class="spark-area" d="${area}"/><line class="spark-base" x1="0" y1="${H - 0.5}" x2="${W}" y2="${H - 0.5}"/>
        <path class="spark-line" d="${line}"/>${hover}<circle class="spark-dot" cx="${x(n - 1).toFixed(1)}" cy="${lastY.toFixed(1)}" r="4"/>`;
      const first = vs[0], last = vs[n - 1];
      const el = $('spark-delta');
      if (first > 0) {
        const change = (last - first) / first;
        setText(el, `${change >= 0 ? '▲' : '▼'} ${Math.abs(change * 100).toFixed(1)}%`);
        el.className = `delta ${change >= 0 ? 'up' : 'down'}`;
      } else {
        setText(el, last > 0 ? '▲ new' : '—');
        el.className = `delta ${last > 0 ? 'up' : ''}`;
      }
      setText($('spark-range'), `${fmt(min < 0 ? 0 : min, 1)} – ${fmt(max, 1)} oz`);
    },
  };

  /* ------------------------------------------------------------------------
   * View layer: shared chrome (KPIs, badges, log, status bar)
   * --------------------------------------------------------------------- */
  const View = {
    logDirty: true,
    lastLogTop: null,

    init() {
      if ('IntersectionObserver' in window) {
        new IntersectionObserver(([en]) => document.body.classList.toggle('scrolled', !en.isIntersecting)).observe(document.querySelector('.topbar'));
      }
      $('emblem').innerHTML = A.emblem();
      $('btn-codex').innerHTML = A.uiIcon('book');
      $('btn-stats').innerHTML = A.uiIcon('chart');
      $('btn-settings').innerHTML = A.uiIcon('gear');
      this.renderSoundButton();
      $('btn-codex').addEventListener('click', showCodex);
      $('btn-stats').addEventListener('click', showStats);
      $('btn-settings').addEventListener('click', showSettings);
      $('btn-sound').addEventListener('click', () => {
        G.state.settings.sound = !G.state.settings.sound;
        this.renderSoundButton();
        if (G.state.settings.sound) Sound.buy();
        Tip.refresh();
      });
    },

    resetAll() {
      this.logDirty = true;
      document.querySelectorAll('[id]').forEach((el) => { delete el._v; delete el._h; delete el._w; delete el._key; });
      Shop.key = null;
      Shop.syncControls();
      Sites.reset();
      Sites.syncSeg();
      Treasury.tlKey = Treasury.vaultKey = null;
      Mine.mapsKey = null;
      Mine.phase = 'ready';
      Mine.report = null;
      Mine.view.abort();
      Mine.view.shift = null;
      Mine.renderOverlay();
      this.renderSoundButton();
      Pages.show(G.state.settings.tab, { scroll: false });
      this.slow();
    },

    renderSoundButton() {
      const on = G.state && G.state.settings.sound;
      const btn = $('btn-sound');
      btn.innerHTML = A.uiIcon(on ? 'sound' : 'mute');
      btn.classList.toggle('on', !!on);
      btn.setAttribute('aria-pressed', String(!!on));
    },

    /* ---- per-frame: cheap text updates ---- */
    frame() {
      const s = G.state, d = G.d;
      setText($('kpi-dollars'), fmtUSD(s.dollars));
      setText($('kpi-reserves'), oz(s.run.reserves));
      setText($('mini-dollars'), fmtUSD(s.dollars));
      setText($('mini-reserves'), oz(s.run.reserves));
      setText($('kpi-crews'), `+${usdRate(d.dollarRate)}/s`);
    },

    /* ---- 5 Hz: structure, affordability, the visible page ---- */
    slow() {
      const s = G.state, d = G.d;
      setText($('kpi-date'), E.dateLabel(d.year));
      setText($('scene-date'), E.dateLabel(d.year));
      setText($('kpi-rate'), `${fmtUSD(d.dollarsPerOz)}/oz`);
      let place = PLACES[0][1];
      for (const [y, label] of PLACES) if (d.year >= y) place = label;
      setText($('territory-loc'), place);

      // tab badges
      const ready = Shop.affordableCount();
      const bu = $('badge-upgrades');
      bu.hidden = !ready;
      setText(bu, ready > 9 ? '9+' : String(ready));
      const idle = E.BUILDINGS.filter((b) => E.hasPermit(s, b.id) && s.run.buildings[b.id] === 0).length;
      const bt = $('badge-territory');
      bt.hidden = !idle;
      setText(bt, String(idle));
      const next = E.nextCharter(s);
      const bt2 = $('badge-treasury');
      const sign = next && E.status(s, E.ITEM_BY_ID[next.id]) === 'available' && s.dollars >= next.cost;
      bt2.hidden = !sign;
      setText(bt2, '!');

      Mine.statsChanged();
      Mine.renderMaps();
      if (Pages.current === 'mine') {
        Mine.renderStats();
        Shop.renderQuick();
        if (this.logDirty) this.renderLog();
      } else if (Pages.current === 'upgrades') Shop.render();
      else if (Pages.current === 'territory') Sites.render();
      else if (Pages.current === 'treasury') { Treasury.render(); Spark.draw(); }
      Ticker.refreshLive();

      // status bar
      const toSave = Math.max(0, Math.ceil((G.nextSave - Date.now()) / 1000));
      const sb = $('sb-save');
      if (!sb.classList.contains('saved') && !sb.classList.contains('error')) setText(sb, G.conflict ? 'AUTOSAVE PAUSED (OTHER TAB)' : `AUTOSAVE IN ${toSave}s`);
      setText($('sb-session'), `SESSION ${fmtClock((Date.now() - G.sessionStart) / 1000)}`);
      setText($('sb-lifetime'), `LIFETIME ${fmt(s.stats.lifetimeGold, 1)} OZ`);
      Tip.refresh();
    },

    renderLog() {
      this.logDirty = false;
      const log = G.state.log;
      const list = $('log');
      const newest = log.length ? log[log.length - 1] : null;
      list.innerHTML = log.slice().reverse().map((e, i) => `<li class="${i === 0 && e !== this.lastLogTop ? 'fresh' : ''}"><span class="yr">${esc(e.y)}</span><span class="txt"><b>${esc(e.title)}.</b> ${rich(e.text)}</span></li>`).join('');
      this.lastLogTop = newest;
      setText($('log-count'), `${log.length}`);
    },

    flashKPI(id) {
      restartAnim($(id), 'flash');
    },

    saveFlash(ok, manual) {
      const sb = $('sb-save');
      sb.classList.remove('saved', 'error');
      setText(sb, ok ? 'SAVED ✓' : 'SAVE FAILED');
      sb.classList.add(ok ? 'saved' : 'error');
      clearTimeout(this._saveT);
      this._saveT = setTimeout(() => sb.classList.remove('saved', 'error'), ok ? 1400 : 4000);
      if (manual) toast(ok ? { kicker: 'LEDGER', title: 'Game saved', text: 'Progress written to this browser.', icon: A.uiIcon('disk'), timeout: 2500 } : { kicker: 'LEDGER', title: 'Save failed', text: 'This browser blocked local storage. Use Export in Settings to keep a copy.', icon: A.uiIcon('info') });
    },
  };

  /* ------------------------------------------------------------------------
   * Screens: intro, away summary, settings, stats, codex, Nixon preview
   * --------------------------------------------------------------------- */
  function showIntro() {
    const fromV1 = G.state.flags.fromV1;
    Modal.open({
      kicker: fromV1 ? 'NEW VERSION · YOUR OLD SAVE IS ARCHIVED' : 'MISSION BRIEFING · JANUARY 24, 1848',
      title: "Gold at Sutter's Mill",
      body: `${fromV1 ? '<p class="note">The game has been rebuilt around mining shifts, so this is a fresh start. Your settings and studied terms carried over, and the old save is kept in this browser.</p>' : ''}
        <p>A carpenter has spotted flakes of gold in the American River. The young United States will build its money on what comes out of the ground.</p>
        <ul class="brief">
          <li>${A.uiIcon('pick')}<span><b>Mine in shifts.</b> Tap or hold on the rock face. Your pick hits every rock inside its ring${matchMedia('(pointer: coarse)').matches ? ', and on a touchscreen it floats just above your finger so you can see the rock break' : ''}.</span></li>
          <li>${A.uiIcon('coin')}<span><b>The Mint pays.</b> Gold goes into the Treasury vault, and the Mint issues dollars for it at the <span class="term" data-tip="term:mint-price" tabindex="0">official price</span>, $20.67 an ounce.</span></li>
          <li>${A.uiIcon('spark')}<span><b>Upgrade.</b> A bigger, stronger, faster pick; longer shifts; dynamite. Every card says exactly what it does.</span></li>
          <li>${A.uiIcon('book')}<span><b>Make history.</b> Sign charters to move from 1848 toward 1971. Nothing unlocks by waiting.</span></li>
          <li>${A.uiIcon('chart')}<span><b>Hire crews.</b> Buy a permit to open a site; its crews mine a share of your pace between shifts, even offline.</span></li>
        </ul>
        <p class="muted">Tap any <span class="term" data-tip="term:specie" tabindex="0">underlined term</span> to learn the real economics behind it.</p>`,
      actions: [{ label: 'Start mining', primary: true }],
      onClose: () => { G.state.flags.introSeen = true; G.state.flags.fromV1 = false; save(); },
    });
  }

  function showWelcomeBack(sum) {
    Modal.open({
      kicker: 'WHILE YOU WERE AWAY',
      title: `${fmtTime(sum.seconds)} away`,
      body: sum.gold > 0
        ? `<div class="big-figure">+${esc(oz(sum.gold))}</div>
          <p>Your crews kept mining at ${esc(rate(sum.rate))} oz/s, and the Mint paid <b>${esc(fmtUSD(sum.dollars))}</b> for it${sum.capped ? ' (time away is capped at 30 days)' : ''}.</p>`
        : '<p>Nothing was mined while you were away. Buy a permit and hire crews (Territory) to keep gold coming in between sessions.</p>',
      actions: [{ label: 'Back to work', primary: true }],
    });
  }

  function onVisibility() {
    if (document.hidden) {
      catchUp();
      if (Mine.phase === 'running') Mine.pause();
      G.away = { at: Date.now(), reserves: G.state.run.reserves, dollars: G.state.dollars, rate: G.d ? G.d.siteRate : 0 };
      save();
      return;
    }
    catchUp();
    refresh();
    const away = G.away;
    G.away = null;
    G.lastFrame = 0;
    if (!away) return;
    const seconds = (Date.now() - away.at) / 1000;
    if (seconds >= AWAY_NOTICE_S && !Modal.isOpen) {
      showWelcomeBack({ seconds, capped: false, gold: G.state.run.reserves - away.reserves, dollars: G.state.dollars - away.dollars, rate: away.rate });
    }
  }

  function applySettings() {
    const st = G.state.settings;
    E.setNotation(st.notation);
    document.body.classList.toggle('reduce-motion', st.motion === 'reduced');
    document.body.dataset.era = G.state.era;
    if (Mine.view) { Mine.view.setReduced(reducedMotion()); Mine.view.refreshTheme(); }
    Debug.sync();
  }

  function showSettings() {
    const st = G.state.settings;
    const opt = (key, val, label) => `<button type="button" class="btn" data-set="${key}" data-val="${val}" aria-pressed="${String(st[key]) === val}">${label}</button>`;
    Modal.open({
      kicker: 'TERMINAL CONFIGURATION',
      title: 'Settings & saves',
      body: `<div class="field"><span class="field-label">Number format</span><div class="opt-row">${opt('notation', 'suffix', '1.23M · 4.56T')}${opt('notation', 'scientific', '1.23e6 · 4.56e12')}</div></div>
        <div class="field"><span class="field-label">Motion</span><div class="opt-row">${opt('motion', 'full', 'Full animation')}${opt('motion', 'reduced', 'Reduced motion')}</div></div>
        <div class="field"><span class="field-label">Sound</span><div class="opt-row">${opt('sound', 'true', 'On')}${opt('sound', 'false', 'Off')}</div></div>
        <div class="field"><span class="field-label">Developer tools</span><div class="opt-row">${opt('debug', 'true', 'On')}${opt('debug', 'false', 'Off')}</div><p class="muted" style="margin:0;font-size:12px">Adds a panel for testing: add dollars or gold, sign the next charter, hire crews, skip ahead in time.</p></div>
        <div class="field"><span class="field-label">Save data</span>
          <p class="muted" style="margin:0">Autosaves to this browser every 10 seconds, and when you leave. Last saved ${esc(new Date(G.state.savedAt).toLocaleTimeString())}.</p>
          <div class="opt-row"><button type="button" class="btn" id="set-save">${A.uiIcon('disk')}Save now</button><button type="button" class="btn" id="set-export">${A.uiIcon('upload')}Export</button><button type="button" class="btn" id="set-import">${A.uiIcon('download')}Import</button></div>
          <textarea id="set-io" hidden spellcheck="false" aria-label="Save string"></textarea>
          <div class="opt-row" id="set-io-actions" hidden></div>
        </div>
        <div class="field"><span class="field-label">Danger zone</span><div class="opt-row"><button type="button" class="btn btn-danger" id="set-reset">${A.uiIcon('trash')}Hard reset</button></div></div>`,
      actions: [{ label: 'Done', primary: true }],
      onOpen: (box) => {
        box.querySelectorAll('[data-set]').forEach((b) => b.addEventListener('click', () => {
          const key = b.dataset.set;
          const val = key === 'sound' || key === 'debug' ? b.dataset.val === 'true' : b.dataset.val;
          st[key] = val;
          box.querySelectorAll(`[data-set="${key}"]`).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
          applySettings();
          if (key === 'notation') View.resetAll();
          if (key === 'sound') View.renderSoundButton();
          save();
        }));
        const io = box.querySelector('#set-io');
        const ioActions = box.querySelector('#set-io-actions');
        box.querySelector('#set-save').addEventListener('click', () => save(true));
        box.querySelector('#set-export').addEventListener('click', () => {
          save();
          io.hidden = false;
          io.readOnly = true;
          io.value = Store.exportString(G.state);
          io.select();
          ioActions.hidden = false;
          ioActions.innerHTML = '<button type="button" class="btn btn-primary" id="io-copy">Copy to clipboard</button>';
          ioActions.querySelector('#io-copy').addEventListener('click', async (e) => {
            try { await navigator.clipboard.writeText(io.value); } catch (_) { io.select(); document.execCommand('copy'); }
            e.target.textContent = 'Copied ✓';
          });
        });
        box.querySelector('#set-import').addEventListener('click', () => {
          io.hidden = false;
          io.readOnly = false;
          io.value = '';
          io.placeholder = 'Paste an exported save string (starts with FFC2:)';
          io.focus();
          ioActions.hidden = false;
          ioActions.innerHTML = '<button type="button" class="btn btn-primary" id="io-load">Load this save</button>';
          ioActions.querySelector('#io-load').addEventListener('click', () => {
            let parsed;
            try { parsed = Store.importString(io.value); } catch (err) {
              io.setCustomValidity('invalid');
              ioActions.insertAdjacentHTML('beforeend', '<span class="down" style="align-self:center;font-size:12px">That string is not a valid save.</span>');
              return;
            }
            const imported = E.migrate(parsed);
            imported.savedAt = Date.now(); // restore exactly what was exported, no offline credit
            loadState(imported);
            Modal.close();
            toast({ kicker: 'LEDGER', title: 'Save imported', text: imported.flags.fromV1 ? 'That was an old-version save, so a fresh era starts with its settings.' : 'Welcome back to your empire.', icon: A.uiIcon('download') });
          });
        });
        box.querySelector('#set-reset').addEventListener('click', confirmReset);
      },
    });
  }

  function confirmReset() {
    Modal.open({
      kicker: 'DANGER ZONE',
      title: 'Erase all progress?',
      body: '<p>This permanently deletes your save in this browser, including lifetime statistics. Export first if you might want it back.</p>',
      actions: [
        { label: 'Cancel' },
        { label: 'Erase everything', danger: true, onClick: () => { Store.clear(); loadState(E.createState()); setTimeout(showIntro, 50); } },
      ],
    });
  }

  /** Replace the running state (import / reset) and rebuild every view. */
  function loadState(state) {
    G.state = state;
    G.lastSim = Date.now();
    applySettings();
    refresh();
    if (!G.state.log.length) addLog("Sutter's Mill", plain(E.CHARTERS[0].text), 'milestone', 1848);
    View.resetAll();
    Ticker.init();
    Spark.reset();
    save();
  }

  function showStats() {
    const s = G.state, d = G.d;
    const crews = E.BUILDINGS.reduce((a, b) => a + s.run.buildings[b.id], 0);
    const share = s.stats.lifetimeGold / E.GOLD_EVER_MINED_OZ;
    const studied = Object.keys(s.codex).length;
    const rows = [
      ['Vault reserves', oz(s.run.reserves)],
      ['Dollars issued this era', fmtUSD(s.run.minted)],
      ['Gold mined, lifetime', oz(s.stats.lifetimeGold)],
      ['Versus all gold ever mined (≈6.95B oz)', share >= 1 ? `${fmt(share, 1)}×` : `${(share * 100).toPrecision(3)}%`],
      ['Shifts this era / lifetime', `${fmt(s.run.shifts)} / ${fmt(s.stats.totalShifts)}`],
      ['Rock broken, lifetime', fmt(s.stats.totalOre)],
      ['Best shift', oz(s.stats.bestShift)],
      ['Best single swing', oz(s.stats.bestStrike)],
      ['Mother Lodes', fmt(s.stats.lodes)],
      ['Your pace', `${rate(d.pace)} oz/s`],
      ['Crews hired', fmt(crews)],
      ['Charters signed', `${Object.keys(s.run.charters).length - 1} / ${E.CHARTERS.length - 1}`],
      ['Codex terms studied', `${studied} / ${Object.keys(E.GLOSSARY).length}`],
      ['Time played', fmtTime(s.stats.playTime)],
      ['Era started', new Date(s.run.startedAt).toLocaleString()],
    ];
    Modal.open({
      kicker: 'LEDGER',
      title: 'Statistics',
      body: `<table class="stats-table"><tbody>${rows.map(([k, v]) => `<tr><th scope="row">${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</tbody></table>`,
    });
  }

  function showCodex() {
    const entries = Object.entries(E.GLOSSARY);
    const render = (q) => {
      const ql = q.trim().toLowerCase();
      const match = ([, t]) => !ql || t.title.toLowerCase().includes(ql) || t.body.toLowerCase().includes(ql);
      const group = (era, label) => {
        const items = entries.filter(([, t]) => t.era === era).filter(match).sort((a, b) => a[1].title.localeCompare(b[1].title));
        if (!items.length) return '';
        return `<div class="codex-group">${label}</div>${items.map(([id, t]) => `<div class="codex-item${era === 'fiat' ? ' fiat' : ''}"><h4>${esc(t.title)}${G.state.codex[id] ? '<span>✓ STUDIED</span>' : ''}</h4><p>${esc(t.body)}</p>${t.game ? `<div class="tt-game">${esc(t.game)}</div>` : ''}</div>`).join('')}`;
      };
      const html = group('gold', 'ERA I · GOLD STANDARD') + group('fiat', 'ERA II · FIAT (PREVIEW)');
      return html || '<p class="muted">No terms match.</p>';
    };
    const studied = Object.keys(G.state.codex).length;
    Modal.open({
      kicker: `ECONOMICS CODEX · ${studied} / ${entries.length} STUDIED`,
      title: 'The language of money',
      wide: true,
      body: `<input type="search" id="codex-q" placeholder="Search terms…" aria-label="Search the codex" autofocus><div class="codex-list" id="codex-list">${render('')}</div>`,
      onOpen: (box) => {
        const q = box.querySelector('#codex-q');
        q.addEventListener('input', () => { box.querySelector('#codex-list').innerHTML = render(q.value); });
      },
    });
  }

  function showNixonPreview() {
    const cred = E.NIXON.credibility(G.state.run.reserves);
    Modal.open({
      kicker: 'PHASE II · CLASSIFIED',
      title: 'The Nixon Shock is being drafted',
      body: `<p>Your vault holds enough gold to close the window. In the next build, severing the peg resets your gold empire and awards <b>${cred} Central Bank Credibility</b> to spend in the Fiat Era: interest rates, fractional reserve banking and the petrodollar.</p>
        <p class="muted">Your progress is saved. Keep mining to raise the Credibility you will carry forward. It grows with the cube root of your vault reserves.</p>`,
      actions: [{ label: 'Keep mining', primary: true }],
    });
  }

  /* ------------------------------------------------------------------------
   * Developer tools (Settings → Developer tools, or ?debug)
   * --------------------------------------------------------------------- */
  const Debug = {
    cash(n) { G.state.dollars += n; },
    gold(n) { E.deposit(G.state, n, E.derive(G.state)); },
    sign() {
      const c = E.nextCharter(G.state);
      if (!c) return;
      G.state.run.charters[c.id] = true;
      refresh();
      onCharter(E.ITEM_BY_ID[c.id]);
    },
    permits() {
      E.BUILDINGS.forEach((b) => { if (G.state.run.charters[b.permitCharter]) G.state.run.items[`permit_${b.id}`] = 1; });
    },
    crews(n) {
      E.BUILDINGS.forEach((b) => { if (E.hasPermit(G.state, b.id)) G.state.run.buildings[b.id] += n; });
    },
    endShift() {
      const s = Mine.view.shift;
      if (Mine.view.running && s) s.t = s.stats.duration;
    },
    lode() {
      const s = Mine.view.shift;
      if (Mine.view.running && s) s.lodeAt = s.t;
    },
    warp(seconds) { showWelcomeBack(runOffline(seconds)); },
    era() { G.state.era = G.state.era === 'gold' ? 'fiat' : 'gold'; applySettings(); },
    el: null,
    /** Show the panel when ?debug is in the URL or the Developer tools setting is on. */
    sync() {
      const want = DEBUG || (G.state && G.state.settings.debug);
      if (want && !this.el) this.mount();
      else if (!want && this.el) this.unmount();
    },
    unmount() {
      if (this.el) this.el.remove();
      this.el = null;
    },
    mount() {
      const el = document.createElement('div');
      el.className = `debug${phone() ? ' collapsed' : ''}`;
      const btns = [
        ['+$1K', () => this.cash(1e3)], ['+$1M', () => this.cash(1e6)], ['+$1B', () => this.cash(1e9)], ['+$1T', () => this.cash(1e12)],
        ['+1K oz', () => this.gold(1e3)], ['+1M oz', () => this.gold(1e6)], ['sign next', () => this.sign()], ['permits', () => this.permits()],
        ['+10 crews', () => this.crews(10)], ['end shift', () => this.endShift()], ['lode', () => this.lode()],
        ['warp 1h', () => this.warp(3600)], ['fiat theme', () => this.era()],
      ];
      el.innerHTML = '<button type="button" class="debug-head" aria-expanded="true"><span>DEBUG</span><span class="debug-caret" aria-hidden="true">▾</span></button><div class="debug-body"></div>';
      const head = el.querySelector('.debug-head');
      head.setAttribute('aria-expanded', String(!el.classList.contains('collapsed')));
      head.addEventListener('click', () => head.setAttribute('aria-expanded', String(!el.classList.toggle('collapsed'))));
      const body = el.querySelector('.debug-body');
      btns.forEach(([label, fn]) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = label;
        b.addEventListener('click', () => { fn(); refresh(); View.slow(); });
        body.appendChild(b);
      });
      document.body.appendChild(el);
      this.el = el;
    },
  };

  /* ------------------------------------------------------------------------
   * Main loop
   * --------------------------------------------------------------------- */
  function frame(ts) {
    const dt = G.lastFrame ? Math.min(0.1, (ts - G.lastFrame) / 1000) : 0;
    G.lastFrame = ts;
    catchUp();
    refresh();
    Mine.frame(dt);
    View.frame();
    Ticker.update(dt);
    G.slowAcc += dt;
    if (G.slowAcc >= SLOW_TICK_S) { G.slowAcc = 0; View.slow(); }
    G.sparkAcc += dt;
    if (G.sparkAcc >= SPARK_EVERY_S) { G.sparkAcc = 0; Spark.sample(); }
    requestAnimationFrame(frame);
  }

  function boot() {
    $('svg-defs').innerHTML = A.defs();
    const now = Date.now();
    const raw = Store.read();
    const problem = raw && raw.error;
    G.state = E.migrate(problem ? null : raw && raw.data, now);
    if (raw && raw.legacy) Store.archiveV1(raw.text);
    G.lastSim = now;
    applySettings();
    refresh();

    Tip.init();
    Modal.init();
    View.init();
    Pages.init();
    Mine.init();
    Shop.init();
    Sites.init();
    Treasury.init();

    let offline = null;
    if (raw && !problem && !raw.legacy) {
      const away = (now - G.state.savedAt) / 1000;
      if (away > 1) offline = runOffline(away);
    }
    refresh();
    if (!G.state.log.length) addLog("Sutter's Mill", plain(E.CHARTERS[0].text), 'milestone', 1848);

    Ticker.init();
    Spark.init();
    Spark.sample();
    Pages.show(G.state.settings.tab, { scroll: false });
    View.frame();

    G.nextSave = Date.now() + AUTOSAVE_MS;
    setInterval(() => save(), AUTOSAVE_MS);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', () => save());
    window.addEventListener('storage', (e) => {
      if (e.key !== SAVE_KEY || G.conflict) return;
      G.conflict = true;
      Modal.open({
        kicker: 'LEDGER CONFLICT',
        title: 'Game opened in another tab',
        body: '<p>Another tab is now writing to this save. Autosave is paused here so the two sessions do not overwrite each other.</p>',
        actions: [{ label: 'Reload with latest save', primary: true, onClick: () => { location.reload(); } }],
        dismissible: false,
      });
    });
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(true); return; }
      if (e.key === 'Escape' && Tip.sticky) Tip.hide();
      const typing = e.target.closest && e.target.closest('input, textarea');
      if (typing || Modal.isOpen || e.ctrlKey || e.metaKey || e.altKey) return;
      if (['1', '2', '3', '4'].includes(e.key)) { Pages.show(PAGES[Number(e.key) - 1]); return; }
      // Space on the mine page starts the next shift, unless a control has focus.
      const onControl = e.target.closest && e.target.closest('button, a, [tabindex]');
      if (e.key === ' ' && Pages.current === 'mine' && !Mine.view.running && !onControl) {
        e.preventDefault();
        Mine.act(Mine.phase === 'paused' ? 'resume' : 'start');
      }
    });

    window.FFC = { G, Economy: E, SVGAssets: A, Mining: M, Mine, Shop, Sites, Pages, Tip, save, debug: Debug, store: Store };

    if (problem === 'corrupt') toast({ kicker: 'LEDGER', title: 'Save could not be read', text: 'A backup copy was kept in local storage. Starting a fresh era.', icon: A.uiIcon('info'), timeout: 10000 });
    if (problem === 'unavailable' || !Store.ok) toast({ kicker: 'LEDGER', title: 'Saving unavailable', text: 'This browser blocks local storage, so progress will not persist. Use Export in Settings.', icon: A.uiIcon('info'), timeout: 10000 });

    if (!G.state.flags.introSeen) showIntro();
    else if (offline && offline.seconds >= AWAY_NOTICE_S) showWelcomeBack(offline);
    save();

    requestAnimationFrame(frame);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
