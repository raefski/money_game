/* ==========================================================================
   FULL FAITH & CREDIT — svgAssets.js
   Inline vector art. Every function returns an SVG markup string.
   - Buildings: 6 visual tiers each (0 = base, 5 = gilded), drawn in a
     240×150 box with the ground line at y=128. `scene` = true omits the
     local backdrop so the same art can be placed in the territory panorama.
   - Animations are CSS classes (`an a-*`, see style.css) so reduced-motion
     settings can switch them all off. Era-themed strokes use `.nst`/`.nfl`.
   ========================================================================== */
(function (root) {
  'use strict';

  const P = {
    ink: '#0a0e15', night: '#0c1322',
    wood: '#7a5230', woodLt: '#9c6b3c', woodDk: '#4d321c', woodXdk: '#33210f',
    canvas: '#d9c9a0', canvasDk: '#a99670', canvasXdk: '#7d6d4f',
    stone: '#566070', stoneLt: '#748093', stoneDk: '#3a424f',
    iron: '#363d48', ironLt: '#5f6b7b', steel: '#8d9bad', steelLt: '#c3ccd8',
    brick: '#8b3a22', brickLt: '#a8492c', brickDk: '#5c2513',
    water: '#2a5d93', waterLt: '#5ea3e6', foam: '#cfe6ff',
    gold: '#f5c542', goldLt: '#ffe39a', goldDk: '#b07f12',
    fire: '#ff8a1f', ember: '#ffb547', window: '#ffcf5a', lamp: '#fff3c4',
    rock: '#3d3833', rockLt: '#57504a', dirt: '#2b241b', dirtLt: '#3e3426', mud: '#5a4630',
    pine: '#10271e', pineLt: '#183a2c',
    skin: '#d9a77c', shirt: '#a33f32', shirt2: '#3f6e8c', shirt3: '#6b7a3a', denim: '#2c4468', hat: '#5e4328', beard: '#6b4a2e',
    smoke: '#8f9aab', steam: '#dfe7f1',
    marble: '#c9ccd2', marbleDk: '#9ea3ad', granite: '#6f747c', graniteLt: '#868b93', graniteDk: '#4e535b',
  };

  /* ---------------------------------------------------------------------
   * Markup helpers
   * ------------------------------------------------------------------ */
  const n = (v) => Math.round(v * 100) / 100;
  const R = (x, y, w, h, fill, ex = '') => `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="${fill}" ${ex}/>`;
  const C = (cx, cy, r, fill, ex = '') => `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" fill="${fill}" ${ex}/>`;
  const El = (cx, cy, rx, ry, fill, ex = '') => `<ellipse cx="${n(cx)}" cy="${n(cy)}" rx="${n(rx)}" ry="${n(ry)}" fill="${fill}" ${ex}/>`;
  const L = (x1, y1, x2, y2, stroke, w = 1, ex = '') => `<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" stroke="${stroke}" stroke-width="${w}" ${ex}/>`;
  const Pa = (d, fill, ex = '') => `<path d="${d}" fill="${fill}" ${ex}/>`;
  const St = (d, stroke, w = 1, ex = '') => `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${w}" ${ex}/>`;
  const Po = (pts, fill, ex = '') => `<polygon points="${pts}" fill="${fill}" ${ex}/>`;
  const G = (inner, tr = '', ex = '') => `<g${tr ? ` transform="${tr}"` : ''}${ex ? ' ' + ex : ''}>${inner}</g>`;
  const Tx = (x, y, s, size, fill, ex = '') => `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" font-family="JetBrains Mono, ui-monospace, monospace" font-weight="700" text-anchor="middle" ${ex}>${s}</text>`;
  const an = (cls, delay) => `class="an ${cls}"${delay ? ` style="animation-delay:${delay}s"` : ''}`;
  const repeat = (count, fn) => Array.from({ length: count }, (_, i) => fn(i)).join('');

  /** Small deterministic RNG so decorative scatter is stable across renders. */
  function rng(seed) {
    let s = seed >>> 0;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }

  /* ---------------------------------------------------------------------
   * Shared gradients, patterns and filters (injected once into the page).
   * ------------------------------------------------------------------ */
  function defs() {
    return `<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs>
      <linearGradient id="ffc-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#04070d"/><stop offset=".55" stop-color="#0b1424"/><stop offset="1" stop-color="#18233a"/></linearGradient>
      <linearGradient id="ffc-cardsky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#070b13"/><stop offset="1" stop-color="#121b2d"/></linearGradient>
      <linearGradient id="ffc-ground" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2b2319"/><stop offset="1" stop-color="#14100b"/></linearGradient>
      <linearGradient id="ffc-valley" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1e1a14"/><stop offset="1" stop-color="#0f0c08"/></linearGradient>
      <linearGradient id="ffc-water" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2f6aa6"/><stop offset="1" stop-color="#173a63"/></linearGradient>
      <linearGradient id="ffc-rockface" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6b5440"/><stop offset="1" stop-color="#3a2e23"/></linearGradient>
      <linearGradient id="ffc-under" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2c241b"/><stop offset="1" stop-color="#15110c"/></linearGradient>
      <linearGradient id="ffc-goldgrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff1b8"/><stop offset=".45" stop-color="#f5c542"/><stop offset="1" stop-color="#9c6b0c"/></linearGradient>
      <linearGradient id="ffc-steelgrad" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#4b5462"/><stop offset=".5" stop-color="#a9b4c2"/><stop offset="1" stop-color="#434b58"/></linearGradient>
      <linearGradient id="ffc-granite" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8a8f97"/><stop offset="1" stop-color="#5a5f67"/></linearGradient>
      <linearGradient id="ffc-beam" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#fff6cf" stop-opacity=".55"/><stop offset="1" stop-color="#fff6cf" stop-opacity="0"/></linearGradient>
      <linearGradient id="ffc-smog" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6b4f2c" stop-opacity="0"/><stop offset=".55" stop-color="#7a5a31" stop-opacity=".35"/><stop offset="1" stop-color="#3b2a17" stop-opacity=".55"/></linearGradient>
      <linearGradient id="ffc-gildwash" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#f5c542" stop-opacity=".28"/><stop offset=".6" stop-color="#f5c542" stop-opacity="0"/></linearGradient>
      <radialGradient id="ffc-glow"><stop offset="0" stop-color="#ffd36b" stop-opacity=".85"/><stop offset="1" stop-color="#ffd36b" stop-opacity="0"/></radialGradient>
      <radialGradient id="ffc-fireglow"><stop offset="0" stop-color="#ff9a2e" stop-opacity=".75"/><stop offset="1" stop-color="#ff7a00" stop-opacity="0"/></radialGradient>
      <radialGradient id="ffc-whiteglow"><stop offset="0" stop-color="#fffbe6" stop-opacity=".9"/><stop offset="1" stop-color="#fffbe6" stop-opacity="0"/></radialGradient>
      <radialGradient id="ffc-moonglow"><stop offset="0" stop-color="#f3e7c4" stop-opacity=".35"/><stop offset="1" stop-color="#f3e7c4" stop-opacity="0"/></radialGradient>
      <radialGradient id="ffc-nuggetglow"><stop offset="0" stop-color="#ffcf4a" stop-opacity=".45"/><stop offset=".6" stop-color="#ffb000" stop-opacity=".12"/><stop offset="1" stop-color="#ffb000" stop-opacity="0"/></radialGradient>
      <pattern id="ffc-grid" width="12" height="12" patternUnits="userSpaceOnUse"><path d="M12 0H0V12" fill="none" stroke="#9fb4d8" stroke-opacity=".05"/></pattern>
      <pattern id="ffc-bricks" width="8" height="6" patternUnits="userSpaceOnUse"><path d="M0 .5H8M0 3.5H8M2 .5V3.5M6 3.5V6.5" fill="none" stroke="#3a1608" stroke-opacity=".55" stroke-width=".6"/></pattern>
      <pattern id="ffc-logs" width="10" height="4" patternUnits="userSpaceOnUse"><path d="M0 3.6H10" stroke="#2a1a0c" stroke-width=".9"/><path d="M0 1H10" stroke="#a7774a" stroke-opacity=".35" stroke-width=".5"/></pattern>
      <pattern id="ffc-planks" width="5" height="10" patternUnits="userSpaceOnUse"><path d="M4.6 0V10" stroke="#2a1a0c" stroke-opacity=".7" stroke-width=".6"/></pattern>
      <pattern id="ffc-corrugated" width="3" height="10" patternUnits="userSpaceOnUse"><path d="M1.5 0V10" stroke="#000" stroke-opacity=".28" stroke-width="1"/></pattern>
      <pattern id="ffc-stones" width="14" height="7" patternUnits="userSpaceOnUse"><path d="M0 6.6H14M7 0V6.6" fill="none" stroke="#2f343b" stroke-opacity=".45" stroke-width=".5"/></pattern>
      <filter id="ffc-soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="1.4"/></filter>
      <filter id="ffc-neon" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="1.6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    </defs></svg>`;
  }

  /* ---------------------------------------------------------------------
   * Reusable components
   * ------------------------------------------------------------------ */
  function glint(x, y, s = 1, delay = 0) {
    const a = 3 * s, b = 0.8 * s;
    return `<path ${an('a-glint', delay)} d="M${n(x)} ${n(y - a)}L${n(x + b)} ${n(y - b)}L${n(x + a)} ${n(y)}L${n(x + b)} ${n(y + b)}L${n(x)} ${n(y + a)}L${n(x - b)} ${n(y + b)}L${n(x - a)} ${n(y)}L${n(x - b)} ${n(y - b)}Z" fill="${P.goldLt}"/>`;
  }

  function smoke(x, y, count = 3, s = 1, color = P.smoke, dur = 4) {
    return repeat(count, (i) => `<circle class="an a-smoke" style="animation-delay:${n((i * dur) / count)}s;animation-duration:${dur}s" cx="${n(x)}" cy="${n(y)}" r="${n(4 * s)}" fill="${color}" opacity="0"/>`);
  }

  function fire(x, y, s = 1) {
    return G(`${C(0, -5, 16, 'url(#ffc-fireglow)')}
      ${L(-7, -1, 7, -3, P.woodDk, 2.2)}${L(-7, -3, 7, -1, P.wood, 2.2)}
      <path ${an('a-flicker')} d="M0 -14C4 -9 6 -6 3.5 -2L-3.5 -2C-6 -6 -2.5 -8 0 -14Z" fill="${P.fire}"/>
      <path ${an('a-flicker', 0.35)} d="M0 -9C2.2 -6 2.4 -4 1.2 -2L-1.2 -2C-2.4 -4 -1.3 -6 0 -9Z" fill="${P.lamp}"/>`, `translate(${n(x)} ${n(y)}) scale(${s})`);
  }

  function lantern(x, y, h = 18) {
    return `${L(x, y, x, y - h, P.woodDk, 1.5)}${L(x - 0.5, y - h, x + 5, y - h, P.woodDk, 1.3)}
      <circle ${an('a-flicker', (x % 7) / 5)} cx="${n(x + 4.5)}" cy="${n(y - h + 5)}" r="8" fill="url(#ffc-glow)"/>
      ${R(x + 3, y - h + 2.5, 3, 4.2, P.window, 'rx=".8"')}`;
  }

  function tent(x, y, w = 26, h = 18, color = P.canvas) {
    const hw = w / 2;
    return `${Pa(`M${x - hw} ${y}L${x} ${y - h}L${x + hw} ${y}Z`, color)}
      ${Pa(`M${x} ${y - h}L${x + hw} ${y}L${x + hw * 0.55} ${y}Z`, P.canvasDk)}
      ${Pa(`M${x - hw * 0.28} ${y}L${x} ${y - h * 0.58}L${x + hw * 0.28} ${y}Z`, P.ink, 'opacity=".8"')}
      ${L(x, y - h - 2.5, x, y - h + 1, P.woodDk, 1.3)}
      ${L(x - hw - 2, y, x - hw + 1, y - 2, P.canvasXdk, 0.8)}${L(x + hw + 2, y, x + hw - 1, y - 2, P.canvasXdk, 0.8)}`;
  }

  function pine(x, y, h = 30, color = P.pine) {
    const w = h * 0.5;
    return `${R(x - 1, y - h * 0.18, 2, h * 0.18, P.woodXdk)}
      ${Pa(`M${n(x)} ${n(y - h)}L${n(x + w * 0.42)} ${n(y - h * 0.58)}L${n(x + w * 0.2)} ${n(y - h * 0.6)}L${n(x + w * 0.6)} ${n(y - h * 0.32)}L${n(x + w * 0.28)} ${n(y - h * 0.34)}L${n(x + w * 0.75)} ${n(y - h * 0.14)}L${n(x - w * 0.75)} ${n(y - h * 0.14)}L${n(x - w * 0.28)} ${n(y - h * 0.34)}L${n(x - w * 0.6)} ${n(y - h * 0.32)}L${n(x - w * 0.2)} ${n(y - h * 0.6)}L${n(x - w * 0.42)} ${n(y - h * 0.58)}Z`, color)}`;
  }

  function rocks(x, y, s = 1, color = P.rockLt) {
    return `${Pa(`M${x} ${y}l${2 * s} ${-4 * s}l${5 * s} ${-1 * s}l${3 * s} ${5 * s}Z`, color)}${Pa(`M${x + 9 * s} ${y}l${2 * s} ${-2.5 * s}l${3 * s} ${0.5 * s}l${1 * s} ${2 * s}Z`, P.rock)}`;
  }

  function barrel(x, y, s = 1) {
    return G(`${Pa('M-4 0Q-5 -5 -4 -10L4 -10Q5 -5 4 0Z', P.wood)}${L(-4.6, -3, 4.6, -3, P.iron, 0.9)}${L(-4.6, -7, 4.6, -7, P.iron, 0.9)}${El(0, -10, 4, 1, P.woodLt)}`, `translate(${x} ${y}) scale(${s})`);
  }

  function crate(x, y, s = 1) {
    return G(`${R(-5, -9, 10, 9, P.woodLt)}${St('M-5 -9L5 0M5 -9L-5 0', P.woodDk, 0.8)}${R(-5, -9, 10, 9, 'none', `stroke="${P.woodDk}" stroke-width=".8"`)}`, `translate(${x} ${y}) scale(${s})`);
  }

  function goldPile(x, y, s = 1) {
    return G(`${Pa('M-7 0Q-5 -4 -2 -4Q0 -7 3 -4Q6 -4 7 0Z', 'url(#ffc-goldgrad)')}${C(-2, -3, 0.8, P.lamp)}${C(3, -4, 0.6, P.lamp)}`, `translate(${x} ${y}) scale(${s})`);
  }

  /** A miner. `pose`: stand | crouch (panning) | shovel | pick | lever. Feet at (x,y). */
  function miner(x, y, s = 1, pose = 'stand', shirt = P.shirt, flip = false) {
    let b = '';
    const boot = P.ink;
    const head = (hx, hy) => `${C(hx, hy, 3, P.skin)}${Pa(`M${hx - 2.6} ${hy + 0.8}Q${hx} ${hy + 4.4} ${hx + 2.6} ${hy + 0.8}Z`, P.beard)}${El(hx, hy - 2.4, 5.2, 1.2, P.hat)}${R(hx - 3, hy - 6.2, 6, 4, P.hat, 'rx="1.2"')}${R(hx - 3, hy - 3.4, 6, 0.9, P.woodXdk)}`;
    if (pose === 'crouch') {
      b += Pa('M-6 0L-6 -8L1 -9L3 -2L8 -2L8 0Z', P.denim);
      b += R(-7.5, -1.6, 4.5, 1.6, boot) + R(5, -1.6, 4, 1.6, boot);
      b += Pa('M-6 -8L2 -9L5 -17L-2.5 -18.5Z', shirt);
      b += L(3, -15.5, 9.5, -10, shirt, 2.4, 'stroke-linecap="round"');
      b += head(3, -21);
      b += El(12.5, -9.2, 6.4, 1.9, '#3a3f47') + El(12.5, -9.7, 4.8, 1.1, '#1d2127');
      b += C(11.5, -9.7, 0.9, P.gold) + C(14, -9.4, 0.6, P.goldLt);
    } else if (pose === 'shovel') {
      b += R(-3.2, -10, 2.8, 10, P.denim) + R(0.6, -10, 2.8, 10, P.denim, 'transform="rotate(-12 2 -10)"');
      b += R(-3.6, -1.4, 3.6, 1.4, boot) + R(1.8, -1.4, 3.6, 1.4, boot);
      b += Pa('M-4 -10L4 -10L5 -19L-3.5 -19.5Z', shirt);
      b += L(3, -17, 9, -11, shirt, 2.2, 'stroke-linecap="round"');
      b += L(-1, -17, 7, -12, shirt, 2.2, 'stroke-linecap="round"');
      b += L(2, -24, 14, -2, P.woodLt, 1.4) + Pa('M12.5 -4.5L17 -1L14.5 2.5L10.5 -1Z', P.ironLt);
      b += head(0.5, -22.5);
    } else if (pose === 'pick') {
      b += R(-3.4, -10, 2.8, 10, P.denim) + R(0.6, -10, 2.8, 10, P.denim);
      b += R(-3.8, -1.4, 3.6, 1.4, boot) + R(0.4, -1.4, 3.6, 1.4, boot);
      b += Pa('M-4 -10L4 -10L4.5 -19L-4.5 -19Z', shirt);
      b += L(-3, -18, -1, -27, shirt, 2.2, 'stroke-linecap="round"') + L(3, -18, 1, -27, shirt, 2.2, 'stroke-linecap="round"');
      b += L(0, -27, 9, -35, P.woodLt, 1.4) + St('M3 -39Q9 -38 13 -31', P.ironLt, 1.8);
      b += head(0, -22);
    } else if (pose === 'lever') {
      b += R(-3.2, -10, 2.8, 10, P.denim) + R(0.4, -10, 2.8, 10, P.denim);
      b += R(-3.6, -1.4, 3.4, 1.4, boot) + R(0.2, -1.4, 3.6, 1.4, boot);
      b += Pa('M-4 -10L4 -10L4.6 -19L-4.4 -19Z', shirt);
      b += L(3, -17, 10, -15, shirt, 2.2, 'stroke-linecap="round"');
      b += head(0, -22);
    } else {
      b += R(-3.2, -10, 2.8, 10, P.denim) + R(0.4, -10, 2.8, 10, P.denim);
      b += R(-3.6, -1.4, 3.4, 1.4, boot) + R(0.2, -1.4, 3.4, 1.4, boot);
      b += Pa('M-4 -10L4 -10L4.5 -19L-4.5 -19Z', shirt);
      b += R(-6.2, -18.5, 2.2, 8, shirt, 'rx="1"') + R(4, -18.5, 2.2, 8, shirt, 'rx="1"');
      b += head(0, -22);
    }
    return G(b, `translate(${n(x)} ${n(y)}) scale(${flip ? -s : s} ${s})`);
  }

  function waterWheel(cx, cy, r, color = P.wood) {
    const spokes = repeat(8, (i) => {
      const a = (i / 8) * Math.PI * 2;
      const x2 = Math.cos(a) * r, y2 = Math.sin(a) * r;
      return L(0, 0, x2, y2, color, 1.4) + R(n(x2 - 2.2), n(y2 - 2.2), 4.4, 4.4, P.woodLt, `transform="rotate(${n((a * 180) / Math.PI)} ${n(x2)} ${n(y2)})"`);
    });
    return G(`<g class="an a-spin">${C(0, 0, r, 'none', `stroke="${color}" stroke-width="2.2"`)}${C(0, 0, r * 0.62, 'none', `stroke="${P.woodDk}" stroke-width="1.2"`)}${spokes}${C(0, 0, 2.6, P.iron)}</g>`, `translate(${n(cx)} ${n(cy)})`);
  }

  function smokestack(x, y, w, h, color = P.brick, puffs = 3, s = 1) {
    return `${R(x, y - h, w, h, color)}${R(x, y - h, w, h, 'url(#ffc-bricks)')}${R(x - 1.2, y - h, w + 2.4, 3, P.brickDk)}${R(x - 0.6, y - h * 0.62, w + 1.2, 1.6, P.brickDk)}
      ${smoke(x + w / 2, y - h - 3, puffs, s)}`;
  }

  function oreCart(x, y, s = 1, gold = true) {
    return G(`${Po('-8,-9 8,-9 6,-2 -6,-2', P.ironLt)}${L(-8, -9, 8, -9, P.steel, 0.9)}
      ${gold ? `${C(-3, -10, 2.4, P.rockLt)}${C(1.5, -10.5, 2.6, P.rock)}${C(4, -9.8, 1.6, P.gold)}` : ''}
      ${C(-4, -1.6, 1.8, P.ink)}${C(4, -1.6, 1.8, P.ink)}`, `translate(${n(x)} ${n(y)}) scale(${s})`);
  }

  function rails(x1, x2, y, tieColor = P.woodDk) {
    let ties = '';
    for (let x = x1; x <= x2; x += 6) ties += R(x, y - 1, 3, 3, tieColor);
    return `${ties}${L(x1, y - 1, x2, y - 1, P.steel, 0.9)}${L(x1, y + 1.6, x2, y + 1.6, P.steel, 0.9)}`;
  }

  function vat(x, y, w, h, staves = true) {
    return `${R(x, y - h, w, h, P.wood)}${staves ? R(x, y - h, w, h, 'url(#ffc-planks)') : ''}
      ${L(x - 0.6, y - h * 0.3, x + w + 0.6, y - h * 0.3, P.iron, 1.2)}${L(x - 0.6, y - h * 0.72, x + w + 0.6, y - h * 0.72, P.iron, 1.2)}
      ${El(x + w / 2, y - h, w / 2, 2.4, P.woodLt)}${El(x + w / 2, y - h + 0.4, w / 2 - 1.6, 1.4, '#c9d37a', 'opacity=".75"')}`;
  }

  function falseFront(x, y, w, h, sign, color = P.woodLt, signColor = P.canvas) {
    const fh = h + 8;
    return `${R(x + 2, y - h, w - 4, h, P.wood)}
      ${Pa(`M${x} ${y - h}L${x} ${y - fh + 3}L${x + 3} ${y - fh + 3}L${x + 3} ${y - fh}L${x + w - 3} ${y - fh}L${x + w - 3} ${y - fh + 3}L${x + w} ${y - fh + 3}L${x + w} ${y - h}Z`, color)}
      ${R(x, y - h, w, h, color)}${R(x, y - fh, w, fh, 'url(#ffc-planks)', 'opacity=".55"')}
      ${R(x + 3, y - fh + 4, w - 6, 7, signColor)}${Tx(x + w / 2, y - fh + 9.6, sign, 5.2, P.woodXdk)}
      ${R(x + w / 2 - 3.5, y - 12, 7, 12, P.ink)}${R(x + w / 2 - 2.5, y - 11, 5, 4, P.window, 'opacity=".55"')}
      ${R(x + 3, y - h + 4, 6, 6, P.window)}${R(x + w - 9, y - h + 4, 6, 6, P.window)}
      ${L(x + 6, y - h + 4, x + 6, y - h + 10, P.woodDk, 0.7)}${L(x + w - 6, y - h + 4, x + w - 6, y - h + 10, P.woodDk, 0.7)}
      ${Po(`${x - 2},${y - 14} ${x + w + 2},${y - 14} ${x + w + 2},${y - 12.5} ${x - 2},${y - 12.5}`, P.woodDk)}
      ${L(x, y - 12.5, x, y, P.woodDk, 1)}${L(x + w, y - 12.5, x + w, y, P.woodDk, 1)}`;
  }

  function cabin(x, y, w = 40, h = 20) {
    return `${R(x, y - h, w, h, P.wood)}${R(x, y - h, w, h, 'url(#ffc-logs)')}
      ${Po(`${x - 4},${y - h} ${x + w / 2},${y - h - 13} ${x + w + 4},${y - h}`, P.woodDk)}
      ${L(x - 4, y - h, x + w / 2, y - h - 13, P.woodLt, 1)}
      ${R(x + w * 0.62, y - h - 12, 5, 9, P.stoneDk)}${smoke(x + w * 0.62 + 2.5, y - h - 14, 3, 0.8)}
      ${R(x + 6, y - 12, 7, 12, P.woodXdk)}
      <rect ${an('a-flicker', 0.6)} x="${x + w - 15}" y="${y - h + 6}" width="8" height="7" fill="${P.window}"/>
      ${L(x + w - 11, y - h + 6, x + w - 11, y - h + 13, P.woodDk, 0.8)}`;
  }

  function claimFlag(x, y, color) {
    return `${L(x, y, x, y - 12, P.woodLt, 1)}${Po(`${x},${y - 12} ${x + 7},${y - 10} ${x},${y - 8}`, color)}`;
  }

  /** Steel lattice tower (headframes, pylons). */
  function lattice(x, yTop, yBot, wTop, wBot, color = P.steel) {
    const segs = 5;
    let out = St(`M${x - wBot / 2} ${yBot}L${x - wTop / 2} ${yTop}M${x + wBot / 2} ${yBot}L${x + wTop / 2} ${yTop}`, color, 1.6);
    for (let i = 0; i < segs; i++) {
      const t0 = i / segs, t1 = (i + 1) / segs;
      const y0 = yBot + (yTop - yBot) * t0, y1 = yBot + (yTop - yBot) * t1;
      const w0 = wBot + (wTop - wBot) * t0, w1 = wBot + (wTop - wBot) * t1;
      out += St(`M${n(x - w0 / 2)} ${n(y0)}L${n(x + w1 / 2)} ${n(y1)}M${n(x + w0 / 2)} ${n(y0)}L${n(x - w1 / 2)} ${n(y1)}M${n(x - w1 / 2)} ${n(y1)}H${n(x + w1 / 2)}`, color, 0.8);
    }
    return out;
  }

  function creek(x1, x2, y, h) {
    return `${Pa(`M${x1} ${y}Q${n(x1 + (x2 - x1) * 0.25)} ${y - 2} ${n((x1 + x2) / 2)} ${y}T${x2} ${y}L${x2} ${y + h}L${x1} ${y + h}Z`, 'url(#ffc-water)')}
      <path ${an('a-flow')} d="M${x1 + 4} ${y + 3}H${x2 - 4}" stroke="${P.waterLt}" stroke-width="1" stroke-dasharray="6 10" opacity=".75" fill="none"/>
      <path ${an('a-flow-slow')} d="M${x1 + 2} ${n(y + h * 0.62)}H${x2 - 2}" stroke="${P.foam}" stroke-width=".8" stroke-dasharray="2 14" opacity=".5" fill="none"/>`;
  }

  function cardBackdrop(seed = 1) {
    const r = rng(seed);
    const stars = repeat(14, () => C(n(r() * 240), n(r() * 60), n(0.3 + r() * 0.6), '#dfe8ff', `opacity="${n(0.25 + r() * 0.5)}"`));
    const ridge = 'M0 98L26 82L50 90L82 68L110 84L140 72L172 88L204 74L240 92';
    return `${R(0, 0, 240, 150, 'url(#ffc-cardsky)')}${R(0, 0, 240, 150, 'url(#ffc-grid)')}${stars}
      ${Pa(`${ridge}L240 150L0 150Z`, '#111a29')}${St(ridge, 'currentColor', 0.7, 'class="nst" opacity=".28"')}
      ${R(0, 128, 240, 22, 'url(#ffc-ground)')}${L(0, 128.5, 240, 128.5, P.dirtLt, 1)}`;
  }

  /* ---------------------------------------------------------------------
   * Buildings. ART[id](tier, scene) → inner SVG markup.
   * ------------------------------------------------------------------ */
  const ART = {};

  ART.prospector = (t, scene) => {
    let s = '';
    if (!scene) s += creek(0, 240, 131, 19) + rocks(8, 131) + rocks(96, 131, 0.8) + rocks(204, 131, 0.9);
    if (t >= 4) {
      s += [24, 70, 128, 176, 226].map((x, i) => claimFlag(x, scene ? 116 : 104 + (i % 2) * 3, i % 2 ? P.shirt : P.gold)).join('');
    }
    if (t >= 2) {
      s += tent(34, 128, 30, 22) + fire(58, 128, 0.85) + barrel(74, 128) + crate(85, 128) + crate(85, 119, 0.8);
    }
    if (t >= 3) {
      // Long Tom: a 12-foot trough on legs, worked by a second miner
      s += L(200, 110, 200, 128, P.woodDk, 1.6) + L(232, 117, 232, 128, P.woodDk, 1.6) + L(216, 113, 216, 128, P.woodDk, 1.4);
      s += Po('194,104 238,113 238,118 194,109', P.wood);
      s += `<path ${an('a-flow')} d="M196 106.5L236 114.5" stroke="${P.waterLt}" stroke-width="1.6" stroke-dasharray="4 4" fill="none"/>`;
      s += miner(188, 128, 1, 'shovel', P.shirt3);
    }
    if (t >= 4) s += lantern(14, 128, 20) + miner(100, 128, 1, 'pick', P.shirt2) + lantern(160, 128, 18);
    // gravel pile & shovel (base)
    s += Pa('M136 128Q150 114 166 128Z', P.dirtLt) + C(146, 124, 1, P.rockLt) + C(154, 122, 0.8, P.gold);
    s += L(156, 102, 150, 124, P.woodLt, 1.4) + Po('147,121 153,124 151,130 145,127', P.ironLt);
    if (t >= 1) {
      // rocker box ("cradle")
      s += G(`${St('M-12 0Q0 6 12 0', P.woodDk, 2.2)}${Po('-12,-12 12,-12 10,-1 -10,-1', P.wood)}${R(-12, -12, 24, 11, 'url(#ffc-planks)', 'opacity=".5"')}
        ${Po('-13,-16 4,-16 2,-12 -11,-12', P.woodLt)}${L(10, -12, 16, -22, P.woodLt, 1.4)}
        <path ${an('a-flow')} d="M-9 -4H9" stroke="${P.waterLt}" stroke-width="1.2" stroke-dasharray="3 3" fill="none"/>`.replace(/^/, '<g class="an a-rock">') + '</g>', 'translate(180 125)');
    }
    s += miner(118, 131, 1.05, 'crouch', P.shirt);
    s += glint(131, 120, 0.9, 0.2) + (t >= 1 ? glint(176, 104, 0.8, 1.1) : '') + (t >= 3 ? glint(226, 104, 0.8, 1.7) : '');
    return s;
  };

  ART.sluice = (t, scene) => {
    let s = '';
    if (!scene) {
      s += Pa('M0 128L0 70L28 64L58 78L80 100L98 128Z', P.dirtLt) + Pa('M0 70L28 64L58 78L80 100', 'none', `stroke="${P.rockLt}" stroke-width="1"`);
      s += pine(14, 68, 22, P.pineLt) + creek(0, 240, 132, 18) + rocks(118, 132, 0.8);
    }
    if (t >= 3) {
      // trestle flume carrying water from the hills
      s += [14, 38, 60].map((x, i) => {
        const top = 52 + i * 12;
        return L(x - 5, 128, x, top, P.woodDk, 1.4) + L(x + 5, 128, x, top, P.woodDk, 1.4) + L(x - 4, 116, x + 4, top + 16, P.woodDk, 0.8);
      }).join('');
      s += Po('0,46 72,84 72,90 0,52', P.wood);
      s += `<path ${an('a-flow')} d="M2 48.5L70 85" stroke="${P.waterLt}" stroke-width="2" stroke-dasharray="6 6" fill="none"/>`;
      // second, parallel sluice behind
      s += Po('82,88 200,114 200,119 82,93', P.woodDk) + L(120, 98, 120, 128, P.woodXdk, 1.4) + L(176, 110, 176, 128, P.woodXdk, 1.4);
    }
    if (t >= 4) {
      s += R(204, 98, 34, 30, P.brick) + R(204, 98, 34, 30, 'url(#ffc-bricks)') + Po('202,98 221,88 240,98', P.brickDk);
      s += smokestack(228, 88, 6, 30, P.brickDk, 3, 0.9);
      s += `<rect ${an('a-flicker')} x="210" y="106" width="7" height="8" fill="${P.window}"/>`;
      s += St('M206 104V40H6V46', 'url(#ffc-steelgrad)', 3.2) + St('M206 104V40H6V46', P.ironLt, 0.6, 'stroke-dasharray="1 9"');
    }
    if (t >= 2) {
      s += waterWheel(34, 112, 18, P.wood) + Po('46,95 74,93 74,96 46,98', P.woodLt);
      s += `<path ${an('a-flow')} d="M48 96H72" stroke="${P.waterLt}" stroke-width="1.2" stroke-dasharray="3 3" fill="none"/>`;
    }
    // the sluice itself
    const x1 = t >= 1 ? 66 : 72, y1 = t >= 1 ? 92 : 96, x2 = t >= 1 ? 214 : 192, y2 = t >= 1 ? 126 : 121;
    s += L(104, 104, 98, 128, P.woodDk, 1.6) + L(104, 104, 112, 128, P.woodDk, 1.6);
    s += L(158, 116, 154, 128, P.woodDk, 1.6) + L(158, 116, 164, 128, P.woodDk, 1.6);
    s += Po(`${x1},${y1} ${x2},${y2} ${x2},${y2 + 6} ${x1},${y1 + 6}`, P.wood);
    s += Po(`${x1},${y1} ${x2},${y2} ${x2},${y2 + 1.4} ${x1},${y1 + 1.4}`, t >= 4 ? P.steel : P.woodLt);
    s += `<path ${an('a-flow')} d="M${x1 + 2} ${y1 + 3.2}L${x2 - 2} ${y2 + 3.2}" stroke="${P.waterLt}" stroke-width="2" stroke-dasharray="4 4" fill="none"/>`;
    if (t >= 1) {
      for (let i = 1; i < 9; i++) {
        const xx = x1 + ((x2 - x1) * i) / 9, yy = y1 + ((y2 - y1) * i) / 9;
        s += L(xx, yy + 1.5, xx + 1.2, yy + 6, P.woodXdk, 1.1);
      }
      s += G(`${R(-2.5, -7, 5, 7, P.steelLt, 'rx="1.2"')}${R(-1, -9.5, 2, 3, P.steel)}`, 'translate(224 129)');
    }
    s += `<path ${an('a-flow')} d="M${x2} ${y2 + 3}Q${x2 + 4} ${y2 + 4} ${x2 + 5} ${y2 + 10}" stroke="${P.waterLt}" stroke-width="1.6" stroke-dasharray="2 2" fill="none"/>`;
    s += Pa(`M${x1 - 14} ${y1 + 1}Q${x1 - 6} ${y1 - 8} ${x1 + 4} ${y1 + 1}Z`, P.dirtLt);
    s += miner(x1 - 12, y1 - (scene ? 0 : -1), 1, 'shovel', P.shirt2);
    s += glint(x1 + (x2 - x1) * 0.4, y1 + (y2 - y1) * 0.4 - 1, 0.8, 0.4) + glint(x1 + (x2 - x1) * 0.7, y1 + (y2 - y1) * 0.7 - 1, 0.7, 1.3);
    if (t >= 1) s += glint(x1 + (x2 - x1) * 0.55, y1 + (y2 - y1) * 0.55 + 1, 0.7, 2.1);
    return s;
  };

  ART.camp = (t, scene) => {
    let s = '';
    if (!scene) s += pine(16, 128, 34, P.pineLt) + pine(200, 128, 28) + pine(232, 128, 38, P.pineLt);
    if (t >= 2) s += falseFront(6, 128, 42, 26, 'STORE') + barrel(52, 128, 0.9) + crate(52, 120, 0.7);
    if (t >= 3) s += falseFront(58, 128, 38, 30, 'ASSAY', P.woodDk, P.goldLt);
    s += tent(t >= 3 ? 112 : 102, 128, 26, 19) + tent(t >= 3 ? 128 : 132, 128, 22, 16, P.canvasDk);
    s += fire(t >= 3 ? 104 : 118, 136, 0.8);
    if (t >= 1) s += cabin(144, 128, 42, 22);
    if (t >= 3) s += lantern(100, 128, 18) + lantern(140, 128, 18) + Po('0,128 240,128 240,131 0,131', P.woodDk) + R(0, 128, 240, 3, 'url(#ffc-planks)', 'opacity=".6"');
    if (t >= 4) {
      // railroad depot: water tower + rails + locomotive
      s += L(196, 128, 200, 96, P.woodDk, 1.6) + L(228, 128, 224, 96, P.woodDk, 1.6) + L(198, 112, 226, 112, P.woodDk, 1);
      s += R(194, 76, 36, 20, P.woodLt) + R(194, 76, 36, 20, 'url(#ffc-planks)') + Po('192,76 212,66 232,76', P.woodDk) + L(194, 82, 230, 82, P.iron, 1) + L(194, 90, 230, 90, P.iron, 1);
      s += rails(0, 240, 142);
      s += G(`${R(0, -14, 22, 10, P.iron)}${R(14, -22, 9, 8, P.iron)}${R(-6, -12, 6, 8, P.ironLt)}${Po('-6,-4 -11,0 -6,0', P.steel)}${R(2, -20, 4, 6, P.iron)}
        ${C(4, -2, 3, P.ink)}${C(12, -2, 3, P.ink)}${C(19, -2.5, 2.4, P.ink)}${C(-3, -12, 2.5, P.lamp)}${smoke(4, -24, 3, 0.9)}`, 'translate(150 142)');
    } else if (!scene) {
      s += Pa('M0 140Q120 136 240 141', 'none', `stroke="${P.dirtLt}" stroke-width="2" stroke-dasharray="3 5"`);
    }
    if (t >= 5) s += lantern(186, 128, 20);
    s += t >= 2 ? miner(t >= 3 ? 92 : 86, 128, 1, 'stand', P.shirt2) : miner(88, 128, 1, 'stand', P.shirt2);
    if (t < 3) s += lantern(156 + (t >= 1 ? 36 : 0), 128, 18);
    return s;
  };

  ART.hydraulic = (t, scene) => {
    let s = '';
    const eroded = t >= 4;
    // gravel cliff (kept in scene mode: the jets need a target)
    s += Pa(`M148 128L154 102L${eroded ? 140 : 146} 82L158 60L188 50L240 46L240 128Z`, 'url(#ffc-rockface)');
    s += Pa(eroded ? 'M150 120Q138 94 150 72Q166 98 162 124Z' : 'M156 118Q150 98 156 80Q166 100 164 120Z', '#7d6247', 'opacity=".7"');
    s += St('M160 70L240 64M156 90L240 86M158 108L240 106', '#2a2018', 0.8, 'opacity=".7"');
    s += pine(206, 48, 18) + pine(226, 47, 22, P.pineLt);
    s += Pa('M140 128Q170 120 205 128Z', P.mud);
    if (!scene) s += R(0, 128, 140, 22, 'url(#ffc-ground)', 'opacity=".4"');
    // runoff carrying gravel back past the monitors
    s += `<path ${an('a-flow')} d="M150 127Q100 131 40 128" stroke="${P.mud}" stroke-width="3" stroke-dasharray="6 6" fill="none"/>`;
    if (t >= 2) {
      // ditch & penstock feeding pressurised pipe
      s += R(0, 32, 30, 8, P.water) + Po('0,40 30,40 36,46 0,46', P.dirtLt);
      s += Po('24,34 52,50 52,55 24,39', P.wood) + `<path ${an('a-flow')} d="M26 36L50 50" stroke="${P.waterLt}" stroke-width="1.5" stroke-dasharray="4 4" fill="none"/>`;
      s += R(46, 48, 14, 14, P.woodDk) + L(46, 62, 46, 128, P.woodXdk, 1.4) + L(60, 62, 60, 128, P.woodXdk, 1.4);
      s += St('M53 62C54 90 62 110 70 116', 'url(#ffc-steelgrad)', 4) + St('M53 62C54 90 62 110 70 116', P.iron, 0.6, 'stroke-dasharray="1 7"');
    } else {
      s += R(0, 84, 16, 8, P.woodDk) + R(1, 85, 14, 3, P.water);
      s += St('M10 92C26 126 48 128 70 117', P.canvasDk, 3.2) + St('M10 92C26 126 48 128 70 117', P.canvas, 1.2, 'opacity=".6"');
    }
    const monitor = (x, y, sc, tx, ty, iron) => {
      const jet = `M${x + 26 * sc} ${y - 15 * sc}Q${n((x + tx) / 2)} ${n(Math.min(y, ty) - 26 * sc)} ${tx} ${ty}`;
      let m = '';
      m += `<path d="${jet}" stroke="${P.waterLt}" stroke-width="${n((iron ? 4.2 : 2.6) * sc)}" fill="none" opacity=".55"/>`;
      m += `<path ${an('a-flow-fast')} d="${jet}" stroke="${P.foam}" stroke-width="${n((iron ? 2 : 1.2) * sc)}" stroke-dasharray="8 8" fill="none"/>`;
      m += C(tx, ty, 6 * sc, P.foam, `class="an a-spray" opacity=".5"`) + C(tx - 4 * sc, ty + 5 * sc, 3.5 * sc, P.foam, `class="an a-spray" style="animation-delay:.4s" opacity=".4"`);
      if (iron) {
        m += G(`${El(0, 0, 9, 3, P.iron)}${R(-6, -6, 12, 6, P.ironLt)}${Po('-4,-6 24,-17 26,-13 -2,-3', 'url(#ffc-steelgrad)')}${Po('24,-17 30,-19 31,-16 26,-13', P.steel)}${L(-4, -4, -14, 2, P.ironLt, 1.6)}${R(-18, 0, 6, 5, P.iron)}`, `translate(${x} ${y}) scale(${sc})`);
      } else {
        m += G(`${L(0, 0, -5, 10, P.woodDk, 1.2)}${L(0, 0, 5, 10, P.woodDk, 1.2)}${L(0, 0, 0, 10, P.woodDk, 1.2)}${Po('-2,-2 24,-15 25,-12 0,1', '#b08b3a')}`, `translate(${x} ${y - 10}) scale(${sc})`);
      }
      return m;
    };
    if (t >= 3) s += monitor(108, 124, 0.75, 166, 112, true);
    s += monitor(70, 118, 1, eroded ? 150 : 158, eroded ? 84 : 88, t >= 1);
    if (t >= 1) s += miner(52, 128, 1, 'lever', P.shirt2);
    if (t >= 4) {
      s += Po('0,116 44,116 46,130 0,130', P.woodDk) + R(0, 116, 46, 14, 'url(#ffc-logs)') + R(0, 112, 44, 5, P.water, 'opacity=".8"');
      s += glint(84, 129, 0.8, 0.5) + glint(118, 129, 0.7, 1.4);
    }
    return s;
  };

  ART.stampmill = (t, scene) => {
    let s = '';
    if (!scene || t >= 3) s += Pa('M0 128L0 58L40 56L78 72L108 102L124 128Z', P.dirtLt) + St('M0 58L40 56L78 72L108 102', P.rockLt, 1);
    if (!scene) s += pine(20, 56, 22, P.pineLt);
    const stamps = t >= 1 ? 10 : 5;
    const fx = t >= 1 ? 118 : 124, fw = t >= 1 ? 86 : 56;
    if (t >= 4) {
      // aerial tramway delivering ore buckets
      s += L(0, 22, 70, 44, P.steel, 0.8) + `<path ${an('a-flow-slow')} d="M0 24.5L70 46.5" stroke="${P.rockLt}" stroke-width="3" stroke-dasharray="3 9" fill="none"/>`;
      s += smokestack(206, 128, 7, 104, P.brickDk, 3);
    }
    if (t >= 3) {
      // gravity-fed: ore bin up the hill, chute down to the battery
      s += R(42, 46, 40, 30, P.woodDk) + R(42, 46, 40, 30, 'url(#ffc-planks)') + Po('38,46 62,34 86,46', P.woodXdk);
      s += Po('82,62 118,82 118,88 82,68', P.wood);
      s += repeat(3, (i) => `<rect ${an('a-flicker', i * 0.7)} x="${48 + i * 11}" y="54" width="6" height="7" fill="${P.window}"/>`);
    }
    // frame & battery
    s += R(fx, 80, fw, 48, P.woodDk, 'opacity=".55"');
    s += L(fx, 80, fx, 128, P.wood, 3) + L(fx + fw, 80, fx + fw, 128, P.wood, 3) + L(fx - 3, 80, fx + fw + 3, 80, P.wood, 3);
    s += Po(`${fx - 6},${80} ${fx + fw / 2},${66} ${fx + fw + 6},${80}`, t >= 3 ? P.ironLt : P.woodDk) + (t >= 3 ? Po(`${fx - 6},${80} ${fx + fw / 2},${66} ${fx + fw + 6},${80}`, 'url(#ffc-corrugated)') : '');
    s += L(fx + 2, 86, fx + fw - 2, 86, P.iron, 2.4);
    s += R(fx + 2, 112, fw - 4, 10, P.iron) + R(fx + 2, 112, fw - 4, 2, P.ironLt);
    for (let i = 0; i < stamps; i++) {
      const x = fx + 6 + (i * (fw - 12)) / (stamps - 1);
      s += G(`${L(x, 84, x, 106, P.steel, 1.6)}${R(x - 2.6, 104, 5.2, 7, P.ironLt)}${R(x - 2.2, 90, 4.4, 2.4, P.steelLt)}`, '', `class="an a-stamp" style="animation-delay:${n((i % 5) * 0.12)}s"`);
    }
    s += R(fx + 6, 122, fw - 12, 2, '#7aa0c4', 'opacity=".6"');
    if (t >= 2) {
      // steam engine house with flywheel and stack
      s += R(204, 92, 34, 36, P.brick) + R(204, 92, 34, 36, 'url(#ffc-bricks)') + Po('200,92 221,80 242,92', P.brickDk);
      if (t < 4) s += smokestack(228, 80, 7, 52, P.brickDk, 3);
      s += `<rect ${an('a-flicker')} x="210" y="100" width="8" height="9" fill="${P.window}"/>`;
      s += G(`<g class="an a-spin" style="animation-duration:2.4s">${C(0, 0, 10, 'none', `stroke="${P.ironLt}" stroke-width="2"`)}${L(-10, 0, 10, 0, P.ironLt, 1.4)}${L(0, -10, 0, 10, P.ironLt, 1.4)}</g>${C(0, 0, 2, P.steel)}`, 'translate(212 116)');
      s += L(212, 106, fx + fw - 4, 86, P.ink, 1, 'opacity=".8"');
    }
    s += Pa('M84 128Q98 114 112 128Z', P.rockLt) + C(96, 122, 1, P.gold);
    s += oreCart(t >= 3 ? 100 : 70, 128, 1);
    if (t >= 3) s += repeat(4, (i) => `<rect ${an('a-flicker', i * 0.5)} x="${fx + 8 + i * 20}" y="70" width="5" height="5" fill="${P.window}" opacity=".9"/>`);
    s += miner(t >= 3 ? 82 : 52, 128, 1, 'stand', P.shirt3);
    return s;
  };

  ART.shaft = (t, scene) => {
    let s = '';
    let under = '';
    const SY = 70; // surface line in card coordinates
    if (!scene) {
      under += R(0, SY, 240, 80, 'url(#ffc-under)');
      under += St('M0 88Q60 84 120 90T240 86M0 118Q80 112 150 120T240 116M0 138Q70 134 130 140T240 136', '#120e09', 1.4, 'opacity=".8"');
      under += St('M0 102L30 96L52 108L70 100', P.gold, 1.2, 'class="an a-vein"') + St('M168 96L190 104L214 98L240 108', P.gold, 1.2, 'class="an a-vein" style="animation-delay:1.2s"');
      under += R(104, SY, 12, 80, '#07060a') + L(104, SY, 104, 150, P.woodDk, 1.2) + L(116, SY, 116, 150, P.woodDk, 1.2);
      under += repeat(7, (i) => L(104, SY + 8 + i * 11, 116, SY + 8 + i * 11, P.woodDk, 0.8));
      // upper drift
      under += R(116, 100, t >= 4 ? 124 : 48, 11, '#0c0a08') + L(116, 100, t >= 4 ? 240 : 164, 100, P.woodDk, 1);
      under += miner(150, 111, 0.85, 'pick', P.shirt) + `<circle ${an('a-flicker')} cx="142" cy="104" r="7" fill="url(#ffc-glow)"/>`;
      if (t >= 2) {
        under += R(124, 116, 72, 28, '#100d0a');
        for (let gx = 124; gx <= 196; gx += 12) under += L(gx, 116, gx, 144, P.woodLt, 1.3);
        for (let gy = 116; gy <= 144; gy += 9.33) under += L(124, gy, 196, gy, P.woodLt, 1.3);
        under += St('M128 140L146 128L160 134L176 120L194 124', P.gold, 2, 'class="an a-vein" style="animation-delay:.6s"');
        under += R(20, 132, 84, 10, '#0c0a08') + rails(22, 102, 141) + oreCart(t >= 3 ? 60 : 44, 140, 0.8);
      }
      if (t >= 3) under += G(`<g class="an a-cage">${R(-5, 0, 10, 12, P.ironLt)}${R(-4, 2, 8, 6, P.ink)}${L(0, -40, 0, 0, P.steel, 0.6)}</g>`, `translate(110 ${SY + 6})`);
      else under += L(110, SY - 2, 110, 92, P.canvasDk, 0.7) + R(107, 92, 6, 5, P.woodDk);
      if (t >= 4) {
        under += R(0, 142, 240, 8, '#0c0a08');
        under += repeat(10, (i) => `<circle ${an('a-flicker', i * 0.3)} cx="${122 + i * 12}" cy="102.5" r="1.3" fill="${P.lamp}"/>`) + L(116, 101, 240, 101, P.ink, 0.5);
        under += repeat(6, (i) => `<circle ${an('a-flicker', i * 0.4)} cx="${28 + i * 14}" cy="134" r="1.3" fill="${P.lamp}"/>`);
      }
    }
    // ---- surface works ----
    let top = '';
    top += Pa('M128 70Q150 56 176 70Z', P.dirtLt) + C(146, 64, 1, P.rockLt);
    top += R(98, 66, 24, 4, P.woodDk);
    if (t === 0) {
      top += L(100, 70, 100, 54, P.wood, 2) + L(120, 70, 120, 54, P.wood, 2) + L(98, 56, 122, 56, P.woodLt, 2.4) + L(120, 56, 126, 50, P.woodLt, 1.4);
      top += miner(90, 70, 0.9, 'lever', P.shirt2);
    } else if (t < 4) {
      // timber headframe with sheave wheel
      top += Pa('M98 70L106 18L114 18L122 70', 'none', `stroke="${P.wood}" stroke-width="2.4"`);
      top += L(100, 56, 120, 56, P.wood, 1.6) + L(102, 42, 118, 42, P.wood, 1.6) + L(104, 28, 116, 28, P.wood, 1.6);
      top += L(100, 56, 118, 42, P.woodDk, 1) + L(120, 56, 102, 42, P.woodDk, 1) + L(122, 70, 132, 40, P.woodDk, 1.8);
      top += G(`<g class="an a-spin" style="animation-duration:3s">${C(0, 0, 6, 'none', `stroke="${P.steel}" stroke-width="1.6"`)}${L(-6, 0, 6, 0, P.steel, 1)}${L(0, -6, 0, 6, P.steel, 1)}</g>`, 'translate(110 20)');
    } else {
      top += lattice(110, 12, 70, 10, 28, P.steel) + L(122, 70, 134, 36, P.steel, 1.6);
      top += G(`<g class="an a-spin" style="animation-duration:2s">${C(0, 0, 7, 'none', `stroke="${P.steelLt}" stroke-width="1.8"`)}${L(-7, 0, 7, 0, P.steelLt, 1)}${L(0, -7, 0, 7, P.steelLt, 1)}</g>`, 'translate(110 14)');
      top += C(110, 6, 6, 'url(#ffc-whiteglow)', 'class="an a-flicker"') + C(110, 6, 1.6, P.lamp);
    }
    if (t >= 3) {
      top += R(146, 44, 46, 26, P.wood) + R(146, 44, 46, 26, 'url(#ffc-planks)') + Po('142,44 169,32 196,44', P.woodDk);
      top += smokestack(184, 32, 6, 22, P.brickDk, 3, 0.8);
      top += `<rect ${an('a-flicker')} x="152" y="52" width="8" height="7" fill="${P.window}"/>` + L(146, 50, 110, 18, P.ink, 0.8);
    }
    if (t >= 1) top += miner(88, 70, 0.9, 'stand', P.shirt3) + oreCart(t >= 3 ? 134 : 140, 70, 0.8);
    if (!scene) s += under + top + R(0, SY - 1, 240, 2, P.dirtLt);
    else s += G(top, `translate(0 ${128 - SY})`);
    return s;
  };

  ART.steamplant = (t, scene) => {
    let s = '';
    if (t >= 4) {
      s += lattice(224, 40, 128, 4, 16, P.steel) + L(212, 52, 236, 52, P.steel, 1.2) + L(214, 64, 234, 64, P.steel, 1.2);
      s += St('M212 52Q190 60 150 66M236 52Q240 54 244 56', P.ink, 0.6) + St('M214 64Q196 72 150 76', P.ink, 0.6);
    }
    if (t >= 3) {
      s += R(70, 60, 80, 24, P.brickDk) + R(70, 60, 80, 24, 'url(#ffc-bricks)');
      s += repeat(6, (i) => `<rect ${an('a-flicker', i * 0.45)} x="${74 + i * 12.5}" y="66" width="7" height="9" fill="${t >= 4 ? P.lamp : P.window}"/>`);
      s += smokestack(126, 60, 8, 44, P.brickDk, 3);
      s += smoke(86, 58, 2, 0.8, P.steam, 3) + smoke(104, 58, 2, 0.7, P.steam, 3.4);
    }
    s += R(70, 84, 80, 44, P.brick) + R(70, 84, 80, 44, 'url(#ffc-bricks)') + R(68, 82, 84, 3, P.brickDk);
    s += repeat(3, (i) => {
      const x = 78 + i * 22;
      return `<path ${an('a-flicker', i * 0.5)} d="M${x} 112V97Q${x + 6} 89 ${x + 12} 97V112Z" fill="${t >= 4 ? P.lamp : P.window}"/>` + L(x + 6, 93, x + 6, 112, P.brickDk, 0.8);
    });
    s += R(100, 116, 20, 12, P.ink) + `<rect ${an('a-flicker')} x="102" y="119" width="16" height="9" fill="${P.fire}" opacity=".85"/>`;
    s += C(110, 124, 16, 'url(#ffc-fireglow)', 'opacity=".6"');
    s += smokestack(152, 128, 10, 102, P.brickDk, 4, 1.1);
    if (t >= 1) {
      s += vat(168, 128, 20, 24) + vat(192, 128, 20, 24) + (t >= 4 ? '' : vat(216, 128, 20, 24));
      s += St('M150 100H226V104M178 100V104M202 100V104', 'url(#ffc-steelgrad)', 2.4);
    }
    if (t >= 2) {
      s += R(2, 98, 22, 30, P.woodDk) + Po('0,98 13,88 26,98', P.woodXdk);
      s += Po('20,122 74,90 76,94 22,126', P.iron) + L(32, 118, 32, 128, P.ironLt, 1.2) + L(50, 107, 50, 128, P.ironLt, 1.2);
      s += `<path ${an('a-flow')} d="M22 121L72 91" stroke="${P.rockLt}" stroke-width="3" stroke-dasharray="3 5" fill="none"/>`;
    } else {
      s += Pa('M18 128Q34 108 52 128Z', '#1b1b1d') + oreCart(56, 128, 0.9, false);
    }
    if (t >= 3) s += C(84, 92, 2.6, P.ink, `stroke="${P.goldLt}" stroke-width=".8"`) + C(136, 92, 2.6, P.ink, `stroke="${P.goldLt}" stroke-width=".8"`);
    if (t >= 4) {
      s += G(`${Po('-6,-14 6,-14 4,-4 -4,-4', P.iron)}${L(-6, -14, -14, -22, P.ironLt, 1.6)}
        <path ${an('a-pour')} d="M4 -6Q10 -2 10 4" stroke="${P.gold}" stroke-width="2.4" fill="none"/>
        ${C(10, 6, 12, 'url(#ffc-glow)', 'class="an a-flicker"')}`, 'translate(178 122)');
      s += repeat(4, (i) => R(182 + i * 12, 124, 9, 4, 'url(#ffc-goldgrad)'));
      s += glint(196, 122, 0.8, 0.3) + glint(220, 121, 0.7, 1.2);
    }
    s += miner(t >= 2 ? 40 : 34, 128, 1, 'shovel', P.shirt3);
    return s;
  };

  ART.vault = (t, scene) => {
    let s = '';
    if (!scene) s += R(0, 128, 240, 22, '#1d1d22') + R(0, 128, 240, 22, 'url(#ffc-stones)');
    if (t <= 1) {
      // neoclassical assay office & mint
      s += Po('64,128 176,128 172,124 68,124', P.marbleDk) + Po('68,124 172,124 168,120 72,120', P.marble);
      s += R(74, 82, 92, 38, '#b9bdc5');
      s += repeat(4, (i) => {
        const x = [80, 98, 136, 154][i];
        return R(x, 86, 6, 34, P.marble) + R(x - 1, 84, 8, 2.4, P.marbleDk) + L(x + 2, 88, x + 2, 118, P.marbleDk, 0.6);
      });
      s += R(70, 76, 100, 8, P.marble) + Po('68,76 120,56 172,76', P.marble) + Po('76,74 120,60 164,74', P.marbleDk);
      s += C(120, 68, 4, 'url(#ffc-goldgrad)') + R(112, 98, 16, 22, P.ink) + R(111, 96, 18, 2, P.gold);
      s += `<rect ${an('a-flicker')} x="88" y="96" width="7" height="12" fill="${P.window}"/><rect ${an('a-flicker', 0.8)} x="145" y="96" width="7" height="12" fill="${P.window}"/>`;
      s += Tx(120, 81.6, 'U.S. MINT', 4.6, P.stoneDk);
      if (t >= 1) {
        s += R(176, 92, 56, 36, '#aeb3bb') + Po('172,92 204,80 236,92', P.marbleDk);
        s += Pa('M188 128V106Q204 90 220 106V128Z', P.ink) + Pa('M190 128V107Q204 93 218 107V128Z', '#2a2418');
        s += G(`<g class="an a-stamp">${R(-6, -22, 12, 4, P.ironLt)}${L(0, -18, 0, -8, P.steel, 2)}${R(-4, -8, 8, 3, P.iron)}</g>`, 'translate(204 124)');
        s += C(204, 116, 10, 'url(#ffc-glow)', 'opacity=".5"');
        s += repeat(5, (i) => El(36, 127 - i * 2.4, 7, 2, 'url(#ffc-goldgrad)', `stroke="${P.goldDk}" stroke-width=".4"`)) + repeat(3, (i) => El(50, 127 - i * 2.4, 6, 1.8, 'url(#ffc-goldgrad)', `stroke="${P.goldDk}" stroke-width=".4"`));
        s += glint(38, 112, 0.9, 0.4);
      }
      s += miner(t >= 1 ? 22 : 50, 128, 1, 'stand', '#2d3340');
    } else {
      // Fort Knox: granite block, stepped attic, central entrance and seal
      if (t >= 3) {
        const tower = (x) => `${L(x - 6, 128, x - 4, 92, P.iron, 1.4)}${L(x + 6, 128, x + 4, 92, P.iron, 1.4)}${L(x - 5, 110, x + 5, 100, P.iron, 0.8)}${L(x + 5, 110, x - 5, 100, P.iron, 0.8)}${R(x - 7, 82, 14, 10, P.graniteDk)}${Po(`${x - 9},82 ${x},76 ${x + 9},82`, P.iron)}${R(x - 5, 85, 10, 3, P.window, 'opacity=".8"')}`;
        s += `<polygon class="an a-sweep" points="20,82 6,14 34,14" fill="url(#ffc-beam)"/><polygon class="an a-sweep" style="animation-delay:-3s" points="220,82 206,14 234,14" fill="url(#ffc-beam)"/>`;
        s += tower(20) + tower(220);
      }
      s += R(56, 70, 128, 58, 'url(#ffc-granite)') + R(56, 70, 128, 58, 'url(#ffc-stones)');
      s += R(74, 58, 92, 12, P.graniteLt) + R(94, 50, 52, 8, P.granite) + R(54, 68, 132, 3, P.graniteDk) + R(72, 56, 96, 2.4, P.graniteDk);
      s += repeat(6, (i) => R(62 + i * 20 + (i >= 3 ? 16 : 0), 76, 3, 50, P.graniteDk, 'opacity=".55"'));
      s += R(106, 96, 28, 32, P.graniteDk) + R(110, 102, 20, 26, P.ink) + R(108, 99, 24, 2, P.gold);
      s += G(`${C(0, 0, 6, 'url(#ffc-goldgrad)')}${Pa('M-6 -1Q-13 -6 -16 -2Q-11 -1 -6 2Z', P.goldLt)}${Pa('M6 -1Q13 -6 16 -2Q11 -1 6 2Z', P.goldLt)}${C(0, 0, 3, P.goldDk)}`, 'translate(120 86)', 'filter="url(#ffc-neon)"');
      s += Tx(120, 76.4, 'UNITED STATES DEPOSITORY', 4.4, '#2d3036');
      s += L(120, 50, 120, 34, P.steel, 0.9) + `<g class="an a-wave">${R(120, 34, 12, 7, '#b4413a')}${R(120, 34, 5, 3.6, '#2b4a86')}${L(120, 36.5, 132, 36.5, '#eee', 0.7)}${L(120, 39, 132, 39, '#eee', 0.7)}</g>`;
      s += repeat(4, (i) => `<rect ${an('a-flicker', i * 0.6)} x="${66 + i * 9 + (i >= 2 ? 72 : 0)}" y="84" width="4" height="6" fill="${P.window}" opacity=".85"/>`);
      if (t >= 3) {
        s += L(0, 132, 240, 132, P.steel, 0.8) + L(0, 137, 240, 137, P.steel, 0.8);
        s += repeat(13, (i) => L(i * 20, 130, i * 20, 142, P.iron, 1.4));
      }
      if (t >= 4) {
        // the open vault: a 20-ton door swung aside to reveal stacked bars
        s += C(214, 110, 13, '#1c1a14') + C(214, 110, 13, 'url(#ffc-glow)', 'class="an a-flicker"');
        s += repeat(3, (row) => repeat(3 - row, (i) => Po(`${n(205 + i * 7 + row * 3.5)},${119 - row * 5} ${n(211 + i * 7 + row * 3.5)},${119 - row * 5} ${n(210 + i * 7 + row * 3.5)},${115 - row * 5} ${n(206 + i * 7 + row * 3.5)},${115 - row * 5}`, 'url(#ffc-goldgrad)')));
        s += G(`${El(0, 0, 5, 15, 'url(#ffc-steelgrad)')}${El(0, 0, 3, 11, P.ironLt)}${repeat(6, (i) => C(0, -11 + i * 4.4, 0.8, P.steelLt))}`, 'translate(192 110)');
        s += glint(212, 104, 0.9, 0.2) + glint(220, 116, 0.7, 1.4);
      }
      s += miner(t >= 3 ? 44 : 34, 128, 1, 'stand', '#2d3340');
    }
    return s;
  };

  /** Tier-5 "gilded" overlay shared by every building. */
  function gild(id) {
    const r = rng(id.length * 97 + id.charCodeAt(0));
    let out = `<rect x="0" y="0" width="240" height="150" fill="url(#ffc-gildwash)"/>`;
    for (let i = 0; i < 6; i++) out += glint(n(14 + r() * 212), n(20 + r() * 100), n(0.8 + r() * 0.8), n(r() * 2.6));
    return out;
  }

  /** Full building illustration for an Operations card. */
  function building(id, tier, opts = {}) {
    const art = ART[id];
    if (!art) return '';
    const seed = id.split('').reduce((a, ch) => a + ch.charCodeAt(0), 0);
    let body = art(Math.min(tier, 4), false);
    if (opts.locked) body = body.replace(/class="an /g, 'class="'); // silhouettes stay still
    const locked = opts.locked ? ' locked' : '';
    return `<svg class="bart${locked}${tier >= 5 ? ' gilded' : ''}" viewBox="0 0 240 150" preserveAspectRatio="xMidYMid slice" role="img" aria-label="${opts.label || id}">${cardBackdrop(seed)}${body}${tier >= 5 ? gild(id) : ''}</svg>`;
  }

  /* ---------------------------------------------------------------------
   * Territory panorama (1200×360)
   * ------------------------------------------------------------------ */
  const SCENE = { w: 1200, h: 360, viewBox: '0 34 1200 326' };
  const SLOTS = {
    shaft: { x: 1062, y: 232, s: 0.56 },
    hydraulic: { x: 690, y: 242, s: 0.58 },
    stampmill: { x: 868, y: 250, s: 0.6 },
    camp: { x: 528, y: 286, s: 0.66 },
    sluice: { x: 318, y: 300, s: 0.66 },
    steamplant: { x: 786, y: 338, s: 0.72 },
    prospector: { x: 156, y: 344, s: 0.74 },
    vault: { x: 1040, y: 346, s: 0.72 },
  };
  const SLOT_ORDER = Object.keys(SLOTS).sort((a, b) => SLOTS[a].y - SLOTS[b].y);

  function sceneBase() {
    const r = rng(1849);
    let stars = '';
    for (let i = 0; i < 90; i++) {
      const x = n(r() * 1200), y = n(r() * 170), rad = n(0.4 + r() * 0.9), o = n(0.3 + r() * 0.6);
      stars += i % 6 === 0 ? `<circle ${an('a-twinkle', n(r() * 4))} cx="${x}" cy="${y}" r="${rad}" fill="#e8efff" opacity="${o}"/>` : C(x, y, rad, '#e8efff', `opacity="${o}"`);
    }
    const far = 'M0 168L60 140L118 156L190 112L250 146L320 124L392 150L470 104L540 140L600 122L668 150L740 98L812 140L880 116L950 146L1020 108L1090 140L1150 120L1200 134';
    const mid = 'M0 214L80 186L170 204L260 178L350 202L440 182L520 206L610 176L700 200L790 174L880 196L960 170L1050 192L1130 176L1200 190';
    const trees = (() => {
      let out = '';
      const tr = rng(77);
      for (let i = 0; i < 44; i++) {
        const x = n(tr() * 1200), y = n(196 + tr() * 22), h = n(10 + tr() * 12);
        if (Object.values(SLOTS).some((sl) => Math.abs(sl.x - x) < 70 && sl.y - y < 70)) continue;
        out += pine(x, y, h, tr() > 0.5 ? P.pine : P.pineLt);
      }
      return out;
    })();
    const river = 'M454 214C446 228 428 240 404 250C378 262 372 276 344 288C312 302 292 314 248 324C204 334 170 344 110 348C70 351 30 352 0 352L0 360L120 360C176 358 214 350 254 338C298 326 324 314 352 300C384 284 392 270 416 258C444 244 462 232 470 214Z';
    const vr = rng(2024);
    let valley = '';
    for (let i = 0; i < 60; i++) {
      const x = n(vr() * 1200), y = n(240 + vr() * 116), big = vr() > 0.7;
      if (Object.values(SLOTS).some((sl) => Math.abs(sl.x - x) < 100 * sl.s + 20 && y < sl.y + 8 && y > sl.y - 40)) continue;
      valley += big ? rocks(x, y, 0.9, P.rock) : El(x, y, n(3 + vr() * 5), n(1 + vr() * 1.2), vr() > 0.5 ? '#2a2318' : '#141b12', 'opacity=".8"');
    }
    const trails = `${St('M560 292C620 300 676 292 740 286C800 280 840 268 880 256', P.dirtLt, 5, 'opacity=".55" stroke-linecap="round"')}
      ${St('M700 290C724 306 752 316 770 336M880 262C940 290 1000 318 1040 344M560 292C500 296 452 290 424 280', P.dirtLt, 4, 'opacity=".45" stroke-linecap="round"')}
      ${St('M424 280C404 274 384 266 360 262', P.dirtLt, 3, 'opacity=".35" stroke-linecap="round" stroke-dasharray="4 5"')}`;
    const bridge = `${Po('382,262 410,276 406,282 378,268', P.wood)}${L(380, 263, 408, 277, P.woodLt, 1)}${repeat(4, (i) => L(383 + i * 7, 265 + i * 3.4, 381 + i * 7, 270 + i * 3.4, P.woodDk, 1))}`;
    return `${R(0, 0, 1200, 360, 'url(#ffc-sky)')}
      <g class="scene-stars">${stars}</g>
      ${C(612, 70, 46, 'url(#ffc-moonglow)')}${C(612, 70, 17, '#efe3c0')}${C(619, 65, 15, '#0b1424', 'opacity=".92"')}
      ${Pa(`${far}L1200 360L0 360Z`, '#0e1626')}${St(far, 'currentColor', 1, 'class="nst" opacity=".35"')}
      ${Pa(`${mid}L1200 360L0 360Z`, '#121c2d')}${St(mid, 'currentColor', 0.6, 'class="nst" opacity=".14"')}
      ${trees}
      ${Pa('M0 236Q300 214 600 226T1200 222L1200 360L0 360Z', 'url(#ffc-valley)')}
      ${St('M0 236Q300 214 600 226T1200 222', '#3a3124', 1)}
      ${valley}${trails}
      ${Pa(river, 'url(#ffc-water)', 'opacity=".9"')}${bridge}
      <path ${an('a-flow-slow')} d="M460 222C440 240 416 252 398 262C376 276 360 290 330 300C300 314 250 330 150 350" stroke="${P.foam}" stroke-width="1.2" stroke-dasharray="3 21" fill="none" opacity=".55"/>
      <path ${an('a-flow')} d="M462 228C444 246 420 258 404 266C384 280 366 294 336 306C300 320 240 338 100 355" stroke="${P.waterLt}" stroke-width="1" stroke-dasharray="8 40" fill="none" opacity=".5"/>`;
  }

  /** Infrastructure that appears with policy upgrades (behind buildings). */
  function sceneInfra(flags) {
    let s = '';
    if (flags.fed) {
      const x = 694, y = 176;
      s += `<g class="nfl" opacity=".9">${R(x - 26, y - 4, 52, 4, 'currentColor', 'opacity=".25"')}${repeat(6, (i) => R(x - 22 + i * 8.4, y - 20, 3, 16, 'currentColor', 'opacity=".35"'))}${Po(`${x - 28},${y - 20} ${x},${y - 32} ${x + 28},${y - 20}`, 'currentColor', 'opacity=".35"')}</g>`;
      s += St(`M${x - 28} ${y - 20}L${x} ${y - 32}L${x + 28} ${y - 20}H${x - 28}M${x - 26} ${y}H${x + 26}`, 'currentColor', 0.8, 'class="nst" filter="url(#ffc-neon)"');
    }
    if (flags.telegraph) {
      let poles = '', wire = 'M0 216';
      for (let x = 40; x <= 1200; x += 110) {
        const y = 226 - Math.sin(x / 190) * 5;
        poles += L(x, y, x, y - 18, P.woodDk, 1.4) + L(x - 5, y - 15, x + 5, y - 15, P.woodDk, 1.2);
        wire += `Q${x - 55} ${n(y - 10)} ${x} ${n(y - 15)}`;
      }
      s += poles + St(wire, '#141414', 0.6);
    }
    if (flags.railroad) {
      s += rails(0, 1200, 264, '#2a1d10');
      const loco = `${R(0, -12, 26, 9, P.iron)}${R(18, -20, 10, 8, P.iron)}${R(4, -18, 4, 6, P.iron)}${Po('-1,-3 -7,0 -1,0', P.steel)}${C(6, -2, 2.6, P.ink)}${C(14, -2, 2.6, P.ink)}${C(22, -2, 2.2, P.ink)}${C(-1, -9, 3.5, 'url(#ffc-whiteglow)')}`;
      const car = (x, gold) => G(`${R(0, -10, 24, 8, gold ? P.woodDk : P.brickDk)}${gold ? goldPile(12, -10, 0.9) : ''}${C(5, -2, 2.2, P.ink)}${C(19, -2, 2.2, P.ink)}`, `translate(${x} 0)`);
      s += `<g class="an a-train"><g transform="translate(0 263)">${car(-86, true)}${car(-58, true)}${car(-30, false)}${G(loco, 'scale(-1 1) translate(-26 0)')}${smoke(4, -24, 3, 1)}</g></g>`;
    }
    return s;
  }

  /** A claimed-but-unbuilt slot: a survey stake with a pulsing ring. */
  function surveyStake() {
    return `${El(120, 128, 28, 6, 'none', 'class="nst an a-pulse" stroke="currentColor" stroke-width="1.2" stroke-dasharray="3 4"')}
      ${L(120, 128, 120, 106, P.woodLt, 1.8)}${Po('120,106 134,110 120,114', 'currentColor', 'class="nfl" opacity=".8"')}`;
  }

  // At panorama scale these micro-animations are invisible but still cost a
  // repaint every frame, so scene copies of the art keep only the big motions.
  const SCENE_STATIC = /class="an (a-flicker|a-glint|a-stamp|a-vein|a-spray|a-spark|a-pour)"/g;

  /** Markup for one slot in the panorama (building, stake, or nothing). */
  function sceneSlot(id, tier, owned, visible) {
    const sl = SLOTS[id];
    if (!sl || (!owned && !visible)) return '';
    const art = ART[id](Math.min(tier, 4), true).replace(SCENE_STATIC, 'class="$1-still"');
    const inner = owned ? `${El(120, 129, 92, 9, '#000', 'opacity=".35"')}${art}${tier >= 5 ? repeat(2, (i) => glint(70 + i * 100, 74 + i * 24, 1.3, i * 1.1)) : ''}` : surveyStake();
    return G(inner, `translate(${n(sl.x - 120 * sl.s)} ${n(sl.y - 128 * sl.s)}) scale(${sl.s})`, `class="slot${owned ? ' built' : ' staked'}"`);
  }

  function sceneHaze() {
    return `<rect class="scene-smog" x="0" y="120" width="1200" height="240" fill="url(#ffc-smog)"/>`;
  }

  /* ---------------------------------------------------------------------
   * Icons
   * ------------------------------------------------------------------ */
  const UI = {
    book: '<path d="M4 5.5C6.5 4.5 9.5 4.5 12 6c2.5-1.5 5.5-1.5 8-.5v13c-2.5-1-5.5-1-8 .5-2.5-1.5-5.5-1.5-8-.5z"/><path d="M12 6v13.5"/>',
    chart: '<path d="M4 20V4M4 20h16"/><path d="M7 15l4-4 3 3 5-6"/>',
    gear: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
    disk: '<path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    unlock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 7.5-2"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
    upload: '<path d="M12 15V4M7.5 8.5L12 4l4.5 4.5M5 15v5h14v-5"/>',
    download: '<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 15v5h14v-5"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6.5 7l1 13h9l1-13"/>',
    sound: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11"/>',
    mute: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 9.5l5 5M21.5 9.5l-5 5"/>',
    bolt: '<path d="M13 3L5 14h6l-1 7 8-11h-6z"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    pick: '<path d="M4 20l10-10"/><path d="M8 4c4.5-.5 9 1.5 12 6"/><path d="M10.5 7.5l6 6"/>',
    spark: '<path d="M12 3l1.8 6.2L20 11l-6.2 1.8L12 19l-1.8-6.2L4 11l6.2-1.8z"/>',
    map: '<path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z"/><path d="M9 4v14M15 6v14"/>',
    coin: '<circle cx="12" cy="12" r="8.5"/><path d="M14.5 9.2c-.6-.9-1.6-1.3-2.7-1.3-1.5 0-2.6.8-2.6 2s1.1 1.7 2.6 2 2.8.8 2.8 2.1-1.2 2.1-2.8 2.1c-1.2 0-2.3-.5-2.9-1.4M12 6.2v1.7M12 16.1v1.7"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    play: '<path d="M8 5.5v13l10.5-6.5z"/>',
    pause: '<path d="M8.5 5.5v13M15.5 5.5v13"/>',
    home: '<path d="M4 11l8-6.5 8 6.5"/><path d="M6 9.5V20h12V9.5"/>',
    vault: '<rect x="3.5" y="4.5" width="17" height="15" rx="1.5"/><circle cx="12" cy="12" r="4"/><path d="M12 8v1.5M12 14.5V16M8 12h1.5M14.5 12H16M6 19.5v1.5M18 19.5v1.5"/>',
  };

  function uiIcon(name, cls = '') {
    return `<svg class="ico ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${UI[name] || ''}</svg>`;
  }

  /** Small colourful pictograms (40×40) for upgrades and building badges. */
  const PICTO = {
    prospector: () => `${El(20, 25, 14, 5.5, '#3a3f47')}${El(20, 24, 11, 3.6, '#1d2127')}${C(16, 23.4, 2.2, P.gold)}${C(22, 24.2, 1.6, P.goldLt)}${C(25.5, 23.2, 1.2, P.gold)}${glint(28, 14, 1.2)}`,
    sluice: () => `${Po('6,14 34,26 34,31 6,19', P.wood)}${St('M8 16.5L32 27.5', P.waterLt, 1.6)}${repeat(4, (i) => L(11 + i * 6, 17.5 + i * 2.6, 12 + i * 6, 21.5 + i * 2.6, P.woodXdk, 1.2))}${L(12, 21, 9, 34, P.woodDk, 1.6)}${L(28, 29, 30, 34, P.woodDk, 1.6)}`,
    camp: () => `${tent(20, 32, 26, 22)}${fire(32, 34, 0.5)}`,
    hydraulic: () => `${Po('6,30 26,18 28,21 9,33', 'url(#ffc-steelgrad)')}${St('M28 19Q34 14 37 20', P.waterLt, 2.4)}${C(36, 22, 2.4, P.foam, 'opacity=".7"')}${El(9, 32, 5, 2, P.iron)}`,
    stampmill: () => `${R(6, 8, 28, 3, P.wood)}${L(7, 8, 7, 34, P.wood, 2)}${L(33, 8, 33, 34, P.wood, 2)}${repeat(3, (i) => L(14 + i * 6, 11, 14 + i * 6, 24, P.steel, 1.6) + R(12 + i * 6, 23, 4, 5, P.ironLt))}${R(9, 29, 22, 4, P.iron)}`,
    shaft: () => `${Pa('M10 34L18 8L22 8L30 34', 'none', `stroke="${P.wood}" stroke-width="2.2"`)}${L(13, 24, 27, 24, P.wood, 1.6)}${C(20, 9, 4, 'none', `stroke="${P.steel}" stroke-width="1.6"`)}${L(20, 9, 20, 34, P.canvasDk, 0.8)}${R(8, 33, 24, 3, P.dirtLt)}`,
    steamplant: () => `${R(6, 18, 22, 16, P.brick)}${R(6, 18, 22, 16, 'url(#ffc-bricks)')}${R(28, 6, 6, 28, P.brickDk)}${C(31, 4, 3, P.smoke, 'opacity=".6"')}${R(10, 23, 5, 6, P.window)}${R(19, 23, 5, 6, P.window)}`,
    vault: () => `${Po('5,15 20,6 35,15', P.marble)}${R(6, 15, 28, 3, P.marbleDk)}${repeat(4, (i) => R(8.5 + i * 7, 18, 3.4, 13, P.marble))}${R(5, 31, 30, 4, P.marbleDk)}${C(20, 11.5, 2, P.gold)}`,
    pick: (head) => `${L(10, 32, 28, 14, P.woodLt, 3, 'stroke-linecap="round"')}${Pa('M14 8Q26 4 34 14L31 16Q25 9 15 11Z', head)}`,
    keg: () => `${Pa('M11 34Q8 22 11 10L29 10Q32 22 29 34Z', P.woodDk)}${L(9, 16, 31, 16, P.iron, 1.6)}${L(9, 28, 31, 28, P.iron, 1.6)}${Tx(20, 25, 'XXX', 6, P.lamp)}${C(30, 7, 2.4, P.ember)}`,
    dynamite: () => `${repeat(3, (i) => R(9 + i * 8, 12, 7, 22, '#c4372c', 'rx="1.8"'))}${R(8, 19, 24, 3.4, P.woodDk)}${St('M20 12Q24 6 21 3', '#d9c9a0', 1.2)}${C(21, 3, 2.6, P.ember)}`,
    drill: () => `${R(14, 6, 12, 20, 'url(#ffc-steelgrad)', 'rx="2.4"')}${R(9, 5, 22, 4, P.iron, 'rx="1.6"')}${R(18, 26, 4, 6, P.ironLt)}${Po('18,32 22,32 20,37', P.steelLt)}`,
    telegraph: () => `${L(20, 36, 20, 6, P.woodLt, 2.4)}${L(10, 10, 30, 10, P.woodLt, 2)}${L(12, 16, 28, 16, P.woodLt, 1.6)}${St('M2 12Q10 16 10 10M30 10Q34 16 40 13', '#cfd6e0', 0.7)}${C(10, 9, 1.4, '#9fd2ff')}${C(30, 9, 1.4, '#9fd2ff')}`,
    train: () => `${R(6, 16, 20, 12, P.ironLt)}${R(22, 10, 12, 18, P.iron)}${R(9, 8, 5, 8, P.iron)}${C(12, 30, 4, P.ink, `stroke="${P.steel}"`)}${C(26, 30, 4, P.ink, `stroke="${P.steel}"`)}${Po('34,26 39,30 34,30', P.steel)}${R(24, 13, 7, 5, P.window)}${C(11, 5, 3, P.smoke, 'opacity=".7"')}`,
    scroll: () => `${R(9, 8, 22, 26, '#e8dcbc', 'rx="2"')}${R(7, 6, 26, 4, '#cbb98f', 'rx="2"')}${R(7, 32, 26, 4, '#cbb98f', 'rx="2"')}${repeat(4, (i) => L(12, 14 + i * 4, 28, 14 + i * 4, '#8a7a58', 1))}${C(26, 29, 4, '#b4413a')}`,
    fed: () => `${Po('4,14 20,5 36,14', P.marble)}${R(5, 14, 30, 3, P.marbleDk)}${repeat(5, (i) => R(7 + i * 5.6, 17, 3, 13, P.marble))}${R(4, 30, 32, 5, P.marbleDk)}${C(20, 10.5, 2.2, '#2ee6a6')}`,
    globe: () => `${C(20, 20, 14, '#1d4f7a')}${Pa('M13 11Q18 14 15 19Q11 22 13 27L10 25Q7 18 13 11ZM22 9Q30 12 31 19L27 22Q24 18 26 15Q22 14 22 9ZM24 26Q28 26 29 30Q24 33 22 30Z', '#4f9a5a')}${C(20, 20, 14, 'none', `stroke="${P.gold}" stroke-width="1.2"`)}${El(20, 20, 6, 14, 'none', `stroke="${P.gold}" stroke-width=".6" opacity=".7"`)}`,
    ship: () => `${Pa('M4 24L36 24L31 33L9 33Z', P.iron)}${R(8, 17, 7, 7, '#b4413a')}${R(16, 15, 7, 9, '#3f6e8c')}${R(24, 18, 6, 6, P.gold)}${L(32, 24, 32, 10, P.steel, 1.2)}${St('M2 36Q8 34 14 36T26 36T38 36', P.waterLt, 1)}`,
    // ---- shop pictograms (v2) ----
    ring: () => `${C(20, 20, 14, 'rgba(245,197,66,.10)', `stroke="${P.gold}" stroke-width="1.6" stroke-dasharray="4 3"`)}${C(20, 20, 3, P.goldLt)}${L(20, 3, 20, 9, P.gold, 1.4)}${L(20, 31, 20, 37, P.gold, 1.4)}${L(3, 20, 9, 20, P.gold, 1.4)}${L(31, 20, 37, 20, P.gold, 1.4)}`,
    hammer: () => `${L(12, 34, 24, 15, P.woodLt, 3.4, 'stroke-linecap="round"')}${Po('17,8 33,17 29,24 13,15', 'url(#ffc-steelgrad)')}${Po('13,15 17,8 19,9 15,16', P.steelLt)}${L(15, 31, 18, 26, P.woodDk, 1.2)}`,
    bolt: () => `${Po('23,3 9,22 18,22 15,37 31,15 22,15 26,3', P.gold, `stroke="${P.goldDk}" stroke-width="1" stroke-linejoin="round"`)}${Po('23,5 13,19 19,19', P.goldLt, 'opacity=".7"')}`,
    crit: () => `${Po('20,2 23.5,14 36,10 26,19.5 35,30 22.5,25 20,38 17.5,25 5,30 14,19.5 4,10 16.5,14', P.fire)}${Po('20,9 22,16 29,14 23.5,19.5 28,26 21,23 20,30 19,23 12,26 16.5,19.5 11,14 18,16', P.lamp)}`,
    anvil: () => `${Pa('M5 12H29Q35 12 37 8L37 15Q33 18 27 18L25 18L25 23L29 29L11 29L15 23L15 18Q9 18 5 15Z', P.iron)}${Pa('M5 12H29Q35 12 37 8', 'none', `stroke="${P.steelLt}" stroke-width="1.2"`)}${R(9, 29, 22, 4, P.ironLt, 'rx="1"')}${glint(30, 6, 1.1)}`,
    lantern: () => `${C(20, 22, 15, 'url(#ffc-glow)')}${Pa('M14 9H26L24 13H16Z', P.iron)}${R(14.5, 13, 11, 14, P.window, 'rx="2"')}${R(14.5, 13, 11, 14, 'none', `stroke="${P.iron}" stroke-width="1.6" rx="2"`)}${L(20, 13, 20, 27, P.iron, 1.2)}${R(13, 27, 14, 4, P.iron, 'rx="1"')}${St('M16 9Q20 2 24 9', P.ironLt, 1.4)}`,
    rocks: () => `${Pa('M3 33L8 22L16 19L21 26L19 33Z', P.rockLt)}${Pa('M17 33L22 21L31 17L37 25L36 33Z', '#6f5e4c')}${Pa('M10 33L14 27L22 27L25 33Z', '#8e7b65')}${C(26, 24, 1.8, P.gold)}${C(13, 25, 1.3, P.gold)}${C(31, 28, 1.1, P.goldLt)}${L(2, 33.5, 38, 33.5, P.dirtLt, 1.4)}`,
    scales: () => `${L(20, 6, 20, 32, P.goldDk, 1.8)}${L(8, 10, 32, 10, P.gold, 1.8)}${C(20, 6, 2, P.gold)}${St('M8 10L4 21M8 10L12 21', P.steel, 0.8)}${St('M32 10L28 19M32 10L36 19', P.steel, 0.8)}${Pa('M3 21H13Q8 26 3 21Z', P.gold)}${Pa('M27 19H37Q32 24 27 19Z', P.gold)}${C(8, 20, 1.6, P.goldLt)}${R(13, 32, 14, 3, P.goldDk, 'rx="1"')}`,
    clover: () => `${C(15, 15, 6, '#3f9b55')}${C(25, 15, 6, '#3f9b55')}${C(15, 25, 6, '#3f9b55')}${C(25, 25, 6, '#4fb365')}${St('M20 20Q24 30 30 36', '#2d6b3b', 2)}${C(20, 20, 2.2, '#2d6b3b')}${glint(30, 8, 1.1)}`,
    whistle: () => `${Pa('M6 17H24Q32 17 32 24Q32 31 24 31Q17 31 17 24L17 22H6Z', 'url(#ffc-steelgrad)')}${C(24, 24, 3.2, P.iron)}${R(8, 15, 5, 2, P.steel)}${St('M33 12Q36 9 35 6M29 10Q30 6 28 4', P.steelLt, 1.2)}${St('M6 17L3 12', P.gold, 1.2)}`,
  };

  function picto(name, arg) {
    const fn = PICTO[name];
    return `<svg class="picto" viewBox="0 0 40 40" aria-hidden="true">${fn ? fn(arg) : ''}</svg>`;
  }

  /* Fiat-era line icons (24×24, stroke = currentColor). */
  const FIAT_ICONS = {
    bill: '<rect x="2.5" y="6" width="19" height="12" rx="1.5"/><circle cx="12" cy="12" r="3"/><path d="M5.5 9v6M18.5 9v6"/>',
    dial: '<path d="M4 16a8 8 0 1 1 16 0"/><path d="M12 16l4-5"/><path d="M6.5 16h.01M17.5 16h.01"/>',
    chart: '<path d="M3 20h18"/><path d="M5 16l4-5 4 3 6-8"/><path d="M15 6h4v4"/>',
    press: '<rect x="4" y="9" width="16" height="8" rx="1"/><path d="M7 9V4h10v5M7 17v3h10v-3M8 13h8"/>',
    bank: '<path d="M3 9.5L12 4l9 5.5z"/><path d="M5 10v7M9.5 10v7M14.5 10v7M19 10v7M3 20h18"/>',
    multiply: '<circle cx="12" cy="12" r="9"/><path d="M8.5 8.5l7 7M15.5 8.5l-7 7"/>',
    tower: '<path d="M7 21V5l5-2v18M12 7l5 2v12M4 21h16M9 8h1M9 11h1M9 14h1M14 11h1M14 14h1M14 17h1"/>',
    barrel: '<path d="M6 5h12M6 19h12"/><path d="M7 5c-1.3 4.7-1.3 9.3 0 14h10c1.3-4.7 1.3-9.3 0-14"/><path d="M6.5 10h11M6.5 14h11"/>',
    cycle: '<path d="M20 12a8 8 0 0 1-14 5.3M4 12a8 8 0 0 1 14-5.3"/><path d="M18 3v4h-4M6 21v-4h4"/>',
    rig: '<path d="M8 21l3-15h2l3 15M9 16h6M10 11h4M12 3v3M5 21h14"/><path d="M15 9h4v3"/>',
  };

  function fiatIcon(name) {
    return `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${FIAT_ICONS[name] || ''}</svg>`;
  }

  /** Header emblem: a gold coin with a dollar sign and an orbit ring. */
  function emblem() {
    return `<svg class="emblem" viewBox="0 0 40 40" aria-hidden="true">
      ${C(20, 20, 15, 'url(#ffc-goldgrad)')}${C(20, 20, 12.2, 'none', `stroke="${P.goldDk}" stroke-width="1"`)}${C(20, 20, 15, 'none', `stroke="#fff3c4" stroke-width=".6" opacity=".7"`)}
      ${Tx(20, 25.6, '$', 15, '#7a5208')}
      <ellipse cx="20" cy="20" rx="19" ry="6.5" fill="none" class="nst" stroke="currentColor" stroke-width="1" transform="rotate(-22 20 20)" opacity=".85"/>
      ${C(36.4, 13.4, 1.6, 'currentColor', 'class="nfl"')}
    </svg>`;
  }

  /** Bank-vault door for the Nixon Shock panel. `ready` lights it up. */
  function vaultDoor(ready) {
    const bolts = repeat(16, (i) => {
      const a = (i / 16) * Math.PI * 2;
      return C(n(60 + Math.cos(a) * 46), n(60 + Math.sin(a) * 46), 2.2, P.steel);
    });
    const spokes = repeat(3, (i) => L(60, 60, n(60 + Math.cos((i / 3) * Math.PI * 2) * 22), n(60 + Math.sin((i / 3) * Math.PI * 2) * 22), P.steelLt, 3, 'stroke-linecap="round"'));
    return `<svg class="vault-door${ready ? ' ready' : ''}" viewBox="0 0 120 120" aria-hidden="true">
      ${C(60, 60, 57, '#1a1f28')}${C(60, 60, 54, 'url(#ffc-steelgrad)')}${C(60, 60, 50, '#2c333e')}${bolts}
      ${C(60, 60, 38, '#39424f')}${C(60, 60, 38, 'none', 'class="nst" stroke="currentColor" stroke-width="1" opacity=".6"')}
      <g class="vault-wheel">${spokes}${C(60, 60, 22, 'none', `stroke="${P.steelLt}" stroke-width="2"`)}${C(60, 60, 6, P.steel)}</g>
      ${R(46, 92, 28, 10, '#11151b', 'rx="2"')}${Tx(60, 99.4, '$35/oz', 6.2, P.gold)}
      ${C(94, 24, 4, ready ? '#3ddc84' : '#ff5c5c', 'class="vault-led"')}
    </svg>`;
  }

  const SVGAssets = {
    P, defs, building, ART, SLOTS, SLOT_ORDER, SCENE, sceneBase, sceneInfra, sceneSlot, sceneHaze,
    uiIcon, picto, fiatIcon, emblem, vaultDoor, glint,
  };
  root.SVGAssets = SVGAssets;
  if (typeof module !== 'undefined' && module.exports) module.exports = SVGAssets;
})(typeof window !== 'undefined' ? window : globalThis);
