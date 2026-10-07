/* ==========================================================================
   FULL FAITH & CREDIT — economy.js
   Pure economic model: definitions, formulas and number formatting. No DOM,
   so it also loads in Node for balancing and tests. The mining shift itself
   (rocks, hits, dynamite) lives in mining.js.

   The loop: mine gold in timed shifts, and with permitted sites between
   shifts. Every ounce goes into the Treasury as reserves, and the Mint issues
   dollars against it at (official price ÷ gold cover). Dollars buy upgrades,
   site permits and historical charters. Nothing unlocks just by waiting.
   ========================================================================== */
(function (root) {
  'use strict';

  /* ------------------------------------------------------------------------
   * Constants
   * --------------------------------------------------------------------- */
  const SAVE_VERSION = 2;
  const COST_GROWTH = 1.13;               // each extra site unit costs 13% more
  const PACE_MEMORY = 0.5;                // weight of the newest shift in your mining pace
  const CREW_HALF = 2;                    // crews it takes to reach half of a site's limit
  const MAX_OFFLINE_SECONDS = 30 * 86400; // offline progress cap (30 days)
  const GOLD_EVER_MINED_OZ = 6.95e9;      // ≈216,000 t, all gold mined in history
  const MINT_PRICE_1834 = 20.67;          // $/oz set by the Coinage Act of 1834
  const BASE_LODE_CHANCE = 0.08;          // chance per shift of a Mother Lode
  const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

  /** Round a price to two significant figures: $4,134 reads as $4,100. */
  function roundPrice(v) {
    return v < 100 ? Math.round(v) : Number(v.toPrecision(2));
  }

  /* ------------------------------------------------------------------------
   * Number formatting — K, M, B, T, Qa … then scientific for
   * hyperinflation-sized numbers.
   * --------------------------------------------------------------------- */
  const SUFFIXES = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];
  let notation = 'suffix';

  function setNotation(mode) {
    notation = mode === 'scientific' ? 'scientific' : 'suffix';
  }

  function sci(a) {
    let e = Math.floor(Math.log10(a));
    let m = a / Math.pow(10, e);
    if (m >= 10) { m /= 10; e++; } else if (m < 1) { m *= 10; e--; }
    let s = m.toFixed(2);
    if (s === '10.00') { s = '1.00'; e++; }
    return s + 'e' + e;
  }

  /** Format a number. `dp` = decimals used below 1,000. */
  function fmt(n, dp = 0) {
    if (typeof n !== 'number' || Number.isNaN(n)) return '—';
    if (!Number.isFinite(n)) return n < 0 ? '-∞' : '∞';
    const neg = n < 0;
    const a = Math.abs(n);
    let out = null;
    if (a < 1000) {
      out = a.toFixed(dp);
      if (parseFloat(out) >= 1000) out = null; // 999.96 rounds up into the suffix range
    }
    if (out === null) {
      const big = Math.max(a, 1000);
      if (notation === 'scientific' || big >= 1e36) {
        out = sci(big);
      } else {
        let k = Math.floor(Math.log10(big) / 3);
        let m = big / Math.pow(1000, k);
        if (m >= 1000) { m /= 1000; k++; } else if (m < 1) { m *= 1000; k--; }
        let s = m.toFixed(2);
        if (s === '1000.00') { s = '1.00'; k++; }
        out = k < SUFFIXES.length ? s + SUFFIXES[k] : sci(big);
      }
    }
    return (neg ? '-' : '') + out;
  }

  function fmtUSD(n) {
    return '$' + (Math.abs(n) < 1000 ? n.toFixed(2) : fmt(n));
  }

  /** Compact duration: 45s, 12m 30s, 3h 12m, 2d 4h. */
  function fmtTime(sec) {
    if (!Number.isFinite(sec)) return '∞';
    sec = Math.max(0, sec);
    if (sec < 1) return '<1s';
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    if (d >= 365) return `${fmt(d / 365, 1)} yrs`;
    if (d) return `${d}d ${h}h`;
    if (h) return `${h}h ${m}m`;
    if (m) return `${m}m ${s}s`;
    return `${s}s`;
  }

  /** Session clock: 00:12:33 */
  function fmtClock(sec) {
    sec = Math.max(0, Math.floor(sec));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return [h, m, s].map((v) => String(v).padStart(2, '0')).join(':');
  }

  /* ------------------------------------------------------------------------
   * Glossary — real economic terms, surfaced through hover tooltips.
   * Text anywhere in the game can reference a term with [[id|label]].
   * --------------------------------------------------------------------- */
  const GLOSSARY = {
    // ---- Gold era -------------------------------------------------------
    'sutters-mill': { era: 'gold', title: "Sutter's Mill", body: 'On January 24, 1848, carpenter James Marshall found gold flakes in the tailrace of a sawmill on the American River in Coloma, California. Roughly 300,000 people would follow.' },
    'troy-ounce': { era: 'gold', title: 'Troy Ounce', body: 'The standard unit for precious metals: 31.1 grams, about 10% heavier than an ordinary ounce. From 1834 to 1933 the U.S. mint price of gold was $20.67 per troy ounce.', game: 'Your reserves are counted in troy ounces (oz).' },
    'specie': { era: 'gold', title: 'Specie', body: 'Money in the form of precious-metal coin rather than paper. "Specie payments" meant a bank or government would redeem its paper notes in gold or silver on demand.' },
    'gold-standard': { era: 'gold', title: 'Gold Standard', body: 'A monetary system in which a currency is defined as a fixed weight of gold and paper money can be exchanged for that gold. The money supply can only grow as fast as the gold stock.' },
    'assay': { era: 'gold', title: 'Assay', body: 'Testing ore or bullion to measure its metal content and purity. Assay offices let miners swap dust of unknown quality for coin or bars of certified value.' },
    'riffles': { era: 'gold', title: 'Riffles', body: 'Bars across the floor of a sluice that create small eddies. Gold, about 19 times denser than water, drops behind them while lighter sand washes away.' },
    'capital': { era: 'gold', title: 'Capital', body: 'Goods made to produce other goods: tools, machines, buildings. Investing in capital raises how much each worker can produce, which is why a sluice beats a pan.', game: 'Every building you buy is capital.' },
    'productivity': { era: 'gold', title: 'Productivity', body: 'Output per worker or per hour. Better tools, energy and methods raise productivity, and rising productivity is the root of long-run economic growth.' },
    'division-of-labor': { era: 'gold', title: 'Division of Labor', body: "Splitting work into specialized tasks so each worker gets faster at one job. Adam Smith's 1776 pin factory example showed it could multiply output many times over." },
    'economies-of-scale': { era: 'gold', title: 'Economies of Scale', body: 'Cost advantages from operating at larger scale: big fixed costs like a steam engine or a mill are spread over more output, so each ounce becomes cheaper to produce.' },
    'marginal-cost': { era: 'gold', title: 'Marginal Cost', body: 'The cost of producing one more unit. The richest, easiest claims are worked first, so each additional ounce tends to cost more than the last.', game: 'Each extra crew costs 13% more than the previous one.' },
    'diminishing-returns': { era: 'gold', title: 'Diminishing Returns', body: 'Add more of one input (workers) to a fixed input (a claim) and, past some point, each addition adds less output than the one before. The best gravel on a claim gets worked first.', game: "Each site's crews approach that site's limit: the next crew always adds less than the last." },
    'externality': { era: 'gold', title: 'Externality', body: "A cost or benefit that falls on people outside a transaction. Hydraulic mining's debris buried farms and choked rivers downstream; in 1884 the Sawyer Decision largely shut it down in California." },
    'property-rights': { era: 'gold', title: 'Property Rights', body: "Enforceable rules about who owns and may use a resource. In the lawless early goldfields, miners' meetings set claim sizes and settled disputes, creating property rights from scratch." },
    'prior-appropriation': { era: 'gold', title: 'Prior Appropriation', body: '"First in time, first in right." The Western water-law doctrine born in Gold Rush camps: whoever first diverted water for productive use holds the senior right to it.' },
    'venture-capital': { era: 'gold', title: 'Venture Capital', body: 'Financing for risky new ventures in exchange for a share of the upside. Gold Rush "grubstakes" — supplies advanced to a prospector for a cut of any strike — were an early version.' },
    'animal-spirits': { era: 'gold', title: 'Animal Spirits', body: "Keynes's term for the confidence, optimism and fear that drive economic decisions beyond cold calculation. Rushes, booms and panics run on them." },
    'supply-and-demand': { era: 'gold', title: 'Supply & Demand', body: 'Prices rise when demand outruns supply and fall when supply outruns demand. In 1849 San Francisco, boots, flour and eggs sold for many times their East Coast price.' },
    'transaction-costs': { era: 'gold', title: 'Transaction Costs', body: 'The costs of making an exchange: transport, search, negotiation, enforcement. Railroads and the telegraph slashed them, knitting local markets into one national economy.' },
    'inflation': { era: 'gold', title: 'Inflation', body: 'A sustained rise in the general price level, so each unit of money buys less. Gold rushes caused local inflation: when gold is plentiful and goods are scarce, gold buys less.' },
    'deflation': { era: 'gold', title: 'Deflation', body: 'A sustained fall in prices. Under the gold standard, output grew faster than the gold supply from 1873 to 1896, so prices fell, squeezing debtors such as farmers.' },
    'money-supply': { era: 'gold', title: 'Money Supply', body: 'The total amount of money in an economy. Under a gold standard it is tied to the stock of monetary gold, so new mines rather than central banks largely set its growth.' },
    'price-specie-flow': { era: 'gold', title: 'Price–Specie Flow', body: "David Hume's 1752 mechanism: a country with a trade surplus gains gold, its prices rise, its exports get less competitive, and gold flows back out. Trade balanced itself automatically." },
    'bimetallism': { era: 'gold', title: 'Bimetallism', body: 'A monetary system in which both gold and silver are legal money at a fixed ratio. The Coinage Act of 1873 dropped the silver dollar; critics called it "the Crime of \'73."' },
    'greenbacks': { era: 'gold', title: 'Greenbacks', body: 'Paper notes issued under the Legal Tender Act of 1862 to pay for the Civil War. They could not be redeemed in gold until 1879: America\'s first big experiment with fiat money.' },
    'seigniorage': { era: 'gold', title: 'Seigniorage', body: 'The profit a government earns by issuing money: the gap between the face value of currency and the cost of producing it.' },
    'cyanide-process': { era: 'gold', title: 'Cyanide Process', body: 'Patented by MacArthur and the Forrest brothers in 1887. A dilute cyanide solution dissolves microscopic gold from crushed ore, making low-grade deposits profitable worldwide.' },
    'comstock': { era: 'gold', title: 'Comstock Lode', body: 'The first major U.S. silver deposit, struck in 1859 near Virginia City, Nevada. Its gold and silver helped finance the Union in the Civil War.' },
    'bank-run': { era: 'gold', title: 'Bank Run', body: 'When many depositors withdraw their money at once, fearing a bank will fail. Because banks lend most deposits out, a run can topple even a solvent bank. Panics struck in 1857, 1873, 1893, 1907 and 1930–33.' },
    'federal-reserve': { era: 'gold', title: 'Federal Reserve', body: 'The U.S. central bank, created by the Federal Reserve Act of 1913 after the Panic of 1907 to provide an "elastic currency" and act as lender of last resort.' },
    'eo-6102': { era: 'gold', title: 'Executive Order 6102', body: 'Signed by Franklin Roosevelt on April 5, 1933. Americans had to deliver most gold coin, bullion and gold certificates to the Federal Reserve at $20.67 per ounce.' },
    'gold-reserve-act': { era: 'gold', title: 'Gold Reserve Act (1934)', body: 'Moved all monetary gold to the Treasury and revalued it from $20.67 to $35 per ounce, a 41% devaluation of the dollar against gold.', game: 'Your reserves are valued at $35/oz from 1934.' },
    'bretton-woods': { era: 'gold', title: 'Bretton Woods System', body: "The 1944 agreement among 44 Allied nations: the dollar was pegged to gold at $35/oz and other currencies were pegged to the dollar. Foreign central banks could convert dollars into gold." },
    'reserve-currency': { era: 'gold', title: 'Reserve Currency', body: "A currency foreign central banks hold in large amounts. Reserve status lets the issuer borrow cheaply, an \"exorbitant privilege\" in the words of France's Valéry Giscard d'Estaing." },
    'marshall-plan': { era: 'gold', title: 'Marshall Plan', body: 'The 1948–52 U.S. program that sent about $13 billion to rebuild Western Europe. It also spread dollars worldwide, seeding the global dollar system.' },
    'triffin-dilemma': { era: 'gold', title: 'Triffin Dilemma', body: "Economist Robert Triffin's 1960 warning: to supply the world with reserve dollars, the U.S. must run deficits, but those deficits eventually undermine confidence that dollars can be converted into gold." },
    'gold-pool': { era: 'gold', title: 'London Gold Pool', body: 'From 1961, eight central banks pooled gold to hold the market price at $35/oz. Rising demand broke the pool in March 1968, leading to a two-tier gold market.' },
    'nixon-shock': { era: 'gold', title: 'Nixon Shock', body: "On August 15, 1971, President Nixon suspended the dollar's convertibility into gold, ending Bretton Woods and starting the era of floating fiat currencies.", game: 'The prestige reset that ends the Gold Era.' },
    'credibility': { era: 'gold', title: 'Central Bank Credibility', body: 'How far the public believes a central bank will do what it says, especially keep inflation low. Credible banks anchor expectations, so their policies work with less pain.', game: 'Earned by severing the gold peg; spent in the Fiat Era.' },
    'mint-price': { era: 'gold', title: 'Official Gold Price', body: 'The price at which the U.S. Mint bought gold and the Treasury valued it: $20.67 per troy ounce from 1834 to 1933, then $35 from 1934. Under a gold standard this price is set by law, not by the market.', game: 'The Mint pays this price for every ounce you deposit.' },
    'gold-cover': { era: 'gold', title: 'Gold Cover', body: 'The share of a currency that must be backed by gold. The Federal Reserve Act of 1913 required 40% gold behind Federal Reserve notes. Congress cut it to 25% in 1945 and removed it for deposits in 1965 and for notes in 1968.', game: 'Lower cover lets each ounce in the vault back more dollars: price ÷ cover = dollars per ounce.' },
    'gold-certificate': { era: 'gold', title: 'Gold Certificate', body: 'Paper money fully backed by gold coin held in the Treasury and redeemable on demand, issued from 1865 until 1933.' },
    'placer-mining': { era: 'gold', title: 'Placer Mining', body: 'Recovering gold from loose sand and gravel in streams, called placers, with pans, rockers and sluices. It needs little capital, which is why the first rushes were placer rushes.' },
    'lode-mining': { era: 'gold', title: 'Lode Mining', body: 'Mining gold from veins in solid rock. The ore must be blasted, hoisted and crushed in stamp mills, so it takes far more capital than placer mining.' },
    'homestake': { era: 'gold', title: 'Homestake Mine', body: 'Found in the Black Hills of Dakota Territory in 1876, it became the largest and deepest gold mine in North America and produced roughly 40 million ounces before closing in 2002.' },
    'klondike': { era: 'gold', title: 'Klondike Gold Rush', body: "After the 1896 strike on Bonanza Creek in Canada's Yukon, about 100,000 people set out for the Klondike in 1897–98. Only around 30,000 to 40,000 made it." },
    // ---- Fiat era (previewed while locked) -----------------------------
    'fiat-money': { era: 'fiat', title: 'Fiat Money', body: 'Currency with no commodity backing. It is valuable because a government declares it legal tender and people trust it. Latin fiat: "let it be done."' },
    'fractional-reserve': { era: 'fiat', title: 'Fractional Reserve Banking', body: 'Banks keep only a fraction of deposits as reserves and lend out the rest. Loans get re-deposited and re-lent, so the banking system creates far more money than the reserves it holds.' },
    'money-multiplier': { era: 'fiat', title: 'Money Multiplier', body: 'The textbook ratio between broad money and bank reserves. With a 10% reserve ratio, $1 of reserves can support up to $10 of deposits.' },
    'federal-funds-rate': { era: 'fiat', title: 'Federal Funds Rate', body: "The interest rate banks charge each other for overnight loans of reserves, and the Fed's main policy lever. Raising it cools borrowing and inflation; cutting it stimulates growth." },
    'open-market-operations': { era: 'fiat', title: 'Open Market Operations', body: 'The Fed buying or selling government securities to add or drain bank reserves, its everyday tool for steering short-term interest rates.' },
    'quantitative-easing': { era: 'fiat', title: 'Quantitative Easing', body: 'Large-scale central bank purchases of longer-term bonds to push down long-term rates when short-term rates are already near zero. The Fed used it heavily after 2008 and in 2020.' },
    'velocity': { era: 'fiat', title: 'Velocity of Money', body: 'How many times a dollar is spent in a period. In the equation MV = PY, if money (M) or velocity (V) grows faster than real output (Y), prices (P) rise.' },
    'petrodollar': { era: 'fiat', title: 'Petrodollar System', body: 'After the 1974 U.S.–Saudi agreements, oil was priced and traded in dollars worldwide, creating steady global demand for dollars even without gold backing.' },
    'petrodollar-recycling': { era: 'fiat', title: 'Petrodollar Recycling', body: "Oil exporters reinvesting their dollar surpluses in U.S. Treasuries and bank deposits, which helped finance America's deficits." },
    'inflation-targeting': { era: 'fiat', title: 'Inflation Targeting', body: 'A central bank publicly commits to a numerical inflation goal. The Fed formally adopted a 2% target in 2012.' },
    'eurodollar': { era: 'fiat', title: 'Eurodollar', body: "U.S. dollar deposits held in banks outside the United States, beyond the Fed's direct reach. The market grew huge in the 1960s and '70s." },
    'hyperinflation': { era: 'fiat', title: 'Hyperinflation', body: 'Extremely rapid inflation, often defined as above 50% per month, as in Weimar Germany in 1923 or Zimbabwe in 2008. Money stops working as a store of value.' },
    'volcker-shock': { era: 'fiat', title: 'Volcker Shock', body: 'In 1979–81, Fed Chair Paul Volcker pushed the federal funds rate to about 20% to break double-digit inflation. It caused a recession but rebuilt the Fed\'s credibility.' },
    'stagflation': { era: 'fiat', title: 'Stagflation', body: 'High inflation combined with stagnant growth and high unemployment, the defining malaise of the 1970s after the oil shocks.' },
  };

  /* ------------------------------------------------------------------------
   * Sites — passive operations (Gold Era). `tiers` names the visual stage
   * reached by each tier upgrade (0 = base art, 5 = gilded). `baseCost` is in
   * ounces at the 1834 mint price; `unitCost` below converts it to dollars.
   * --------------------------------------------------------------------- */
  const BUILDINGS = [
    {
      id: 'prospector', name: 'Prospector', year: 1848, baseCost: 15, rate: 0.15,
      desc: 'A lone Forty-Niner swirling creek gravel in a steel pan. Gold is about 19 times denser than water, so it settles while sand washes away: the humblest way to turn rock into [[specie|specie]].',
      tiers: ['Gold Pan', 'Rocker Box', 'Grubstake', 'Long Tom', 'Claim District', 'Gold Fever'],
      quote: '"Gold! Gold! Gold from the American River!" (Samuel Brannan, San Francisco, May 1848)',
    },
    {
      id: 'sluice', name: 'Sluice Box', year: 1849, baseCost: 100, rate: 1.2,
      desc: 'A sloped wooden trough lined with [[riffles|riffles]]. Shovel in gravel and let the creek do the sorting. Cheap [[capital|capital]] that multiplies what one miner can process.',
      tiers: ['Wooden Sluice', 'Riffles & Quicksilver', 'Water Wheel', 'Trestle Flume', 'Steam Pump', 'Gilded Sluiceway'],
      quote: '"I have seen the elephant." (Forty-Niner slang for surviving the rush\'s hardships)',
    },
    {
      id: 'camp', name: 'Mining Camp', year: 1850, baseCost: 1100, rate: 10,
      desc: 'Tents become cabins, cabins become a boomtown. Scarce goods and abundant gold send prices soaring, which is local [[inflation|inflation]] in its purest form. Eggs reportedly sold for a dollar apiece.',
      tiers: ['Tent Camp', 'Log Cabins', 'General Store', 'Assay Office', 'Railroad Depot', 'Boomtown'],
      quote: '"There\'s gold in them thar hills!" (popular saying of the gold rushes)',
    },
    {
      id: 'hydraulic', name: 'Hydraulic Monitor', year: 1853, baseCost: 12000, rate: 64,
      desc: 'High-pressure water cannons wash entire hillsides into sluices. Spectacularly productive, and spectacularly destructive downstream: a textbook [[externality|externality]].',
      tiers: ['Canvas Hose', 'Iron Monitor', 'Ditch Network', 'Twin Monitors', 'Debris Dams', 'Malakoff Diggins'],
      quote: 'Field note: water is sold by the "miner\'s inch," one of the West\'s first metered utilities.',
    },
    {
      id: 'stampmill', name: 'Stamp Mill', year: 1856, baseCost: 130000, rate: 380,
      desc: 'Half-ton iron stamps pound quartz ore to sand around the clock. Hard-rock gold demands heavy [[capital|capital]] and rewards [[economies-of-scale|economies of scale]].',
      tiers: ['5-Stamp Battery', '10-Stamp Battery', 'Steam Engine', 'Gravity-Fed Mill', '100-Stamp Works', 'Gilded Batteries'],
      quote: 'Field note: a busy mill could be heard for miles. Silence meant the ore, or the money, had run out.',
    },
    {
      id: 'shaft', name: 'Deep Shaft Mine', year: 1860, baseCost: 1.4e6, rate: 2800,
      desc: 'Following the veins more than half a mile underground. Every foot deeper costs more in timber, pumping and lives: [[marginal-cost|rising marginal cost]] made visible.',
      tiers: ['Hand Windlass', 'Wooden Headframe', 'Square-Set Timbering', 'Steam Hoist', 'Electric Lights', 'Big Bonanza'],
      quote: 'Field note: Comstock miners worked in heat well above 100°F, cooled by tons of ice lowered each day.',
    },
    {
      id: 'steamplant', name: 'Steam Extraction Plant', year: 1870, baseCost: 2e7, rate: 20000,
      desc: 'Coal-fired boilers drive crushers, pumps and leaching vats that recover gold from ore once dumped as waste. More gold mined means a bigger [[money-supply|money supply]] under the [[gold-standard|gold standard]].',
      tiers: ['Boiler House', 'Cyanide Leach Tanks', 'Ore Conveyors', 'Power House', 'Electrolytic Refinery', 'Witwatersrand Contract'],
      quote: '"Gold is money. Everything else is credit." (J. P. Morgan, 1912)',
    },
    {
      id: 'vault', name: 'Treasury Vault', year: 1878, baseCost: 3.3e8, rate: 150000,
      desc: "Mints and depositories turn the nation's gold into coin and reserves. Trade surpluses pull in foreign gold through the [[price-specie-flow|price–specie flow]], and every ounce backs the dollar.",
      tiers: ['Assay & Mint', 'Coin Press Hall', 'Fort Knox Depository', 'Armored Perimeter', 'Bretton Woods Reserve', 'Gold Pool Reserve'],
      quote: '"In truth, the gold standard is already a barbarous relic." (John Maynard Keynes, 1923)',
    },
  ];
  const BUILDING_BY_ID = Object.fromEntries(BUILDINGS.map((b) => [b.id, b]));

  // Every site needs a permit before its first unit can be bought, and each
  // permit opens with a charter, so new sites never appear just by waiting.
  const PERMIT_CHARTER = {
    prospector: 'c1848', sluice: 'c1849', camp: 'c1850', hydraulic: 'c1853',
    stampmill: 'c1859', shaft: 'c1860', steamplant: 'c1869', vault: 'c1879',
  };
  // Crews mine at a share of YOUR pace (gold per second over recent shifts),
  // so they keep up as you upgrade and do nothing until you have mined. Each
  // site's crews approach that site's limit with diminishing returns:
  // share = limit × n / (n + CREW_HALF). Tiers raise the limit.
  const SITE_LIMIT = { prospector: 0.030, sluice: 0.032, camp: 0.034, hydraulic: 0.036, stampmill: 0.038, shaft: 0.040, steamplant: 0.042, vault: 0.045 };
  const SITE_UNIT = {
    prospector: 1, sluice: 2, camp: 2, hydraulic: 2,
    stampmill: 11, shaft: 110, steamplant: 480, vault: 2700,
  };
  BUILDINGS.forEach((b) => {
    b.limit = SITE_LIMIT[b.id] * 0.65;
    b.unitCost = SITE_UNIT[b.id];
    b.permitCharter = PERMIT_CHARTER[b.id];
  });

  // Site tier upgrades: each adds +50% of the site's base limit and advances
  // its artwork one visual stage. They must be bought in order.
  const TIER_RULES = [
    { owned: 1, costMult: 10 },
    { owned: 5, costMult: 50 },
    { owned: 10, costMult: 300 },
    { owned: 20, costMult: 2000 },
    { owned: 30, costMult: 15000 },
  ];
  // Limit multiplier at each visual tier (index 0 = no upgrades).
  const TIER_MULTS = [1, 1.5, 2, 2.5, 3, 3.5];

  const TIER_TEXT = {
    prospector: [
      { desc: 'A wooden cradle, rocked like a crib, washes far more gravel than a pan.' },
      { desc: 'Merchants advance food and tools for a share of any strike, an early form of [[venture-capital|venture capital]].' },
      { desc: 'A 12-foot trough worked by a crew: one shovels, one rocks, one picks out stones. The [[division-of-labor|division of labor]] at work.' },
      { desc: "Miners' meetings set claim sizes and settle disputes, creating [[property-rights|property rights]] before formal law arrives." },
      { desc: 'Rumors of a new strike send thousands stampeding. Confidence and greed, the [[animal-spirits|animal spirits]], drive the rush.' },
    ],
    sluice: [
      { desc: 'Cross-bars trap heavy gold, and mercury poured behind them grabs the finest dust. Effective, and an [[externality|externality]] that poisoned rivers for generations.' },
      { desc: 'The creek itself lifts water into the box. Free energy means more gravel per hour: higher [[productivity|productivity]].' },
      { desc: 'Elevated wooden aqueducts carry water miles to dry diggings. "First in time, first in right" ([[prior-appropriation|prior appropriation]]) is born in the camps.' },
      { desc: "A steam pump lifts water where gravity can't, so the sluices run straight through the dry season." },
      { desc: 'Ground sluicing turns whole creek beds into conveyor belts of gravel.' },
    ],
    camp: [
      { desc: 'Permanent shelter lets crews mine through the winter. Housing is [[capital|capital]] too.' },
      { desc: 'Levi Strauss came to San Francisco in 1853 to sell dry goods to miners. When gold is plentiful and goods are scarce, [[supply-and-demand|supply and demand]] favor the shopkeeper.' },
      { desc: 'Trusted [[assay|assays]] turn dust of unknown purity into money of known value.' },
      { desc: 'The rails arrive. Freight and [[transaction-costs|transaction costs]] collapse, and the camp joins a national market.', year: 1869.36 },
      { desc: 'Banks, newspapers, an opera house. At its peak Virginia City, Nevada, held some 25,000 people.' },
    ],
    hydraulic: [
      { desc: 'A swiveling iron nozzle, the "Little Giant," fires a jet that can tear a hillside apart.' },
      { desc: 'Companies sell water by the "miner\'s inch" through miles of ditches and flumes, an early metered utility.' },
      { desc: 'Twice the cannons on the same reservoir spreads the fixed costs thinner: [[economies-of-scale|economies of scale]].' },
      { desc: 'Silt buries farms downstream. The 1884 Sawyer Decision forces miners to bear the cost of their [[externality|externality]], or stop.' },
      { desc: "The Malakoff Diggins, California's largest hydraulic mine, carves a pit more than a mile long." },
    ],
    stampmill: [
      { desc: 'Each stamp is half a ton of iron, dropping roughly a hundred times a minute.' },
      { desc: 'Coal and steam replace water and mules, so the mill runs day and night. [[productivity|Productivity]] soars.' },
      { desc: 'Built down a hillside so ore flows by gravity from crusher to stamps to amalgamation tables: an assembly line decades before Ford.' },
      { desc: "The Comstock's giant mills crush thousands of tons of ore a day. Only big [[capital|capital]] can play." },
      { desc: 'Concentrators and vanners recover the gold the stamps once washed away.' },
    ],
    shaft: [
      { desc: 'A timber tower and sheave wheel hoist ore from hundreds of feet down.' },
      { desc: "Philip Deidesheimer's 1860 system of interlocking timber cubes lets miners follow the [[comstock|Comstock's]] enormous ore bodies." },
      { desc: 'Steam hoists and giant Cornish pumps fight gravity and floodwater. Each level deeper costs more: [[marginal-cost|marginal cost]] keeps rising.' },
      { desc: 'Electric power reaches the mines in the 1890s: brighter stopes, faster hoists, fewer candles.', year: 1890 },
      { desc: 'In 1873 miners strike the "Big Bonanza," one of the richest ore bodies ever found.' },
    ],
    steamplant: [
      { desc: 'The MacArthur–Forrest [[cyanide-process|cyanide process]] dissolves microscopic gold from crushed ore once written off as waste.', year: 1887.5 },
      { desc: 'Belts and crushers move ore continuously: [[economies-of-scale|economies of scale]] at industrial size.' },
      { desc: 'Batteries of boilers and dynamos power the whole works. Coal in, gold out.' },
      { desc: "The Wohlwill process (1874) refines bullion to 99.99% purity, gold the world's mints accept without question." },
      { desc: "South Africa's Witwatersrand, found in 1886, becomes the richest gold field in history. New supply ends decades of [[deflation|deflation]]." },
    ],
    vault: [
      { desc: 'Steam presses strike $20 Double Eagles, and the Treasury earns [[seigniorage|seigniorage]] on every coin.' },
      { desc: 'A granite, bombproof depository completed in 1936 to hold the gold surrendered under [[eo-6102|Executive Order 6102]].', year: 1936.95 },
      { desc: 'Guard towers, searchlights and a vault door weighing over 20 tons.' },
      { desc: "Foreign central banks may swap dollars for gold at $35/oz. The U.S. holds roughly two-thirds of the world's monetary gold, the anchor of [[bretton-woods|Bretton Woods]].", year: 1944.55 },
      { desc: 'Eight central banks pool gold to hold the price at $35, until the [[triffin-dilemma|Triffin dilemma]] catches up.', year: 1961.8 },
    ],
  };

  /* ------------------------------------------------------------------------
   * Mine maps. Charters open new fields: tougher rock (hp) and richer ore
   * (gold). The player can still choose an older field.
   * --------------------------------------------------------------------- */
  const MAPS = [
    { id: 'california', name: 'American River', place: 'COLOMA, CA', charter: 'c1848', hp: 1, gold: 1, term: 'placer-mining',
      desc: 'Loose gravel and quartz along the river. Easy to break, modest gold.' },
    { id: 'comstock', name: 'Comstock Lode', place: 'VIRGINIA CITY, NV', charter: 'c1859', hp: 5, gold: 9, term: 'comstock',
      desc: 'Hard quartz veins deep under Nevada. Tougher rock, far richer ore.' },
    { id: 'blackhills', name: 'Homestake Lode', place: 'LEAD, SD', charter: 'c1876', hp: 30, gold: 80, term: 'homestake',
      desc: 'An enormous lode of hard rock in the Black Hills.' },
    { id: 'klondike', name: 'Klondike Creeks', place: 'DAWSON CITY, YUKON', charter: 'c1897', hp: 160, gold: 650, term: 'klondike',
      desc: 'Frozen gravel thawed with fires, bursting with nuggets.' },
  ];
  const MAP_BY_ID = Object.fromEntries(MAPS.map((m) => [m.id, m]));

  /* ------------------------------------------------------------------------
   * Charters: the historical timeline. Each is bought in order and needs a
   * minimum of gold in the vault. Effects are applied in derive().
   * --------------------------------------------------------------------- */
  const CHARTERS = [
    { id: 'c1848', year: 1848.06, title: "Gold at Sutter's Mill", cost: 0, reserves: 0,
      text: "James Marshall spots gold flakes in the tailrace of [[sutters-mill|Sutter's Mill]]. The rush begins." },
    { id: 'c1849', year: 1849.0, title: 'The Forty-Niners', cost: 410, reserves: 14,
      text: 'Some 90,000 fortune-seekers pour into California in a single year, weighing their dust by the [[troy-ounce|troy ounce]].' },
    { id: 'c1850', year: 1850.69, title: 'California Statehood', cost: 770, reserves: 38,
      text: "Gold fast-tracks California into the Union as the 31st state. Miners' codes define [[property-rights|property rights]] in the meantime." },
    { id: 'c1853', year: 1853.2, title: 'Hydraulic Mining', cost: 1700, reserves: 88, effects: { veins: true },
      text: 'Edward Matteson turns a high-pressure hose on a hillside near Nevada City, and invents a new [[externality|externality]].' },
    { id: 'c1859', year: 1859.45, title: 'The Comstock Lode', cost: 4500, reserves: 310, effects: { map: 'comstock' },
      text: 'A fabulous silver-and-gold strike in Nevada: the [[comstock|Comstock Lode]] launches deep [[lode-mining|lode mining]].' },
    { id: 'c1860', year: 1860.5, title: 'Square-Set Timbering', cost: 29000, reserves: 2000,
      text: "Philip Deidesheimer's interlocking timber cubes make deep shafts safe enough to work." },
    { id: 'c1861', year: 1861.8, title: 'Transcontinental Telegraph', cost: 95000, reserves: 6500, effects: { goldMult: 0.15 },
      text: 'October 1861: the telegraph links the coasts and the Pony Express folds within days.' },
    { id: 'c1867', year: 1867.4, title: "Nobel's Dynamite", cost: 260000, reserves: 19000,
      text: "Alfred Nobel's 1867 patent: far more stable, and far stronger, than black powder." },
    { id: 'c1869', year: 1869.36, title: 'The Golden Spike', cost: 440000, reserves: 34000, effects: { goldMult: 0.25 },
      text: 'May 10, 1869: the Transcontinental Railroad is complete and [[transaction-costs|transaction costs]] collapse.' },
    { id: 'c1873', year: 1873.8, title: 'The Big Bonanza', cost: 710000, reserves: 53000, effects: { lode: 0.1 },
      text: 'Comstock miners strike the "Big Bonanza," one of the richest ore bodies ever found.' },
    { id: 'c1876', year: 1876.3, title: 'The Homestake Lode', cost: 980000, reserves: 91000, effects: { map: 'blackhills' },
      text: 'Gold in the Black Hills: the [[homestake|Homestake Mine]] opens, and will become the deepest in North America.' },
    { id: 'c1879', year: 1879.0, title: 'Specie Resumption', cost: 2800000, reserves: 210000,
      text: 'Greenbacks become redeemable in gold again, so the Treasury builds a gold reserve to back them: [[specie|specie]] payments resume.' },
    { id: 'c1880', year: 1880.5, title: 'Pneumatic Rock Drill', cost: 4700000, reserves: 380000,
      text: 'Compressed-air drills, proven on the Hoosac Tunnel, replace the hammer and hand steel.' },
    { id: 'c1887', year: 1887.5, title: 'The Cyanide Process', cost: 7600000, reserves: 570000, effects: { oreMult: 2 },
      text: 'The MacArthur–Forrest [[cyanide-process|cyanide process]] recovers fine gold once lost in the tailings.' },
    { id: 'c1897', year: 1897.5, title: 'The Klondike Stampede', cost: 15000000, reserves: 1300000, effects: { map: 'klondike' },
      text: 'A ton of gold steams into Seattle and 100,000 people head north: the [[klondike|Klondike Gold Rush]].' },
    { id: 'c1900', year: 1900.2, title: 'Gold Standard Act', cost: 88000000, reserves: 5100000, effects: { goldMult: 0.25 },
      text: 'Gold becomes the sole standard for redeeming paper money: the [[gold-standard|gold standard]] made law.' },
    { id: 'c1913', year: 1913.98, title: 'Federal Reserve Act', cost: 420000000, reserves: 17000000, effects: { cover: 0.4 },
      text: 'A central bank is born. [[federal-reserve|Federal Reserve]] notes need only 40% [[gold-cover|gold cover]], so each ounce backs 2.5 times as many dollars.' },
    { id: 'c1934', year: 1934.08, title: 'Gold Reserve Act', cost: 1600000000, reserves: 40000000, effects: { price: 35 },
      text: 'Gold is revalued from $20.67 to $35.00 an ounce by the [[gold-reserve-act|Gold Reserve Act]], so every ounce mints 69% more dollars.' },
    { id: 'c1936', year: 1936.95, title: 'Fort Knox', cost: 2600000000, reserves: 65000000, effects: { vaultMult: 2 },
      text: "The Bullion Depository is completed in Kentucky to hold the nation's gold." },
    { id: 'c1944', year: 1944.55, title: 'Bretton Woods', cost: 3700000000, reserves: 98000000, effects: { goldMult: 0.5 },
      text: 'The world pegs to the dollar and the dollar to gold at $35: the [[bretton-woods|Bretton Woods system]].' },
    { id: 'c1945', year: 1945.45, title: 'Gold Cover Cut to 25%', cost: 5900000000, reserves: 140000000, effects: { cover: 0.25 },
      text: 'Congress lowers the [[gold-cover|gold cover]] behind Federal Reserve notes to 25%, so each ounce backs even more dollars.' },
    { id: 'c1968', year: 1968.21, title: 'The Gold Pool Collapses', cost: 9600000000, reserves: 200000000,
      text: 'Private demand overwhelms the [[gold-pool|London Gold Pool]]. Closing the gold window is now possible: the [[nixon-shock|Nixon Shock]].' },
  ];
  const CHARTER_BY_ID = Object.fromEntries(CHARTERS.map((c) => [c.id, c]));

  /* ------------------------------------------------------------------------
   * The shop. Every item states what it requires; nothing unlocks by waiting.
   *   level    repeatable; cost grows geometrically
   *   tool     one-time; changes how shifts play
   *   permit   one-time; lets you build a site
   *   tier     one-time; multiplies a site's output and evolves its art
   *   charter  one-time; advances history (see CHARTERS)
   * --------------------------------------------------------------------- */
  const ITEMS = [];
  const ITEM_BY_ID = {};
  const add = (it) => { ITEMS.push(it); ITEM_BY_ID[it.id] = it; };

  const CATEGORIES = [
    { id: 'pickaxe', name: 'Pickaxe', blurb: 'Reach, power and pace of every swing.' },
    { id: 'shift', name: 'Shift', blurb: 'Longer shifts, richer rock, better recovery.' },
    { id: 'tools', name: 'Tools', blurb: 'New ways to break rock.' },
    { id: 'sites', name: 'Sites', blurb: 'Permits and improvements for the operations that mine between shifts.' },
    { id: 'charters', name: 'History', blurb: 'Charters move history forward and change the rules of the economy.' },
  ];

  [
    { id: 'radius', cat: 'pickaxe', name: 'Bigger Pick', icon: 'ring', base: 18, growth: 1.55, max: 30,
      value: (l) => 34 * Math.pow(1.07, l), show: (v) => `${Math.round(v)} reach`,
      desc: 'A wider head hits every rock inside its reach, so each swing breaks more rock.' },
    { id: 'damage', cat: 'pickaxe', name: 'Stronger Pick', icon: 'hammer', base: 25, growth: 1.6, max: 60,
      value: (l) => (1 + l) * Math.pow(1.08, l), show: (v) => `${fmt(v, 1)} damage`,
      desc: 'Better steel and a heavier head: every swing hits harder.' },
    { id: 'speed', cat: 'pickaxe', name: 'Faster Swings', icon: 'bolt', base: 30, growth: 1.6, max: 36,
      value: (l) => Math.max(0.08, 0.5 * Math.pow(0.95, l)), show: (v) => `${(1 / v).toFixed(1)} swings/s`,
      desc: 'Less time between swings. Hold down to keep swinging at this pace.' },
    { id: 'crit', cat: 'pickaxe', name: 'Sharpened Edge', icon: 'crit', base: 180, growth: 1.7, max: 20, requires: { charter: 'c1859' },
      value: (l) => 0.02 * l, show: (v) => `${Math.round(v * 100)}% crit chance`,
      desc: 'A keen edge finds the weak seam: a chance for a critical strike.' },
    { id: 'critmult', cat: 'pickaxe', name: 'Heavy Head', icon: 'anvil', base: 110000, growth: 2, max: 12, requires: { charter: 'c1873' },
      value: (l) => 3 + 0.5 * l, show: (v) => `×${v.toFixed(1)} crit damage`,
      desc: 'Critical strikes land even harder.' },
    { id: 'duration', cat: 'shift', name: 'Lantern Oil', icon: 'lantern', base: 40, growth: 1.85, max: 16, requires: { charter: 'c1849' },
      value: (l) => 20 + 2.5 * l, show: (v) => `${v.toFixed(1)}s shifts`,
      desc: 'More oil in the lamp means longer shifts underground.' },
    { id: 'ground', cat: 'shift', name: 'Richer Ground', icon: 'rocks', base: 60, growth: 1.75, max: 15, requires: { charter: 'c1850' },
      value: (l) => 18 + 2 * l, show: (v) => `${v} rocks in the face`,
      desc: 'Better ground: more rock in the face at once, and it refills faster.' },
    { id: 'assay', cat: 'shift', name: "Assayer's Eye", icon: 'scales', base: 85, growth: 1.75, max: 40, requires: { charter: 'c1853' },
      value: (l) => Math.pow(1.15, l), show: (v) => `×${fmt(v, 2)} gold per rock`,
      desc: 'Careful [[assay|assaying]] recovers more fine gold from every rock.' },
    { id: 'luck', cat: 'shift', name: 'Lucky Lamp', icon: 'clover', base: 71000, growth: 2, max: 10, requires: { charter: 'c1873' },
      value: (l) => 0.06 * l, show: (v) => `+${Math.round(v * 100)}% Mother Lode chance`,
      desc: 'Better odds that a Mother Lode shows up during a shift.' },
    { id: 'dynamite', cat: 'tools', name: 'Dynamite Bundles', icon: 'dynamite', base: 130000, growth: 1.9, max: 10, requires: { item: 'tool_dynamite' },
      value: (l) => 0.15 + 0.05 * l, show: (v) => `${Math.round(v * 100)}% blast chance`,
      desc: 'Bigger bundles: a broken rock is more likely to explode into its neighbours.' },
    { id: 'drill', cat: 'tools', name: 'Air Compressor', icon: 'drill', base: 2400000, growth: 2, max: 10, requires: { item: 'tool_drill' },
      value: (l) => 0.5 + 0.1 * l, show: (v) => `drill at ${Math.round(v * 100)}% of swing speed`,
      desc: 'More air pressure: the rock drill strikes on its own, faster.' },
  ].forEach((u) => add(Object.assign({ kind: 'level' }, u)));

  [
    { id: 'tool_foreman', name: 'Shift Foreman', icon: 'whistle', cost: 920, requires: { charter: 'c1850' }, effect: 'Next shift starts by itself',
      desc: 'Starts the next shift on its own a few seconds after the assay report.' },
    { id: 'tool_dynamite', name: "Nobel's Dynamite", icon: 'dynamite', cost: 78000, requires: { charter: 'c1867' }, effect: 'Broken rock can explode (15%)',
      desc: 'A broken rock may explode (15% chance), damaging the rock around it. Blasts can chain.' },
    { id: 'tool_drill', name: 'Pneumatic Rock Drill', icon: 'drill', cost: 1400000, requires: { charter: 'c1880' }, effect: 'Strikes on its own at 50% of your swing speed',
      desc: 'Strikes by itself wherever your pick rests, at half your swing speed, even when you are not holding down.' },
  ].forEach((u) => add(Object.assign({ kind: 'tool', cat: 'tools' }, u)));

  BUILDINGS.forEach((b) => add({
    id: `permit_${b.id}`, kind: 'permit', cat: 'sites', site: b.id, name: `${b.name} Permit`, icon: b.id,
    cost: roundPrice(b.unitCost * 10), requires: { charter: b.permitCharter },
    desc: `Licenses your first ${b.name}. ${b.desc}`,
  }));

  BUILDINGS.forEach((b) => TIER_RULES.forEach((rule, i) => {
    const tier = i + 1;
    const info = TIER_TEXT[b.id][i];
    add({
      id: `${b.id}-${tier}`, kind: 'tier', cat: 'sites', site: b.id, tier, mult: TIER_MULTS[tier], name: b.tiers[tier], icon: b.id,
      cost: roundPrice(b.unitCost * rule.costMult), desc: info.desc,
      requires: { site: b.id, owned: rule.owned, prev: tier > 1 ? `${b.id}-${tier - 1}` : `permit_${b.id}`, year: info.year || 0 },
    });
  }));

  CHARTERS.forEach((c, i) => add(Object.assign({ kind: 'charter', cat: 'charters', icon: 'scroll', name: c.title,
    requires: { charter: i ? CHARTERS[i - 1].id : null, reserves: c.reserves } }, c)));

  /* Phase 2 gate: the "Sever the Gold Peg" prestige reset (Nixon Shock). */
  const NIXON = {
    charter: 'c1968',
    reserves: 400000000,
    /** Projected Central Bank Credibility for this era's reserves. */
    credibility(reserves) {
      return reserves < this.reserves ? 0 : Math.floor(10 * Math.cbrt(reserves / this.reserves));
    },
  };

  /* Locked Fiat Era tech tree, previewed to motivate the prestige reset. */
  const FIAT_PREVIEW = {
    root: { id: 'fiat', name: 'Fiat Dollar', sub: '1971', term: 'fiat-money', icon: 'bill' },
    branches: [
      { label: 'MONETARY POLICY', nodes: [
        { id: 'ffr', name: 'Fed Funds Rate', sub: 'Policy lever', term: 'federal-funds-rate', icon: 'dial' },
        { id: 'omo', name: 'Open Market Ops', sub: 'Steer reserves', term: 'open-market-operations', icon: 'chart' },
        { id: 'qe', name: 'Quantitative Easing', sub: 'Balance sheet', term: 'quantitative-easing', icon: 'press' },
      ] },
      { label: 'BANKING', nodes: [
        { id: 'frb', name: 'Fractional Reserve', sub: 'Lend deposits', term: 'fractional-reserve', icon: 'bank' },
        { id: 'mult', name: 'Money Multiplier', sub: 'Compounding', term: 'money-multiplier', icon: 'multiply' },
        { id: 'euro', name: 'Eurodollar Market', sub: 'Offshore $', term: 'eurodollar', icon: 'tower' },
      ] },
      { label: 'PETRODOLLAR', nodes: [
        { id: 'petro', name: 'Petrodollar Pact', sub: '1974', term: 'petrodollar', icon: 'barrel' },
        { id: 'recycle', name: 'Recycling', sub: 'Treasuries', term: 'petrodollar-recycling', icon: 'cycle' },
        { id: 'reserve', name: 'Reserve Currency', sub: 'Global anchor', term: 'reserve-currency', icon: 'rig' },
      ] },
    ],
    instruments: [
      { id: 'cpi', name: 'Inflation Meter', term: 'inflation' },
      { id: 'rate', name: 'Fed Funds Slider', term: 'federal-funds-rate' },
      { id: 'vel', name: 'Money Velocity', term: 'velocity' },
    ],
  };

  /* Wire-service headlines for the ticker, by year range. */
  const HEADLINES = [
    [1848, 1853, 'SHIPS ABANDONED IN SAN FRANCISCO BAY AS CREWS DESERT FOR THE DIGGINGS'],
    [1848, 1855, 'SAN FRANCISCO: EGGS FETCH A DOLLAR APIECE AS MINERS FLOOD IN'],
    [1849, 1858, 'NEW STRIKE REPORTED ON THE FEATHER RIVER'],
    [1849, 1856, 'ASSAY BACKLOG GROWS; GOLD DUST TRADES AT A DISCOUNT TO COIN'],
    [1850, 1870, 'STAGECOACH ROBBED NEAR PLACERVILLE; STRONGBOX TAKEN'],
    [1851, 1855, "PRIVATE MINTS STRIKE $50 'SLUGS' AMID COIN SHORTAGE"],
    [1854, 1858, 'SAN FRANCISCO MINT OPENS ITS DOORS'],
    [1859, 1866, 'WASHOE FEVER: PROSPECTORS STAMPEDE OVER THE SIERRA'],
    [1861, 1866, 'GREENBACKS TRADE AT A STEEP DISCOUNT TO GOLD'],
    [1862, 1866, 'UNION WAR FINANCE LEANS ON WESTERN GOLD AND SILVER'],
    [1866, 1876, 'HOOSAC TUNNEL CREWS TRIAL COMPRESSED-AIR DRILLS'],
    [1869, 1872, 'BLACK FRIDAY: GOULD AND FISK TRY TO CORNER THE GOLD MARKET'],
    [1873, 1878, 'PANIC OF 1873: JAY COOKE & CO. CLOSES ITS DOORS'],
    [1874, 1880, 'BLACK HILLS GOLD CONFIRMED BY ARMY EXPEDITION'],
    [1880, 1896, "PRICES FALL AGAIN; FARMERS DEMAND 'FREE SILVER'"],
    [1890, 1893, 'SHERMAN SILVER PURCHASE ACT SIGNED'],
    [1893, 1897, 'PANIC OF 1893: TREASURY GOLD RESERVE DWINDLES'],
    [1895, 1897, 'MORGAN SYNDICATE SHORES UP TREASURY GOLD'],
    [1897, 1900, "KLONDIKE! STEAMER DOCKS IN SEATTLE WITH 'A TON OF GOLD'"],
    [1900, 1913, 'WORLD GOLD OUTPUT CLIMBS; PRICES TURN UPWARD'],
    [1914, 1919, 'WAR IN EUROPE: GOLD FLOWS TO NEW YORK'],
    [1920, 1929, "ROARING TWENTIES: BROKERS' LOANS AT RECORD HIGHS"],
    [1930, 1933, 'BANK RUNS SPREAD; DEPOSITORS DEMAND GOLD'],
    [1933, 1936, 'GOLD CERTIFICATES MUST BE SURRENDERED'],
    [1934, 1941, 'EUROPEAN GOLD FLEES TO AMERICA AT $35'],
    [1937, 1941, 'FIRST GOLD SHIPMENTS REACH FORT KNOX UNDER ARMED GUARD'],
    [1941, 1946, 'WAR BONDS: BUY A SHARE IN AMERICA'],
    [1945, 1950, 'IMF AND WORLD BANK OPEN FOR BUSINESS'],
    [1950, 1960, 'DOLLAR SHORTAGE IN EUROPE EASES'],
    [1958, 1962, 'EUROPEAN CURRENCIES BECOME CONVERTIBLE'],
    [1960, 1965, 'LONDON GOLD PRICE SPIKES TO $40'],
    [1965, 1972, 'FRANCE CONVERTS DOLLARS INTO GOLD'],
    [1966, 1972, 'VIETNAM SPENDING WIDENS U.S. DEFICITS'],
    [1968, 1972, 'TWO-TIER GOLD MARKET: PRIVATE PRICE FLOATS FREE'],
    [1969, 1972, 'U.S. GOLD COVER SHRINKS AS FOREIGN DOLLAR CLAIMS MOUNT'],
  ];

  /* ------------------------------------------------------------------------
   * State
   * --------------------------------------------------------------------- */
  function emptyRun(now) {
    const buildings = {};
    BUILDINGS.forEach((b) => { buildings[b.id] = 0; });
    return {
      reserves: 0, minted: 0, spent: 0, charters: { c1848: true }, items: {}, buildings,
      shifts: 0, oreBroken: 0, shiftGold: 0, bestShift: 0, bestStrike: 0, lodes: 0, pace: 0, startedAt: now,
    };
  }

  function createState(now = Date.now()) {
    return {
      version: SAVE_VERSION,
      era: 'gold',
      dollars: 0,
      run: emptyRun(now),
      prestige: { credibility: 0, resets: 0 },
      stats: { lifetimeGold: 0, lifetimeDollars: 0, totalShifts: 0, totalOre: 0, playTime: 0, createdAt: now, bestShift: 0, bestStrike: 0, lodes: 0 },
      settings: { notation: 'suffix', motion: 'full', sound: true, buyAmount: 1, shopAmount: 1, shopFilter: 'all', lift: 88, debug: false, map: null, tab: 'mine' },
      flags: { introSeen: false, fromV1: false },
      codex: {},
      log: [],
      savedAt: now,
    };
  }

  const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

  /**
   * Validate and upgrade a parsed save. A v1 save (the pre-shift economy)
   * cannot be converted, so it starts a fresh era but keeps settings, codex
   * and play time; the engine archives the old save first.
   */
  function migrate(raw, now = Date.now()) {
    const s = createState(now);
    if (!raw || typeof raw !== 'object') return s;
    const se = raw.settings || {};
    s.settings.notation = se.notation === 'scientific' ? 'scientific' : 'suffix';
    s.settings.motion = se.motion === 'reduced' ? 'reduced' : 'full';
    s.settings.sound = se.sound === undefined ? true : !!se.sound;
    s.settings.debug = !!se.debug;
    s.settings.buyAmount = [1, 10, 100, 'max'].includes(se.buyAmount) ? se.buyAmount : 1;
    if (raw.codex) Object.keys(raw.codex).forEach((id) => { if (GLOSSARY[id] && raw.codex[id]) s.codex[id] = true; });
    const st = raw.stats || {};
    s.stats.playTime = Math.max(0, num(st.playTime, 0));
    s.stats.createdAt = num(st.createdAt, now);
    if (raw.version !== SAVE_VERSION) {
      s.flags.fromV1 = true;
      s.settings.sound = true; // v1 shipped with sound off; the shift plays best with it on
      return s;
    }
    s.settings.shopAmount = [1, 10, 'max'].includes(se.shopAmount) ? se.shopAmount : 1;
    s.settings.shopFilter = se.shopFilter === 'ready' ? 'ready' : 'all';
    s.settings.lift = [56, 88, 120].includes(se.lift) ? se.lift : 88;
    s.settings.map = MAP_BY_ID[se.map] ? se.map : null;
    s.settings.tab = ['mine', 'upgrades', 'territory', 'treasury'].includes(se.tab) ? se.tab : 'mine';
    s.era = raw.era === 'fiat' ? 'fiat' : 'gold';
    s.dollars = Math.max(0, num(raw.dollars, 0));
    const r = raw.run || {};
    ['reserves', 'minted', 'spent', 'shifts', 'oreBroken', 'shiftGold', 'bestShift', 'bestStrike', 'lodes', 'pace'].forEach((k) => { s.run[k] = Math.max(0, num(r[k], 0)); });
    s.run.startedAt = num(r.startedAt, now);
    if (r.charters) Object.keys(r.charters).forEach((id) => { if (CHARTER_BY_ID[id] && r.charters[id]) s.run.charters[id] = true; });
    if (r.items) Object.keys(r.items).forEach((id) => {
      const it = ITEM_BY_ID[id];
      if (!it || it.kind === 'charter') return;
      const v = Math.floor(num(r.items[id], 0));
      if (v > 0) s.run.items[id] = it.kind === 'level' ? Math.min(v, it.max) : 1;
    });
    BUILDINGS.forEach((b) => { s.run.buildings[b.id] = Math.max(0, Math.floor(num(r.buildings && r.buildings[b.id], 0))); });
    Object.keys(s.stats).forEach((k) => { s.stats[k] = num(st[k], s.stats[k]); });
    s.stats.lifetimeGold = Math.max(s.stats.lifetimeGold, s.run.reserves);
    const p = raw.prestige || {};
    s.prestige.credibility = Math.max(0, num(p.credibility, 0));
    s.prestige.resets = Math.max(0, num(p.resets, 0));
    s.flags.introSeen = !!(raw.flags && raw.flags.introSeen);
    s.log = Array.isArray(raw.log) ? raw.log.filter((e) => e && typeof e.text === 'string').slice(-40) : [];
    s.savedAt = num(raw.savedAt, now);
    return s;
  }

  /* ------------------------------------------------------------------------
   * Requirements, prices and quotes
   * --------------------------------------------------------------------- */
  function yearOf(state) {
    let y = CHARTERS[0].year;
    for (const c of CHARTERS) if (state.run.charters[c.id] && c.year > y) y = c.year;
    return y;
  }

  function dateLabel(year) {
    const y = Math.floor(year);
    return `${MONTHS[Math.min(11, Math.floor((year - y) * 12))]} ${y}`;
  }

  function plural(name, n) {
    return n === 1 ? name : name.endsWith('x') ? `${name}es` : `${name}s`;
  }

  function level(state, id) {
    return state.run.items[id] || 0;
  }

  function owns(state, id) {
    const it = ITEM_BY_ID[id];
    if (!it) return false;
    return it.kind === 'charter' ? !!state.run.charters[id] : level(state, id) > 0;
  }

  /** Unmet requirements of an item, as short readable lines (empty = available). */
  function missing(state, it) {
    const req = it.requires || {};
    const out = [];
    if (req.charter && !state.run.charters[req.charter]) {
      const c = CHARTER_BY_ID[req.charter];
      out.push(`Sign ${c.title} (${Math.floor(c.year)})`);
    }
    if (req.item && !owns(state, req.item)) out.push(`Buy ${ITEM_BY_ID[req.item].name}`);
    if (req.prev && !owns(state, req.prev)) out.push(`Buy ${ITEM_BY_ID[req.prev].name}`);
    if (req.site && state.run.buildings[req.site] < (req.owned || 1)) {
      out.push(`Own ${req.owned} ${plural(BUILDING_BY_ID[req.site].name, req.owned)} (${state.run.buildings[req.site]} now)`);
    }
    if (req.year && yearOf(state) < req.year) {
      const c = CHARTERS.find((ch) => ch.year >= req.year);
      out.push(`Reach ${Math.floor(req.year)}${c ? ` (${c.title})` : ''}`);
    }
    if (req.reserves && state.run.reserves < req.reserves) out.push(`${fmt(req.reserves)} oz in the vault (${fmt(state.run.reserves, 1)} now)`);
    return out;
  }

  /** 'owned' | 'maxed' | 'available' | 'locked' */
  function status(state, it) {
    if (it.kind === 'level') {
      if (level(state, it.id) >= it.max) return 'maxed';
    } else if (owns(state, it.id)) {
      return 'owned';
    }
    return missing(state, it).length ? 'locked' : 'available';
  }

  function levelCost(it, lvl, n = 1) {
    const g = it.growth;
    return Math.ceil(it.base * Math.pow(g, lvl) * (Math.pow(g, n) - 1) / (g - 1));
  }

  function maxLevels(it, lvl, dollars) {
    const left = it.max - lvl;
    const first = it.base * Math.pow(it.growth, lvl);
    if (dollars < first || left <= 0) return 0;
    let n = Math.floor(Math.log((dollars * (it.growth - 1)) / first + 1) / Math.log(it.growth));
    n = Math.min(n, left);
    while (n > 0 && levelCost(it, lvl, n) > dollars) n--;
    return n;
  }

  /** {n, cost} for buying `amount` (1 / 10 / 100 / 'max') of an item. */
  function quote(state, it, amount = 1) {
    if (it.kind !== 'level') return { n: 1, cost: it.cost };
    const lvl = level(state, it.id);
    const left = it.max - lvl;
    if (left <= 0) return { n: 0, cost: Infinity };
    let n = amount === 'max' ? maxLevels(it, lvl, state.dollars) : Math.min(amount, left);
    if (n < 1) n = 1;
    return { n, cost: levelCost(it, lvl, n) };
  }

  function buildingCost(def, owned, amount = 1) {
    const r = COST_GROWTH;
    return Math.ceil(def.unitCost * Math.pow(r, owned) * (Math.pow(r, amount) - 1) / (r - 1));
  }

  function maxAffordable(def, owned, dollars) {
    const r = COST_GROWTH;
    const first = def.unitCost * Math.pow(r, owned);
    if (dollars < first) return 0;
    let n = Math.floor(Math.log((dollars * (r - 1)) / first + 1) / Math.log(r));
    while (n > 0 && buildingCost(def, owned, n) > dollars) n--;
    return n;
  }

  function purchaseQuote(state, def, amount) {
    const owned = state.run.buildings[def.id];
    let n = amount === 'max' ? maxAffordable(def, owned, state.dollars) : amount;
    const isMax = amount === 'max';
    if (n < 1) n = 1;
    return { n, cost: buildingCost(def, owned, n), isMax };
  }

  function hasPermit(state, siteId) {
    return owns(state, `permit_${siteId}`);
  }

  /** What an item does, in one line, for the shop card. */
  function effectLine(state, it, d) {
    if (it.kind === 'level') {
      const lvl = level(state, it.id);
      const now = it.show(it.value(lvl));
      return lvl >= it.max ? now : `${now} → ${it.show(it.value(lvl + 1))}`;
    }
    if (it.kind === 'permit') {
      const b = BUILDING_BY_ID[it.site];
      return `Opens a ${b.name} claim: crews mine up to ${pct(b.limit * (it.site === 'vault' && d ? d.vaultMult : 1))} of your pace`;
    }
    if (it.kind === 'tier') return `${BUILDING_BY_ID[it.site].name} limit ×${TIER_MULTS[it.tier - 1]} → ×${it.mult}`;
    if (it.kind === 'tool') return it.effect || it.desc;
    return charterEffects(it, d).join(' · ') || 'History moves forward';
  }

  /** Readable effects of a charter, including what it unlocks in the shop. */
  function charterEffects(c, d) {
    const e = c.effects || {};
    const out = [];
    if (e.map) out.push(`New mine: ${MAP_BY_ID[e.map].name}`);
    if (e.veins) out.push('Rich veins appear in the rock');
    if (e.goldMult) out.push(`All gold +${Math.round(e.goldMult * 100)}%`);
    if (e.siteMult) out.push(`Crew output +${Math.round(e.siteMult * 100)}%`);
    if (e.oreMult) out.push(`Rock yields ×${e.oreMult}`);
    if (e.lode) out.push(`Mother Lode chance +${Math.round(e.lode * 100)}%`);
    if (e.vaultMult) out.push(`Treasury Vault ×${e.vaultMult}`);
    if (e.price) out.push(`Mint price $${e.price.toFixed(2)}/oz`);
    if (e.cover) out.push(`Gold cover ${Math.round(e.cover * 100)}%`);
    const unlocks = ITEMS.filter((it) => it.requires && it.requires.charter === c.id && it.kind !== 'charter').map((it) => it.name);
    if (unlocks.length) out.push(`Unlocks ${unlocks.join(', ')}`);
    return out;
  }

  function nextCharter(state) {
    return CHARTERS.find((c) => !state.run.charters[c.id]) || null;
  }

  /* ------------------------------------------------------------------------
   * Derived values: everything the engine and the mine need, from state.
   * --------------------------------------------------------------------- */
  // Weights for the "industrial index" that drives the territory's smog.
  const INDUSTRY_WEIGHT = { prospector: 0.2, sluice: 0.4, camp: 0.6, hydraulic: 1, stampmill: 1.6, shaft: 1.6, steamplant: 2.4, vault: 1.2 };
  const INDUSTRY_TOTAL = Object.values(INDUSTRY_WEIGHT).reduce((a, b) => a + b, 0) * 6;

  /** Share of your pace mined by `n` crews on a site with this limit. */
  function siteShare(limit, n) {
    return n > 0 ? (limit * n) / (n + CREW_HALF) : 0;
  }

  /** A share as a percentage, with more digits for small shares: 38%, 4.5%, 0.25%, 0.033%. */
  const pct = (v) => { const p = v * 100; return `${p >= 10 ? Math.round(p) : p >= 1 ? p.toFixed(1) : p >= 0.1 ? p.toFixed(2) : p.toFixed(3)}%`; };

  function derive(state) {
    const run = state.run;
    const ch = run.charters;
    const lv = (id) => level(state, id);
    const val = (id) => ITEM_BY_ID[id].value(lv(id));

    let goldMult = 1, siteMult = 1, oreMult = 1, lodeBonus = 0, vaultMult = 1, price = MINT_PRICE_1834, cover = 1;
    const maps = [];
    for (const c of CHARTERS) {
      if (!ch[c.id]) continue;
      const e = c.effects || {};
      if (e.goldMult) goldMult *= 1 + e.goldMult;
      if (e.siteMult) siteMult *= 1 + e.siteMult;
      if (e.oreMult) oreMult *= e.oreMult;
      if (e.lode) lodeBonus += e.lode;
      if (e.vaultMult) vaultMult *= e.vaultMult;
      if (e.price) price = e.price;
      if (e.cover) cover = e.cover;
    }
    for (const m of MAPS) if (ch[m.charter]) maps.push(m.id);
    const mapId = state.settings.map && maps.includes(state.settings.map) ? state.settings.map : maps[maps.length - 1];
    const map = MAP_BY_ID[mapId];
    const dollarsPerOz = price / cover;

    const tiers = {};
    BUILDINGS.forEach((b) => { tiers[b.id] = 0; });
    for (const it of ITEMS) if (it.kind === 'tier' && run.items[it.id]) tiers[it.site] = Math.max(tiers[it.site], it.tier);

    // Each site's crews approach its limit with diminishing returns; tiers
    // raise the limit. Crews mine that share of your pace.
    const limit = {}, buildingShare = {}, nextShare = {}, buildingRate = {}, nextRate = {};
    let paceShare = 0, industry = 0;
    const pace = run.pace;
    for (const b of BUILDINGS) {
      const n = run.buildings[b.id];
      limit[b.id] = b.limit * TIER_MULTS[tiers[b.id]] * siteMult * (b.id === 'vault' ? vaultMult : 1);
      buildingShare[b.id] = siteShare(limit[b.id], n);
      nextShare[b.id] = siteShare(limit[b.id], n + 1) - buildingShare[b.id];
      buildingRate[b.id] = buildingShare[b.id] * pace;
      nextRate[b.id] = nextShare[b.id] * pace;
      paceShare += buildingShare[b.id];
      if (n > 0) industry += INDUSTRY_WEIGHT[b.id] * (tiers[b.id] + 1);
    }
    const siteRate = paceShare * pace;

    const radius = val('radius');
    const yieldMult = val('assay') * oreMult * goldMult;
    const mine = {
      map: mapId,
      radius,
      damage: val('damage'),
      swing: val('speed'),
      critChance: val('crit'),
      critMult: val('critmult'),
      duration: val('duration'),
      cap: val('ground'),
      respawn: 0.32 * Math.pow(0.92, lv('ground')),
      hpMult: map.hp,
      goldMult: map.gold * yieldMult,
      lodeChance: Math.min(0.9, BASE_LODE_CHANCE + val('luck') + lodeBonus),
      veins: !!ch.c1853,
      dynamite: owns(state, 'tool_dynamite') ? val('dynamite') : 0,
      blast: radius * 1.35,
      drill: owns(state, 'tool_drill') ? val('drill') : 0,
      foreman: owns(state, 'tool_foreman'),
    };

    return {
      year: yearOf(state), goldMult, siteMult, oreMult, yieldMult, vaultMult, price, cover, dollarsPerOz,
      maps, map, mine, tiers, pace, paceShare, limit, buildingShare, nextShare, buildingRate, nextRate, siteRate, dollarRate: siteRate * dollarsPerOz,
      industry: Math.min(1, industry / INDUSTRY_TOTAL),
    };
  }

  /* ------------------------------------------------------------------------
   * Mutations
   * --------------------------------------------------------------------- */
  /** Put gold in the vault; the Mint issues dollars against it. Returns $. */
  function deposit(state, oz, d) {
    if (!(oz > 0)) return 0;
    const dollars = oz * (d || derive(state)).dollarsPerOz;
    state.run.reserves += oz;
    state.run.minted += dollars;
    state.dollars += dollars;
    state.stats.lifetimeGold += oz;
    state.stats.lifetimeDollars += dollars;
    return dollars;
  }

  /** Sites mine between shifts. Linear, so any dt (a frame or a month away) is exact. */
  function simulate(state, dt) {
    if (!(dt > 0)) return 0;
    const d = derive(state);
    const oz = d.siteRate * dt;
    deposit(state, oz, d);
    return oz;
  }

  /** Book a finished shift. Returns which records it broke. */
  function recordShift(state, result) {
    const r = state.run, s = state.stats;
    const records = { shift: result.gold > s.bestShift && s.bestShift > 0, strike: result.best > s.bestStrike && s.bestStrike > 0 };
    r.shifts++; s.totalShifts++;
    r.oreBroken += result.ore; s.totalOre += result.ore;
    r.shiftGold += result.gold;
    r.lodes += result.lodes; s.lodes += result.lodes;
    r.bestShift = Math.max(r.bestShift, result.gold); s.bestShift = Math.max(s.bestShift, result.gold);
    r.bestStrike = Math.max(r.bestStrike, result.best); s.bestStrike = Math.max(s.bestStrike, result.best);
    const shiftPace = Math.max(0, result.gold - (result.lodeGold || 0)) / Math.max(1, result.duration || 20);
    r.pace = r.pace > 0 ? r.pace + (shiftPace - r.pace) * PACE_MEMORY : shiftPace;
    return records;
  }

  function buy(state, id, amount = 1) {
    const it = ITEM_BY_ID[id];
    if (!it) return { ok: false, reason: 'unknown' };
    const st = status(state, it);
    if (st !== 'available') return { ok: false, reason: st };
    const q = quote(state, it, amount);
    if (q.cost > state.dollars) return { ok: false, reason: 'funds', cost: q.cost };
    state.dollars -= q.cost;
    state.run.spent += q.cost;
    if (it.kind === 'charter') state.run.charters[id] = true;
    else if (it.kind === 'level') state.run.items[id] = level(state, id) + q.n;
    else state.run.items[id] = 1;
    return { ok: true, item: it, n: q.n, cost: q.cost };
  }

  function buyBuilding(state, id, amount) {
    const def = BUILDING_BY_ID[id];
    if (!def || !hasPermit(state, id)) return { ok: false };
    const q = purchaseQuote(state, def, amount);
    if (q.cost > state.dollars) return { ok: false, cost: q.cost };
    state.dollars -= q.cost;
    state.run.spent += q.cost;
    state.run.buildings[id] += q.n;
    return { ok: true, n: q.n, cost: q.cost };
  }

  /** Glossary ids referenced by [[id|label]] markup in a string. */
  function termsIn(text) {
    const out = [];
    String(text || '').replace(/\[\[([a-z0-9-]+)\|[^\]]*\]\]/g, (_, id) => { if (!out.includes(id)) out.push(id); return ''; });
    return out;
  }

  const Economy = {
    SAVE_VERSION, COST_GROWTH, PACE_MEMORY, CREW_HALF, MAX_OFFLINE_SECONDS, GOLD_EVER_MINED_OZ, MINT_PRICE_1834, BASE_LODE_CHANCE, TIER_RULES, TIER_MULTS,
    BUILDINGS, BUILDING_BY_ID, MAPS, MAP_BY_ID, CHARTERS, CHARTER_BY_ID, CATEGORIES, ITEMS, ITEM_BY_ID,
    GLOSSARY, NIXON, FIAT_PREVIEW, HEADLINES,
    setNotation, fmt, fmtUSD, fmtTime, fmtClock, roundPrice,
    createState, migrate, yearOf, dateLabel, level, owns, missing, status, quote, levelCost,
    buildingCost, maxAffordable, purchaseQuote, hasPermit, effectLine, charterEffects, nextCharter,
    derive, siteShare, pct, deposit, simulate, recordShift, buy, buyBuilding, termsIn,
  };

  root.Economy = Economy;
  if (typeof module !== 'undefined' && module.exports) module.exports = Economy;
})(typeof window !== 'undefined' ? window : globalThis);
