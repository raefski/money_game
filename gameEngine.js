/* ==========================================================================
   FULL FAITH & CREDIT — gameEngine.js
   Game loop, persistence, input and the dashboard view layer.

   Time model: requestAnimationFrame only *renders*. The simulation always
   advances by real elapsed wall-clock time (Date.now), so a backgrounded
   tab, a sleeping laptop or a closed browser are all credited exactly via
   Economy.simulate, which steps event-to-event.
   ========================================================================== */
(function () {
  'use strict';

  const E = window.Economy;
  const A = window.SVGAssets;
  if (!E || !A) {
    document.body.insertAdjacentHTML('afterbegin', '<p style="padding:20px;font-family:monospace">Failed to load game scripts.</p>');
    return;
  }

  /* ------------------------------------------------------------------------
   * Constants & helpers
   * --------------------------------------------------------------------- */
  const SAVE_KEY = 'ffc.save.v1';
  const EXPORT_PREFIX = 'FFC1:';
  const AUTOSAVE_MS = 10000;
  const SLOW_TICK_S = 0.2;
  const SPARK_EVERY_S = 2;
  const SPARK_POINTS = 60;
  const AWAY_NOTICE_S = 60;
  const DEBUG = /[?&]debug(=|&|$)/.test(location.search);
  const ROMAN = ['0', 'I', 'II', 'III', 'IV', 'V'];
  const PLACES = [
    [0, 'COLOMA, CA · 38.80°N 120.89°W'],
    [1859, 'VIRGINIA CITY, NV · 39.31°N 119.65°W'],
    [1890, 'CRIPPLE CREEK, CO · 38.75°N 105.18°W'],
    [1936, 'FORT KNOX, KY · 37.88°N 85.96°W'],
  ];
  const { fmt, fmtTime, fmtUSD, fmtClock } = E;

  const $ = (id) => document.getElementById(id);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);
  const pct = (x, dp = 1) => `${(x * 100).toFixed(dp)}%`;
  const firstSentence = (s) => { const m = String(s).match(/^.*?[.!?](?=\s|$)/); return m ? m[0] : String(s); };
  const randBetween = (a, b) => a + Math.random() * (b - a);

  /** Escape text, then turn [[term-id|label]] into glossary spans. */
  function rich(text, focusable = true) {
    return esc(text).replace(/\[\[([a-z0-9-]+)\|([^\]]+)\]\]/g, (_, id, label) =>
      `<span class="term" data-tip="term:${id}"${focusable ? ' tabindex="0"' : ''}>${label}</span>`);
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
    year: 1848,
    lastSim: 0,           // wall-clock ms the simulation has been advanced to
    lastFrame: 0,
    slowAcc: 0,
    sparkAcc: 0,
    sessionStart: Date.now(),
    nextSave: 0,
    away: null,           // snapshot taken when the tab is hidden
    awayMilestones: [],
    conflict: false,      // another tab is writing the same save
  };

  /* ------------------------------------------------------------------------
   * Persistence
   * --------------------------------------------------------------------- */
  const Store = {
    ok: true,
    read() {
      let raw = null;
      try { raw = localStorage.getItem(SAVE_KEY); } catch (err) { this.ok = false; return { error: 'unavailable' }; }
      if (!raw) return null;
      try { return JSON.parse(raw); } catch (err) {
        try { localStorage.setItem(`${SAVE_KEY}.corrupt.${Date.now()}`, raw); } catch (_) { /* ignore */ }
        return { error: 'corrupt' };
      }
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
      const s = String(str || '').trim();
      const body = s.startsWith(EXPORT_PREFIX) ? s.slice(EXPORT_PREFIX.length) : s;
      return JSON.parse(b64decode(body));
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
   * Simulation & events
   * --------------------------------------------------------------------- */
  /** Advance the economy by dt seconds. mode: 'live' | 'offline'. */
  function advance(dt, mode) {
    const events = [];
    E.simulate(G.state, dt, (ev) => events.push(ev));
    if (mode === 'live') G.state.stats.playTime += dt;
    handleEvents(events, mode);
    return events;
  }

  /** Bring the simulation up to the current wall-clock time. */
  function catchUp() {
    const now = Date.now();
    let dt = (now - G.lastSim) / 1000;
    G.lastSim = now;
    if (!(dt > 0)) return; // clock went backwards: never un-earn gold
    if (dt > E.MAX_OFFLINE_SECONDS) dt = E.MAX_OFFLINE_SECONDS;
    advance(dt, 'live');
  }

  function handleEvents(events, mode) {
    for (const ev of events) {
      if (ev.type === 'milestone') onMilestone(ev.milestone, mode);
      else if (ev.type === 'buffEnd') addLog('Buff ended', `${ev.buff.name} has run its course.`, 'lucky');
    }
  }

  function onMilestone(m, mode) {
    addLog(m.title, m.text, 'milestone', Math.floor(m.year));
    Ticker.breaking(m);
    const quiet = mode !== 'live' || document.hidden;
    if (quiet) { G.awayMilestones.push(m); return; }
    toast({ kicker: `MILESTONE · +${Math.round(E.MILESTONE_BONUS * 100)}% OUTPUT`, title: m.title, text: m.text, year: Math.floor(m.year) });
    Sound.chime();
    View.flashKPI('kpi-date-wrap');
    if (m.id === 'm1934') View.flashKPI('kpi-price-wrap');
  }

  function addLog(title, text, kind = 'info', year) {
    const log = G.state.log;
    log.push({ y: year || Math.floor(G.year), title, text, k: kind });
    if (log.length > 40) log.splice(0, log.length - 40);
    View.logDirty = true;
  }

  /* ------------------------------------------------------------------------
   * Player actions
   * --------------------------------------------------------------------- */
  function strike(ev) {
    const events = [];
    const gained = E.strike(G.state, (e) => events.push(e));
    handleEvents(events, 'live');
    G.d = E.derive(G.state);
    View.strikeFX(ev, gained);
    Sound.strike();
  }

  function buyBuilding(id) {
    const before = G.state.run.buildings[id];
    const res = E.buyBuilding(G.state, id, G.state.settings.buyAmount);
    const card = View.cards.get(id);
    if (!res.ok) {
      if (card) { card.root.classList.remove('denied'); void card.root.offsetWidth; card.root.classList.add('denied'); }
      Sound.deny();
      return;
    }
    const def = E.BUILDING_BY_ID[id];
    if (before === 0) {
      addLog('New site', `First ${def.name} established.`, 'build');
      toast({ kicker: 'NEW SITE', title: def.name, text: def.desc, icon: A.picto(id) });
    }
    if (card) { card.root.classList.remove('bought'); void card.root.offsetWidth; card.root.classList.add('bought'); }
    Sound.buy();
    G.d = E.derive(G.state);
    View.slow();
  }

  function buyUpgrade(id) {
    const res = E.buyUpgrade(G.state, id);
    if (!res.ok) { Sound.deny(); return; }
    const u = res.upgrade;
    addLog('Researched', `${u.name}: ${E.upgradeEffect(u)}.`, 'research');
    toast({ kicker: u.kind === 'global' ? 'POLICY ENACTED' : u.kind === 'click' ? 'NEW STRIKE TOOL' : 'SITE UPGRADE', title: u.name, text: E.upgradeEffect(u), icon: A.upgradeIcon(u) });
    Sound.buy(true);
    G.d = E.derive(G.state);
    if (u.kind === 'click') View.renderNugget();
    if (u.kind === 'building') View.evolveCard(u.building);
    View.slow();
  }

  /* ------------------------------------------------------------------------
   * Lucky strikes: a glowing nugget that appears in the territory.
   * --------------------------------------------------------------------- */
  const Lucky = {
    timer: randBetween(E.LUCKY.spawnMin, E.LUCKY.spawnMax),
    el: null,
    life: 0,
    update(dt) {
      if (document.hidden || !dt) return;
      if (this.el) {
        this.life -= dt;
        if (this.life <= 0) this.despawn();
        return;
      }
      if (G.state.run.gold < 100) return;
      this.timer -= dt;
      if (this.timer <= 0) this.spawn();
    },
    spawn() {
      const layer = $('lucky-layer');
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'lucky';
      el.setAttribute('aria-label', 'Lucky strike: a glowing nugget! Click to claim it.');
      el.style.left = `${randBetween(10, 88).toFixed(1)}%`;
      el.style.top = `${randBetween(30, 78).toFixed(1)}%`;
      el.innerHTML = `<svg viewBox="0 0 40 40" aria-hidden="true"><polygon points="8,24 12,12 22,8 32,13 34,24 27,32 15,33" fill="url(#ffc-goldgrad)" stroke="#fff3c4" stroke-width="1"/><polygon points="12,12 22,8 20,18" fill="#fff3c4" opacity=".7"/></svg>`;
      el.addEventListener('click', (ev) => this.collect(ev));
      layer.appendChild(el);
      this.el = el;
      this.life = E.LUCKY.lifetime;
      Sound.sparkle();
    },
    collect(ev) {
      if (!this.el) return;
      const outcome = E.rollLucky();
      const events = [];
      const gained = E.applyLucky(G.state, outcome, (e) => events.push(e));
      handleEvents(events, 'live');
      G.d = E.derive(G.state);
      const label = gained > 0 ? `+${fmt(gained, 1)} oz` : outcome.name.toUpperCase();
      View.floatAt($('lucky-layer'), ev, label, true);
      addLog('Lucky strike', `${outcome.name}! ${outcome.text}${gained > 0 ? ` +${fmt(gained, 1)} oz.` : ''}`, 'lucky');
      toast({ kicker: 'LUCKY STRIKE', title: outcome.name, text: gained > 0 ? `${outcome.text} +${fmt(gained, 1)} oz.` : outcome.text, icon: A.uiIcon('spark') });
      Sound.lucky();
      this.despawn(true);
      View.slow();
    },
    despawn(collected) {
      const el = this.el;
      this.el = null;
      this.timer = randBetween(E.LUCKY.spawnMin, E.LUCKY.spawnMax);
      if (!el) return;
      if (collected) { el.remove(); return; }
      el.classList.add('leaving');
      setTimeout(() => el.remove(), 800);
    },
    forceSpawn() {
      if (this.el) this.despawn(true);
      this.spawn();
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
    init() {
      this.track = $('ticker-track');
      this.track.innerHTML = '';
      this.offset = 0;
      for (let i = 0; i < 12; i++) this.append();
    },
    breaking(m) {
      this.queue.push(`<span class="tk breaking"><b>BREAKING</b>${esc(Math.floor(m.year))}: ${esc(m.title.toUpperCase())}</span>`);
    },
    item(i) {
      const s = G.state, d = G.d;
      const kind = i % 6;
      if (this.queue.length && kind % 2 === 0) return this.queue.shift();
      if (kind === 0) return `<span class="tk">GOLD/USD <b data-live="price"></b> <span class="muted">MINT PRICE</span></span>`;
      if (kind === 1) return `<span class="tk">RESERVES <b data-live="reserves"></b> <span data-live="delta"></span></span>`;
      if (kind === 2 || kind === 4) {
        const pool = E.HEADLINES.map((h, idx) => [h, idx]).filter(([h]) => G.year >= h[0] && G.year <= h[1]);
        if (pool.length) {
          let pick = pool[Math.floor(Math.random() * pool.length)];
          if (pick[1] === this.lastHeadline && pool.length > 1) pick = pool[(pool.indexOf(pick) + 1) % pool.length];
          this.lastHeadline = pick[1];
          return `<span class="tk news"><b>${E.dateLabel(G.year)}</b> ${esc(pick[0][2])}</span>`;
        }
      }
      if (kind === 3) return `<span class="tk">OUTPUT <b data-live="output"></b> <span class="muted" data-live="fever"></span></span>`;
      const owned = E.BUILDINGS.filter((b) => s.run.buildings[b.id] > 0);
      if (owned.length) {
        const b = owned[Math.floor(Math.random() * owned.length)];
        return `<span class="tk">${esc(b.name.toUpperCase())} <b>×${s.run.buildings[b.id]}</b> <span class="muted">${fmt(d.buildingRate[b.id], 1)} OZ/S</span></span>`;
      }
      return `<span class="tk">ASSAY OFFICE <b>OPEN</b> <span class="muted">DUST BOUGHT AT $${E.goldPrice(s).toFixed(2)}/OZ</span></span>`;
    },
    count: 0,
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
        price: `$${E.goldPrice(s).toFixed(2)}`,
        reserves: `${fmt(s.gold, 1)} OZ`,
        delta: delta == null ? '' : `${delta >= 0 ? '▲' : '▼'}${Math.abs(delta * 100).toFixed(2)}%`,
        output: `${fmt(d.rate, 1)} OZ/S`,
        fever: d.prodBuff > 1 ? `×${d.prodBuff} FEVER` : 'STEADY',
      };
      scope.querySelectorAll('[data-live]').forEach((el) => {
        const key = el.dataset.live;
        setText(el, values[key]);
        if (key === 'delta') el.className = delta == null ? '' : delta >= 0 ? 'up' : 'down';
      });
    },
    update(dt) {
      if (!this.track || !dt) return;
      if (document.body.classList.contains('reduce-motion') || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
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
   * Sound: tiny synthesized cues (off by default)
   * --------------------------------------------------------------------- */
  const Sound = {
    ctx: null,
    on() { return G.state && G.state.settings.sound; },
    ensure() {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        this.ctx = new AC();
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    },
    tone(freq, dur, type = 'sine', gain = 0.04, delay = 0) {
      const ctx = this.ensure();
      if (!ctx) return;
      const t = ctx.currentTime + delay;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + dur + 0.02);
    },
    strike() { if (!this.on()) return; const f = 1500 + Math.random() * 600; this.tone(f, 0.08, 'triangle', 0.035); this.tone(f * 1.52, 0.06, 'sine', 0.018); },
    buy(big) { if (!this.on()) return; this.tone(big ? 520 : 330, 0.12, 'square', 0.018); this.tone(big ? 780 : 495, 0.16, 'sine', 0.03, 0.05); },
    deny() { if (!this.on()) return; this.tone(150, 0.12, 'sawtooth', 0.015); },
    chime() { if (!this.on()) return; [784, 988, 1319].forEach((f, i) => this.tone(f, 0.5, 'sine', 0.03, i * 0.09)); },
    sparkle() { if (!this.on()) return; [1760, 2349].forEach((f, i) => this.tone(f, 0.25, 'sine', 0.015, i * 0.07)); },
    lucky() { if (!this.on()) return; [1047, 1319, 1568, 2093].forEach((f, i) => this.tone(f, 0.35, 'triangle', 0.025, i * 0.06)); },
  };

  /* ------------------------------------------------------------------------
   * Tooltips: one floating element, content providers keyed by data-tip.
   * --------------------------------------------------------------------- */
  const TEXT_TIPS = {
    era: () => ['Era I · Gold Standard', 'The dollar is defined as a fixed weight of gold, so your reserves are the money supply. Sever the [[gold-standard|gold peg]] to open Era II.'],
    date: () => ['Historical date', 'The calendar advances as you mine. History runs from Sutter\'s Mill (1848) to the closing of the gold window (1971).'],
    usd: () => ['Reserves in dollars', `Your gold valued at the official mint price: $20.67/oz until the [[gold-reserve-act|Gold Reserve Act]] of 1934, then $35/oz.`],
    bonus: () => {
      const n = Math.max(0, G.d.milestones - 1);
      return ['History bonus', `Each historical milestone reached this era adds +${Math.round(E.MILESTONE_BONUS * 100)}% to all output. Reached ${n} of ${E.MILESTONES.length - 1}.`];
    },
    rate: () => {
      const d = G.d;
      return ['Output per second', `Total extraction from every site. Policy multiplier ×${d.globalMult.toFixed(2)}, history ×${d.milestoneMult.toFixed(2)}${d.prodBuff > 1 ? `, Gold Fever ×${d.prodBuff}` : ''}.`];
    },
    strike: () => {
      const d = G.d;
      return ['Per strike', `Gold mined each time you strike the vein: ${fmt(d.clickMult)} oz base${d.clickPct ? ` plus ${Math.round(d.clickPct * 100)}% of your output per second` : ''}${d.clickBuff > 1 ? `, ×${d.clickBuff} Bonanza` : ''}. Better tools come from research.`];
    },
    industry: () => ['Industrial index', 'How heavily industrialized your territory has become. Weighted by site type and upgrade tier. The smog thickens and the stars fade as it rises.'],
    milestone: () => {
      const next = E.nextMilestone(G.state);
      if (!next) return ['History complete', 'You have reached August 1971. The gold window can be closed.'];
      return [`Next: ${next.title} (${Math.floor(next.year)})`, `Reached when this era's mined gold hits ${fmt(next.at)} oz (now ${fmt(G.state.run.gold, 1)}). Grants +${Math.round(E.MILESTONE_BONUS * 100)}% output.`];
    },
    codex: () => ['Economics codex', 'Every real-world term in the game, with definitions. Terms you have studied are marked.'],
    stats: () => ['Statistics', 'Lifetime records for this save.'],
    sound: () => ['Sound', G.state.settings.sound ? 'Sound effects are on.' : 'Sound effects are off.'],
    settings: () => ['Settings & saves', 'Number format, motion, sound, and export/import of your save.'],
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

  function affordLine(cost) {
    const s = G.state, d = G.d;
    if (s.gold >= cost) return '<div class="tt-foot ok">Affordable now</div>';
    if (d.rate > 0) return `<div class="tt-foot">Affordable in ${fmtTime((cost - s.gold) / d.rate)}</div>`;
    return '<div class="tt-foot">Strike the vein to raise funds</div>';
  }

  const TIPS = {
    term(id) {
      const t = E.GLOSSARY[id];
      if (!t) return '';
      markStudied(id);
      return `<div class="tt-head"><span class="tt-title">${esc(t.title)}</span><span class="tt-tag${t.era === 'fiat' ? ' fiat' : ''}">${t.era === 'fiat' ? 'FIAT ERA · LOCKED' : 'ECONOMICS'}</span></div>
        <div class="tt-body">${esc(t.body)}</div>${t.game ? `<div class="tt-game">${esc(t.game)}</div>` : ''}`;
    },
    building(id) {
      const def = E.BUILDING_BY_ID[id];
      const s = G.state, d = G.d;
      const owned = s.run.buildings[id];
      const tier = d.tiers[id];
      const q = E.purchaseQuote(s, def, s.settings.buyAmount);
      const share = d.baseRate > 0 ? d.buildingRate[id] / d.baseRate : 0;
      const next = tier < 5 ? E.UPGRADE_BY_ID[`${id}-${tier + 1}`] : null;
      return `<div class="tt-head"><span class="tt-title">${esc(def.name)}</span><span class="tt-tag">EST. ${def.year} · OWNED ${owned}</span></div>
        <span class="tt-chip">${tier ? `TIER ${ROMAN[tier]}` : 'BASE'} · ${esc(def.tiers[tier].toUpperCase())}</span>
        <div class="tt-body">${rich(def.desc, false)}</div>
        <div class="tt-quote">${esc(def.quote)}</div>
        <dl class="tt-stats">
          <dt>Each</dt><dd>${fmt(d.unitRate[id], 2)} oz/s</dd>
          <dt>All ${owned}</dt><dd>${fmt(d.buildingRate[id], 1)} oz/s · ${pct(share)}</dd>
          <dt>Buy ×${q.n}${q.isMax ? ' (max)' : ''}</dt><dd>${fmt(q.cost)} oz</dd>
          ${next ? `<dt>Next stage</dt><dd>${esc(next.name)} · ${next.owned} owned</dd>` : ''}
        </dl>
        ${affordLine(q.cost)}${glossFooter(def.desc)}`;
    },
    upgrade(id) {
      const u = E.UPGRADE_BY_ID[id];
      if (!u) return '';
      const owned = !!G.state.run.upgrades[id];
      const kind = u.kind === 'building' ? `SITE UPGRADE · TIER ${ROMAN[u.tier]}` : u.kind === 'click' ? 'STRIKE TOOL' : 'POLICY';
      const visual = u.kind === 'building' ? `<div class="tt-quote">${esc(E.BUILDING_BY_ID[u.building].name)} artwork evolves to stage ${ROMAN[u.tier]}.</div>` : u.kind === 'click' ? '<div class="tt-quote">Your strike tool changes.</div>' : '';
      return `<div class="tt-head"><span class="tt-title">${esc(u.name)}</span><span class="tt-tag">${kind}</span></div>
        <div class="tt-effect">${esc(E.upgradeEffect(u))}</div>
        <div class="tt-body">${rich(u.desc, false)}</div>${visual}
        ${owned ? '<div class="tt-foot ok">✓ Researched</div>' : `<dl class="tt-stats"><dt>Cost</dt><dd>${fmt(u.cost)} oz</dd></dl>${affordLine(u.cost)}`}
        ${glossFooter(u.desc)}`;
    },
    locked(id) {
      const def = E.BUILDING_BY_ID[id];
      return `<div class="tt-head"><span class="tt-title">Classified site</span><span class="tt-tag">SURVEY PENDING</span></div>
        <div class="tt-body">Surveyors report promising ground. This operation becomes available around <b>${def.year}</b> as history advances.</div>`;
    },
    text(key) {
      const fn = TEXT_TIPS[key];
      if (!fn) return '';
      const [title, body] = fn();
      return `<div class="tt-head"><span class="tt-title">${esc(title)}</span></div><div class="tt-body">${rich(body, false)}</div>${glossFooter(body)}`;
    },
  };

  const Tip = {
    el: null,
    target: null,
    sticky: false,
    init() {
      this.el = $('tooltip');
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
      document.addEventListener('pointerdown', (e) => {
        if (e.pointerType !== 'touch') return;
        const t = e.target.closest('[data-tip]');
        if (t && !t.matches('button')) this.show(t, true);
        else this.hide();
      });
      document.addEventListener('focusin', (e) => {
        const t = e.target.closest && e.target.closest('[data-tip]');
        if (t) this.show(t);
      });
      document.addEventListener('focusout', (e) => {
        if (this.target && e.target.closest && e.target.closest('[data-tip]') === this.target) this.hide();
      });
      document.addEventListener('scroll', () => { if (this.target && !this.sticky) this.hide(); }, true);
      window.addEventListener('resize', () => this.hide());
    },
    content() {
      const spec = this.target.dataset.tip || '';
      const i = spec.indexOf(':');
      const kind = spec.slice(0, i), id = spec.slice(i + 1);
      return TIPS[kind] ? TIPS[kind](id) : '';
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
      if (!document.contains(this.target)) { this.hide(); return; }
      const before = this.el._h;
      setHTML(this.el, this.content());
      if (this.el._h !== before) this.position();
    },
    position() {
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
    while (box.children.length > 4) box.firstElementChild.remove();
    setTimeout(dismiss, timeout);
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
   * Sparkline: reserves over the last two minutes (single series).
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
      this.data.push({ t: Date.now(), v: G.state.gold });
      if (this.data.length > SPARK_POINTS + 1) this.data.shift();
      this.draw();
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
   * View layer
   * --------------------------------------------------------------------- */
  const View = {
    cards: new Map(),
    // Render caches: null never matches a real key, so the first pass always draws.
    gridKey: null,
    tilesKey: null,
    ownedKey: null,
    sceneKeys: {},
    infraKey: null,
    nuggetKey: null,
    vaultKey: null,
    logDirty: true,
    observer: null,

    init() {
      $('emblem').innerHTML = A.emblem();
      $('btn-codex').innerHTML = A.uiIcon('book');
      $('btn-stats').innerHTML = A.uiIcon('chart');
      $('btn-settings').innerHTML = A.uiIcon('gear');
      this.renderSoundButton();
      this.renderNugget();
      this.renderFiatPreview();
      this.initScene();
      if ('IntersectionObserver' in window) {
        this.observer = new IntersectionObserver((entries) => {
          entries.forEach((en) => en.target.classList.toggle('offscreen', !en.isIntersecting));
        }, { rootMargin: '80px' });
        this.observer.observe($('scene-wrap'));
      }
      this.bindControls();
    },

    resetAll() {
      if (this.observer) this.cards.forEach((c) => this.observer.unobserve(c.art));
      this.cards.clear();
      $('bgrid').innerHTML = '';
      this.gridKey = this.tilesKey = this.ownedKey = this.infraKey = this.nuggetKey = this.vaultKey = null;
      this.sceneKeys = {};
      this.logDirty = true;
      document.querySelectorAll('[id]').forEach((el) => { delete el._v; delete el._h; delete el._w; });
      this.initScene();
      this.renderNugget();
      this.renderSoundButton();
      this.syncBuySeg();
      this.slow();
      this.frame();
    },

    bindControls() {
      const nugget = $('nugget');
      nugget.addEventListener('click', (e) => strike(e));
      nugget.addEventListener('keydown', (e) => { if (e.repeat && (e.key === 'Enter' || e.key === ' ')) e.preventDefault(); });
      $('buy-seg').addEventListener('click', (e) => {
        const b = e.target.closest('button[data-amt]');
        if (!b) return;
        const v = b.dataset.amt === 'max' ? 'max' : Number(b.dataset.amt);
        G.state.settings.buyAmount = v;
        this.syncBuySeg();
        this.slow();
      });
      this.syncBuySeg();
      $('btn-codex').addEventListener('click', showCodex);
      $('btn-stats').addEventListener('click', showStats);
      $('btn-settings').addEventListener('click', showSettings);
      $('btn-sound').addEventListener('click', () => {
        G.state.settings.sound = !G.state.settings.sound;
        this.renderSoundButton();
        if (G.state.settings.sound) Sound.buy();
        Tip.refresh();
      });
      $('btn-nixon').addEventListener('click', showNixonPreview);
    },

    syncBuySeg() {
      const amt = String(G.state.settings.buyAmount);
      document.querySelectorAll('#buy-seg button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.amt === amt)));
    },

    renderSoundButton() {
      const on = G.state && G.state.settings.sound;
      const btn = $('btn-sound');
      btn.innerHTML = A.uiIcon(on ? 'sound' : 'mute');
      btn.classList.toggle('on', !!on);
      btn.setAttribute('aria-pressed', String(!!on));
    },

    renderNugget() {
      const key = String(G.d ? G.d.tool : 0);
      if (key === this.nuggetKey) return;
      this.nuggetKey = key;
      $('nugget').innerHTML = A.nugget(Number(key));
    },

    initScene() {
      $('scene').setAttribute('viewBox', A.SCENE.viewBox);
      $('scene').innerHTML = `${A.sceneBase()}<g id="scene-infra"></g>${A.SLOT_ORDER.map((id) => `<g id="slot-${id}"></g>`).join('')}${A.sceneHaze()}`;
      this.sceneKeys = {};
      this.infraKey = null;
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

    /* ---- per-frame: cheap text updates ---- */
    frame() {
      const s = G.state, d = G.d;
      setText($('gold'), fmt(s.gold, 1));
      const price = E.goldPrice(s);
      setText($('gold-usd'), `≈ ${fmtUSD(s.gold * price)}`);
      setHTML($('rate'), `${esc(fmt(d.rate, 1))} <small>oz/s</small>`);
      setHTML($('click-value'), `${esc(fmt(d.clickValue, 1))} <small>oz</small>`);
      setText($('mini-gold'), `${fmt(s.gold, 1)} oz`);
      setText($('mini-rate'), `+${fmt(d.rate, 1)} oz/s`);
      setText($('kpi-usd'), fmtUSD(s.gold * price));
    },

    /* ---- 5 Hz: structure, affordability, panels ---- */
    slow() {
      const s = G.state, d = G.d;
      const year = G.year;
      const price = E.goldPrice(s);
      setText($('kpi-date'), E.dateLabel(year));
      setText($('scene-date'), E.dateLabel(year));
      setText($('kpi-price'), `$${price.toFixed(2)}`);
      setText($('gold-price-inline'), `$${price.toFixed(2)}`);
      setText($('kpi-bonus'), `+${Math.round((d.milestoneMult - 1) * 100)}%`);
      let place = PLACES[0][1];
      for (const [y, label] of PLACES) if (year >= y) place = label;
      setText($('territory-loc'), place);

      // next milestone progress (log scale)
      const next = E.nextMilestone(s);
      if (next) {
        const idx = E.MILESTONES.indexOf(next);
        const prev = E.MILESTONES[idx - 1];
        const lo = Math.log10(prev.at + 1), hi = Math.log10(next.at + 1);
        setText($('next-ms-title'), next.title);
        setText($('next-ms-year'), String(Math.floor(next.year)));
        setWidth($('next-ms-fill'), (Math.log10(s.run.gold + 1) - lo) / (hi - lo));
      } else {
        setText($('next-ms-title'), 'The gold window is open');
        setText($('next-ms-year'), '1971');
        setWidth($('next-ms-fill'), 1);
      }

      setWidth($('industry-fill'), d.industry);
      setText($('industry-val'), `${Math.round(d.industry * 100)}%`);

      this.renderBuildings();
      this.renderUpgrades();
      this.renderScene();
      this.renderNixon();
      this.renderBuffs();
      this.renderNugget();
      if (this.logDirty) this.renderLog();
      Ticker.refreshLive();

      // status bar
      const toSave = Math.max(0, Math.ceil((G.nextSave - Date.now()) / 1000));
      const sb = $('sb-save');
      if (!sb.classList.contains('saved') && !sb.classList.contains('error')) setText(sb, G.conflict ? 'AUTOSAVE PAUSED (OTHER TAB)' : `AUTOSAVE IN ${toSave}s`);
      setText($('sb-session'), `SESSION ${fmtClock((Date.now() - G.sessionStart) / 1000)}`);
      setText($('sb-lifetime'), `LIFETIME ${fmt(s.stats.lifetimeGold, 1)} OZ`);
      Tip.refresh();
    },

    renderBuildings() {
      const s = G.state, d = G.d;
      const visible = E.BUILDINGS.filter((b) => E.isBuildingVisible(s, b, G.year));
      const teaser = E.BUILDINGS.find((b) => !E.isBuildingVisible(s, b, G.year));
      const key = visible.map((b) => b.id).join(',') + '|' + (teaser ? teaser.id : '');
      const grid = $('bgrid');
      if (key !== this.gridKey) {
        this.gridKey = key;
        const frag = document.createDocumentFragment();
        visible.forEach((b) => {
          if (!this.cards.has(b.id)) this.cards.set(b.id, this.createCard(b));
          frag.appendChild(this.cards.get(b.id).root);
        });
        if (teaser) frag.appendChild(this.createTeaser(teaser));
        grid.innerHTML = '';
        grid.appendChild(frag);
      }
      let built = 0;
      for (const b of visible) {
        const c = this.cards.get(b.id);
        const owned = s.run.buildings[b.id];
        built += owned;
        const tier = d.tiers[b.id];
        const artKey = String(tier);
        if (c.artKey !== artKey) {
          c.artKey = artKey;
          c.svg.innerHTML = A.building(b.id, tier, { label: `${b.name}, ${b.tiers[tier]}` });
        }
        setText(c.tier, tier ? `${ROMAN[tier]} · ${b.tiers[tier].toUpperCase()}` : b.tiers[0].toUpperCase());
        setText(c.count, String(owned));
        toggleClass(c.root, 'unbuilt', owned === 0);
        const share = d.baseRate > 0 ? d.buildingRate[b.id] / d.baseRate : 0;
        setText(c.out, owned ? `${fmt(d.buildingRate[b.id], 1)} oz/s · ${Math.round(share * 100)}%` : `${fmt(d.unitRate[b.id], 2)} oz/s each`);
        setWidth(c.share, share);
        const q = E.purchaseQuote(s, b, s.settings.buyAmount);
        const can = s.gold >= q.cost;
        setText(c.qty, q.isMax ? `MAX ×${can ? q.n : 1}` : `BUY ×${q.n}`);
        setText(c.cost, `${fmt(q.cost)} oz`);
        setText(c.eta, can ? '' : d.rate > 0 ? fmtTime((q.cost - s.gold) / d.rate) : '');
        toggleClass(c.root, 'can', can);
        const label = `${b.name}: owned ${owned}. Buy ${q.n} for ${fmt(q.cost)} ounces${can ? '' : ' (not affordable)'}`;
        if (c.label !== label) { c.label = label; c.root.setAttribute('aria-label', label); }
      }
      setText($('ops-count'), `${built} BUILT`);
      setText($('scene-sites'), `${E.BUILDINGS.filter((b) => s.run.buildings[b.id] > 0).length} / ${E.BUILDINGS.length} SITES`);
    },

    createCard(def) {
      const root = document.createElement('button');
      root.type = 'button';
      root.className = 'bcard';
      root.dataset.id = def.id;
      root.dataset.tip = `building:${def.id}`;
      root.dataset.tipPos = 'side';
      root.innerHTML = `<div class="bcard-art"><div class="bcard-svg"></div><span class="bcard-tier"></span><span class="bcard-count">0</span></div>
        <div class="bcard-body">
          <div class="bcard-row"><span class="bcard-name">${esc(def.name)}</span><span class="bcard-year">${def.year}</span></div>
          <div class="bcard-row small"><span class="muted">Output</span><span class="bcard-out"></span></div>
          <span class="meter thin"><span></span></span>
          <div class="bcard-buy"><span class="bcard-qty">BUY ×1</span><span><span class="bcard-cost"></span><span class="bcard-eta"></span></span></div>
        </div>`;
      root.addEventListener('click', () => buyBuilding(def.id));
      const art = root.querySelector('.bcard-art');
      if (this.observer) this.observer.observe(art);
      return {
        root, art,
        svg: root.querySelector('.bcard-svg'),
        tier: root.querySelector('.bcard-tier'),
        count: root.querySelector('.bcard-count'),
        out: root.querySelector('.bcard-out'),
        share: root.querySelector('.meter > span'),
        qty: root.querySelector('.bcard-qty'),
        cost: root.querySelector('.bcard-cost'),
        eta: root.querySelector('.bcard-eta'),
        artKey: '',
      };
    },

    createTeaser(def) {
      const el = document.createElement('div');
      el.className = 'bcard locked';
      el.dataset.tip = `locked:${def.id}`;
      el.dataset.tipPos = 'side';
      el.tabIndex = 0;
      el.innerHTML = `<div class="bcard-art">${A.building(def.id, 0, { locked: true, label: 'Classified site' })}
          <div class="locked-overlay">${A.uiIcon('lock')}<span>CLASSIFIED</span><span class="muted">SURVEY c. ${def.year}</span></div></div>
        <div class="bcard-body"><div class="bcard-row"><span class="bcard-name">? ? ?</span><span class="bcard-year">${def.year}</span></div>
          <div class="bcard-row small"><span class="muted">Unlocks as history advances</span></div></div>`;
      return el;
    },

    evolveCard(id) {
      const c = this.cards.get(id);
      if (!c) return;
      c.art.classList.remove('evolve');
      void c.art.offsetWidth;
      c.art.classList.add('evolve');
    },

    renderUpgrades() {
      const s = G.state;
      const avail = E.availableUpgrades(s);
      const key = avail.map((u) => u.id).join(',');
      const grid = $('ugrid');
      if (key !== this.tilesKey) {
        this.tilesKey = key;
        grid.innerHTML = '';
        avail.forEach((u) => grid.appendChild(this.createTile(u, false)));
        const empty = $('ugrid-empty');
        empty.hidden = avail.length > 0;
        setText(empty, Object.keys(s.run.upgrades).length
          ? 'All current research is complete. New upgrades unlock as you build more sites and history advances.'
          : 'Nothing to research yet. Strike the vein and build your first sites to unlock upgrades.');
      }
      grid.querySelectorAll('.utile').forEach((el) => {
        const u = E.UPGRADE_BY_ID[el.dataset.id];
        toggleClass(el, 'can', s.gold >= u.cost);
      });
      const owned = E.UPGRADES.filter((u) => s.run.upgrades[u.id]);
      const okey = owned.map((u) => u.id).join(',');
      if (okey !== this.ownedKey) {
        this.ownedKey = okey;
        const og = $('ugrid-owned');
        og.innerHTML = '';
        owned.forEach((u) => og.appendChild(this.createTile(u, true)));
        setText($('researched-count'), String(owned.length));
      }
      setText($('rnd-count'), `${owned.length} / ${E.UPGRADES.length}`);
    },

    createTile(u, owned) {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = `utile${owned ? ' owned' : ''}`;
      el.dataset.id = u.id;
      el.dataset.kind = u.kind;
      el.dataset.tip = `upgrade:${u.id}`;
      el.setAttribute('aria-label', owned ? `${u.name} (researched)` : `Research ${u.name} for ${fmt(u.cost)} ounces`);
      el.innerHTML = `${A.upgradeIcon(u)}${owned ? '' : '<span class="utile-kind"></span>'}${u.kind === 'building' && !owned ? `<span class="utile-tier">${ROMAN[u.tier]}</span>` : ''}${owned ? '' : `<span class="utile-cost">${esc(fmt(u.cost))}</span>`}`;
      if (!owned) el.addEventListener('click', () => buyUpgrade(u.id));
      return el;
    },

    renderScene() {
      const s = G.state, d = G.d;
      for (const id of A.SLOT_ORDER) {
        const owned = s.run.buildings[id] > 0;
        const visible = E.isBuildingVisible(s, E.BUILDING_BY_ID[id], G.year);
        const tier = d.tiers[id];
        const key = `${owned}|${visible}|${tier}`;
        if (this.sceneKeys[id] === key) continue;
        const wasOwned = (this.sceneKeys[id] || '').startsWith('true');
        this.sceneKeys[id] = key;
        const g = $(`slot-${id}`);
        g.innerHTML = A.sceneSlot(id, tier, owned, visible);
        if (owned && !wasOwned && g.firstElementChild) g.firstElementChild.classList.add('fresh');
      }
      const up = s.run.upgrades;
      const flags = { telegraph: !!up.telegraph, railroad: !!up.railroad, fed: !!up.fedact };
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

    renderNixon() {
      const s = G.state, d = G.d;
      const cost = E.NIXON.cost;
      const ready = s.gold >= cost;
      setText($('peg-price'), `$${E.goldPrice(s).toFixed(2)} / oz`);
      setText($('nixon-cost'), `${fmt(cost)} oz`);
      setWidth($('nixon-fill'), s.gold / cost);
      setText($('nixon-pct'), `${Math.min(100, (s.gold / cost) * 100).toFixed(2)}% saved`);
      setText($('nixon-eta'), ready ? 'READY' : d.rate > 0 ? `ETA ${fmtTime((cost - s.gold) / d.rate)}` : 'ETA —');
      const cred = E.NIXON.credibility(s.run.gold);
      setText($('nixon-cred'), cred ? `+${cred} CBC` : `+0 (mine ${fmt(cost)})`);
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

    renderBuffs() {
      const box = $('buffs');
      const buffs = G.state.buffs;
      const key = buffs.map((b) => b.id).join(',');
      if (box._key !== key) {
        box._key = key;
        box.innerHTML = buffs.map((b) => `<div class="buff" data-buff="${esc(b.id)}">${A.uiIcon('bolt')}<span class="buff-name">${esc(b.name)} ×${b.mult} ${b.kind === 'click' ? 'strikes' : 'output'}</span><span class="buff-time"></span><span class="meter"><span></span></span></div>`).join('');
      }
      buffs.forEach((b) => {
        const el = box.querySelector(`[data-buff="${CSS.escape(b.id)}"]`);
        if (!el) return;
        setText(el.querySelector('.buff-time'), `${Math.ceil(b.remaining)}s`);
        setWidth(el.querySelector('.meter > span'), b.remaining / b.duration);
      });
    },

    renderLog() {
      this.logDirty = false;
      const log = G.state.log;
      const list = $('log');
      const newest = log.length ? log[log.length - 1] : null;
      list.innerHTML = log.slice().reverse().map((e, i) => `<li class="${i === 0 && e === this.lastLogTop ? '' : i === 0 ? 'fresh' : ''}"><span class="yr">${esc(e.y)}</span><span class="txt"><b>${esc(e.title)}.</b> ${rich(e.text)}</span></li>`).join('');
      this.lastLogTop = newest;
      setText($('log-count'), `${log.length}`);
    },

    flashKPI(id) {
      const el = $(id);
      if (!el) return;
      el.classList.remove('flash');
      void el.offsetWidth;
      el.classList.add('flash');
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

    /* ---- effects ---- */
    strikeFX(ev, gained) {
      const btn = $('nugget');
      btn.classList.remove('hit');
      void btn.offsetWidth;
      btn.classList.add('hit');
      const layer = $('fx-layer');
      const zone = $('strike-zone').getBoundingClientRect();
      let x, y;
      if (ev && ev.detail > 0 && ev.clientX) { x = ev.clientX - zone.left; y = ev.clientY - zone.top; }
      else { const r = btn.getBoundingClientRect(); x = r.left + r.width / 2 - zone.left; y = r.top + r.height / 2 - zone.top; }
      this.floatText(layer, x, y - 10, `+${fmt(gained, 1)}`);
      if (document.body.classList.contains('reduce-motion') || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      if (layer.childElementCount > 90) return;
      for (let i = 0; i < 7; i++) {
        const f = document.createElement('span');
        f.className = 'flake';
        f.style.left = `${x}px`;
        f.style.top = `${y}px`;
        layer.appendChild(f);
        const ang = randBetween(-Math.PI * 0.95, -Math.PI * 0.05);
        const dist = randBetween(30, 80);
        const dx = Math.cos(ang) * dist, dy = Math.sin(ang) * dist;
        const rot = randBetween(-260, 260);
        const anim = f.animate([
          { transform: 'translate(0,0) rotate(0deg) scale(1)', opacity: 1 },
          { transform: `translate(${dx * 0.7}px, ${dy * 0.9}px) rotate(${rot * 0.6}deg) scale(1)`, opacity: 1, offset: 0.45 },
          { transform: `translate(${dx}px, ${dy + 46}px) rotate(${rot}deg) scale(.6)`, opacity: 0 },
        ], { duration: randBetween(650, 950), easing: 'cubic-bezier(.2,.6,.4,1)' });
        anim.onfinish = () => f.remove();
      }
    },

    floatText(layer, x, y, text, big = false) {
      const el = document.createElement('span');
      el.className = `float-num${big ? ' big' : ''}`;
      el.textContent = text;
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      layer.appendChild(el);
      const anim = el.animate([
        { transform: 'translate(-50%, -50%) scale(.85)', opacity: 0 },
        { transform: 'translate(-50%, -90%) scale(1)', opacity: 1, offset: 0.15 },
        { transform: 'translate(-50%, -260%) scale(1)', opacity: 0 },
      ], { duration: big ? 1600 : 1000, easing: 'ease-out' });
      anim.onfinish = () => el.remove();
    },

    floatAt(layer, ev, text, big) {
      const r = layer.getBoundingClientRect();
      const x = ev && ev.clientX ? ev.clientX - r.left : r.width / 2;
      const y = ev && ev.clientY ? ev.clientY - r.top : r.height / 2;
      this.floatText(layer, x, y, text, big);
    },
  };

  /* ------------------------------------------------------------------------
   * Screens: intro, away summary, settings, stats, codex, Nixon preview
   * --------------------------------------------------------------------- */
  function showIntro() {
    Modal.open({
      kicker: 'MISSION BRIEFING · JANUARY 24, 1848',
      title: "Gold at Sutter's Mill",
      body: `<p>A carpenter has spotted flakes of gold in the American River. Within months the world will rush to California, and the young United States will build its money on what comes out of the ground.</p>
        <ul class="brief">
          <li>${A.uiIcon('pick')}<span><b>Strike the vein</b> to mine your first ounces by hand.</span></li>
          <li>${A.uiIcon('chart')}<span><b>Build operations</b>, from a lone prospector to the Treasury's vaults. Research transforms every site.</span></li>
          <li>${A.uiIcon('clock')}<span><b>History advances</b> as you mine. Each milestone adds +${Math.round(E.MILESTONE_BONUS * 100)}% output and unlocks new policy.</span></li>
          <li>${A.uiIcon('book')}<span>Hover or tap <span class="term" data-tip="term:specie" tabindex="0">underlined terms</span> to learn the real economics behind the game.</span></li>
          <li>${A.uiIcon('lock')}<span>Grow toward 1971, when the gold window closes and the Fiat Era begins.</span></li>
        </ul>`,
      actions: [{ label: 'Begin extraction', primary: true }],
      onClose: () => { G.state.flags.introSeen = true; save(); },
    });
  }

  function showWelcomeBack(sum) {
    const ms = sum.milestones;
    Modal.open({
      kicker: 'WHILE YOU WERE AWAY',
      title: `${fmtTime(sum.seconds)} of unattended extraction`,
      body: `<div class="big-figure">+${esc(fmt(sum.gained, 1))} <small>oz</small></div>
        <p>Your operations kept running while you were gone, starting at ${esc(fmt(sum.rate, 1))} oz/s${sum.capped ? ' (offline time is capped at 30 days)' : ''}.</p>
        ${ms.length ? `<p>History moved on: <b>${esc(E.dateLabel(sum.yearFrom))}</b> → <b>${esc(E.dateLabel(sum.yearTo))}</b></p>
          <ul class="ms-list">${ms.map((m) => `<li><span class="yr">${Math.floor(m.year)}</span><span>${esc(m.title)}</span></li>`).join('')}</ul>` : ''}`,
      actions: [{ label: 'Back to work', primary: true }],
    });
  }

  function runOffline(seconds) {
    const s = G.state;
    const before = { gold: s.run.gold, year: E.yearFor(s.run.gold), rate: E.derive(s).rate };
    const capped = seconds >= E.MAX_OFFLINE_SECONDS;
    const events = advance(Math.min(seconds, E.MAX_OFFLINE_SECONDS), 'offline');
    const milestones = events.filter((e) => e.type === 'milestone').map((e) => e.milestone);
    G.awayMilestones = [];
    return { seconds, capped, gained: s.run.gold - before.gold, rate: before.rate, yearFrom: before.year, yearTo: E.yearFor(s.run.gold), milestones };
  }

  function onVisibility() {
    if (document.hidden) {
      catchUp();
      G.away = { at: Date.now(), gold: G.state.run.gold, year: E.yearFor(G.state.run.gold), rate: G.d ? G.d.rate : 0 };
      G.awayMilestones = [];
      save();
      return;
    }
    catchUp();
    const away = G.away;
    G.away = null;
    G.lastFrame = 0;
    if (!away) return;
    const seconds = (Date.now() - away.at) / 1000;
    if (seconds >= AWAY_NOTICE_S && !Modal.isOpen) {
      showWelcomeBack({ seconds, capped: false, gained: G.state.run.gold - away.gold, rate: away.rate, yearFrom: away.year, yearTo: E.yearFor(G.state.run.gold), milestones: G.awayMilestones.slice() });
    }
    G.awayMilestones = [];
  }

  function applySettings() {
    const st = G.state.settings;
    E.setNotation(st.notation);
    document.body.classList.toggle('reduce-motion', st.motion === 'reduced');
    document.body.dataset.era = G.state.era;
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
          const val = key === 'sound' ? b.dataset.val === 'true' : b.dataset.val;
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
          io.placeholder = 'Paste an exported save string (starts with FFC1:)';
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
            toast({ kicker: 'LEDGER', title: 'Save imported', text: 'Welcome back to your empire.', icon: A.uiIcon('download') });
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
    G.d = E.derive(G.state);
    G.year = E.yearFor(G.state.run.gold);
    View.resetAll();
    Ticker.init();
    Spark.reset();
    save();
  }

  function showStats() {
    const s = G.state, d = G.d;
    const built = E.BUILDINGS.reduce((a, b) => a + s.run.buildings[b.id], 0);
    const researched = Object.keys(s.run.upgrades).length;
    const share = s.stats.lifetimeGold / E.GOLD_EVER_MINED_OZ;
    const studied = Object.keys(s.codex).length;
    const rows = [
      ['Gold mined this era', `${fmt(s.run.gold, 1)} oz`],
      ['Gold mined, lifetime', `${fmt(s.stats.lifetimeGold, 1)} oz`],
      ['Versus all gold ever mined (≈6.95B oz)', share >= 1 ? `${fmt(share, 1)}×` : `${(share * 100).toPrecision(3)}%`],
      ['Gold from strikes', `${fmt(s.run.clickGold, 1)} oz`],
      ['Strikes this era / lifetime', `${fmt(s.run.clicks)} / ${fmt(s.stats.totalClicks)}`],
      ['Lucky strikes claimed', fmt(s.stats.luckyStrikes)],
      ['Sites built', fmt(built)],
      ['Research completed', `${researched} / ${E.UPGRADES.length}`],
      ['Historical milestones', `${d.milestones - 1} / ${E.MILESTONES.length - 1}`],
      ['Output multiplier (policy × history)', `×${(d.globalMult * d.milestoneMult).toFixed(2)}`],
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
      const match = ([id, t]) => !ql || t.title.toLowerCase().includes(ql) || t.body.toLowerCase().includes(ql);
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
    const cred = E.NIXON.credibility(G.state.run.gold);
    Modal.open({
      kicker: 'PHASE II · CLASSIFIED',
      title: 'The Nixon Shock is being drafted',
      body: `<p>Your vaults hold enough gold to close the window. In the next build, severing the peg locks the vaults, resets your gold empire, and awards <b>${cred} Central Bank Credibility</b> to spend in the Fiat Era: interest rates, fractional reserve banking and the petrodollar.</p>
        <p class="muted">Your progress is saved. Keep mining to raise the Credibility you will carry forward. It grows with the cube root of gold mined this era.</p>`,
      actions: [{ label: 'Keep mining', primary: true }],
    });
  }

  /* ------------------------------------------------------------------------
   * Debug tools (?debug): fast-forward for development and testing.
   * --------------------------------------------------------------------- */
  const Debug = {
    give(n) {
      const events = [];
      E.earn(G.state, n);
      E.checkMilestones(G.state, (e) => events.push(e));
      handleEvents(events, 'live');
    },
    buildings(n) {
      E.BUILDINGS.forEach((b) => { if (E.isBuildingVisible(G.state, b, E.yearFor(G.state.run.gold))) G.state.run.buildings[b.id] += n; });
    },
    research() {
      for (let pass = 0; pass < 6; pass++) E.availableUpgrades(G.state).forEach((u) => { G.state.run.upgrades[u.id] = true; });
    },
    warp(seconds) {
      const sum = runOffline(seconds);
      showWelcomeBack(sum);
    },
    lucky() { Lucky.forceSpawn(); },
    era() { G.state.era = G.state.era === 'gold' ? 'fiat' : 'gold'; applySettings(); },
    mount() {
      const el = document.createElement('div');
      el.className = 'debug';
      const btns = [
        ['+1K oz', () => this.give(1e3)], ['+1M oz', () => this.give(1e6)], ['+1B oz', () => this.give(1e9)], ['+1T oz', () => this.give(1e12)],
        ['+10 sites', () => this.buildings(10)], ['+50 sites', () => this.buildings(50)], ['research all', () => this.research()],
        ['warp 1h', () => this.warp(3600)], ['lucky', () => this.lucky()], ['fiat theme', () => this.era()],
      ];
      el.innerHTML = '<b>DEBUG</b>';
      btns.forEach(([label, fn]) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = label;
        b.addEventListener('click', () => { fn(); G.d = E.derive(G.state); G.year = E.yearFor(G.state.run.gold); View.slow(); });
        el.appendChild(b);
      });
      document.body.appendChild(el);
    },
  };

  /* ------------------------------------------------------------------------
   * Main loop
   * --------------------------------------------------------------------- */
  function frame(ts) {
    const dtFrame = G.lastFrame ? Math.min(0.25, (ts - G.lastFrame) / 1000) : 0;
    G.lastFrame = ts;
    catchUp();
    G.d = E.derive(G.state);
    G.year = E.yearFor(G.state.run.gold);
    View.frame();
    Ticker.update(dtFrame);
    Lucky.update(dtFrame);
    G.slowAcc += dtFrame;
    if (G.slowAcc >= SLOW_TICK_S) { G.slowAcc = 0; View.slow(); }
    G.sparkAcc += dtFrame;
    if (G.sparkAcc >= SPARK_EVERY_S) { G.sparkAcc = 0; Spark.sample(); }
    requestAnimationFrame(frame);
  }

  function boot() {
    $('svg-defs').innerHTML = A.defs();
    const now = Date.now();
    const raw = Store.read();
    const problem = raw && raw.error;
    G.state = E.migrate(problem ? null : raw, now);
    G.lastSim = now;
    applySettings();
    G.d = E.derive(G.state);
    G.year = E.yearFor(G.state.run.gold);

    Tip.init();
    Modal.init();
    View.init();

    let offline = null;
    if (raw && !problem) {
      const away = (now - G.state.savedAt) / 1000;
      if (away > 1) offline = runOffline(away);
    }
    G.d = E.derive(G.state);
    G.year = E.yearFor(G.state.run.gold);
    if (!G.state.log.length) addLog("Sutter's Mill", E.MILESTONES[0].text, 'milestone', 1848);

    Ticker.init();
    Spark.init();
    Spark.sample();
    View.slow();
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
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(true); }
      if (e.key === 'Escape' && Tip.sticky) Tip.hide();
    });

    if (DEBUG) Debug.mount();
    window.FFC = { G, Economy: E, SVGAssets: A, save, debug: Debug, store: Store };

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
