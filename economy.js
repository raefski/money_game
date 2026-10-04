/* ==========================================================================
   FULL FAITH & CREDIT — economy.js
   Pure economic model: definitions, formulas, simulation and number
   formatting. No DOM access, so it also loads in Node for balancing/tests.
   ========================================================================== */
(function (root) {
  'use strict';

  /* ------------------------------------------------------------------------
   * Constants
   * --------------------------------------------------------------------- */
  const SAVE_VERSION = 1;
  const COST_GROWTH = 1.13;               // each extra building costs 13% more
  const MILESTONE_BONUS = 0.04;           // +4% output per historical milestone
  const MAX_OFFLINE_SECONDS = 30 * 86400; // offline progress cap (30 days)
  const GOLD_EVER_MINED_OZ = 6.95e9;      // ≈216,000 t, all gold mined in history
  const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

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
    'marginal-cost': { era: 'gold', title: 'Marginal Cost', body: 'The cost of producing one more unit. The richest, easiest claims are worked first, so each additional ounce tends to cost more than the last.', game: 'Each extra building costs 13% more than the previous one.' },
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
   * Buildings — Phase 1 (Gold Era). `tiers` names the visual stage reached
   * by each building upgrade (tier 0 = base art, tier 5 = gilded).
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

  /* ------------------------------------------------------------------------
   * Upgrades
   * --------------------------------------------------------------------- */
  // Building tier upgrades: each doubles that building's output and advances
  // its artwork one visual stage. They must be bought in order.
  const TIER_RULES = [
    { owned: 1, costMult: 10, mult: 2 },
    { owned: 5, costMult: 50, mult: 2 },
    { owned: 25, costMult: 500, mult: 2 },
    { owned: 50, costMult: 50000, mult: 3 },
    { owned: 75, costMult: 5e5, mult: 3 },
  ];
  // Cumulative output multiplier at each visual tier (index 0 = no upgrades).
  const TIER_MULTS = TIER_RULES.reduce((acc, r) => { acc.push(acc[acc.length - 1] * r.mult); return acc; }, [1]);

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

  const UPGRADES = [];

  BUILDINGS.forEach((b) => {
    TIER_RULES.forEach((rule, i) => {
      const tier = i + 1;
      const info = TIER_TEXT[b.id][i];
      UPGRADES.push({
        id: `${b.id}-${tier}`, kind: 'building', building: b.id, tier,
        name: b.tiers[tier], cost: b.baseCost * rule.costMult, owned: rule.owned, mult: rule.mult,
        year: info.year || 0, desc: info.desc,
        requires: tier > 1 ? `${b.id}-${tier - 1}` : null,
      });
    });
  });

  // Strike (click) upgrades. `tool` selects the tool drawn on the click target.
  [
    { id: 'pick-iron', name: 'Iron Pickaxe', cost: 50, mult: 2, tool: 1, cond: (s) => s.run.clicks >= 10, hint: 'Strike the vein 10 times',
      desc: 'Trade the borrowed shovel for a forged iron pick.' },
    { id: 'pick-steel', name: 'Steel Pickaxe', cost: 750, mult: 2, tool: 2, cond: (s) => s.run.gold >= 300, hint: 'Mine 300 oz this era',
      desc: 'Hardened steel holds its edge against quartz.' },
    { id: 'black-powder', name: 'Black Powder', cost: 2e4, mult: 2, tool: 3, cond: (s) => s.run.gold >= 8000, hint: 'Mine 8,000 oz this era',
      desc: 'Hand-drilled holes packed with powder crack the vein wide open.' },
    { id: 'dynamite', name: "Nobel's Dynamite", cost: 5e5, pct: 0.01, tool: 4, year: 1867,
      desc: "Alfred Nobel's 1867 patent: far more stable, and far stronger, than black powder." },
    { id: 'pneumatic', name: 'Pneumatic Rock Drill', cost: 5e7, pct: 0.01, tool: 5, year: 1880,
      desc: 'Compressed-air drills, proven on the Hoosac Tunnel, replace the hammer and hand steel. A strike becomes industrial.' },
  ].forEach((u, i, arr) => {
    UPGRADES.push(Object.assign({ kind: 'click', year: 0, requires: i ? arr[i - 1].id : null }, u));
  });

  // Policy & infrastructure upgrades: global output bonuses unlocked by history.
  [
    { id: 'telegraph', name: 'Transcontinental Telegraph', year: 1861.8, cost: 4e5, bonus: 0.10, icon: 'telegraph',
      desc: 'October 1861: the telegraph links the coasts and the Pony Express folds within days. Prices and news now move at the speed of electricity.' },
    { id: 'railroad', name: 'The Golden Spike', year: 1869.36, cost: 5e6, bonus: 0.20, icon: 'train',
      desc: 'May 10, 1869: the Transcontinental Railroad is complete. [[transaction-costs|Transaction costs]] collapse and Eastern capital flows West.' },
    { id: 'goldact', name: 'Gold Standard Act', year: 1900.2, cost: 6e8, bonus: 0.25, icon: 'scroll',
      desc: 'Gold becomes the sole standard for redeeming paper money, settling the silver fight. Confidence in the [[gold-standard|gold standard]] attracts capital.' },
    { id: 'fedact', name: 'Federal Reserve Act', year: 1913.98, cost: 4e9, bonus: 0.35, icon: 'fed',
      desc: 'A central bank to furnish an "elastic currency" and act as lender of last resort. The [[federal-reserve|Federal Reserve]] is born. Remember this institution.' },
    { id: 'brettonwoods', name: 'Bretton Woods Agreement', year: 1944.55, cost: 1e11, bonus: 0.50, icon: 'globe',
      desc: "44 nations peg to the dollar and the dollar pegs to gold at $35. The dollar becomes the world's [[reserve-currency|reserve currency]]." },
    { id: 'marshallplan', name: 'Marshall Plan', year: 1948.26, cost: 2e11, bonus: 0.40, icon: 'ship',
      desc: 'About $13 billion rebuilds Western Europe and spreads dollars worldwide. The [[marshall-plan|Marshall Plan]] binds allies to the dollar system.' },
  ].forEach((u) => UPGRADES.push(Object.assign({ kind: 'global', requires: null }, u)));

  const UPGRADE_BY_ID = Object.fromEntries(UPGRADES.map((u) => [u.id, u]));

  /* ------------------------------------------------------------------------
   * Historical timeline. The calendar advances with gold mined this era
   * (log-interpolated between milestones). Every milestone adds +4% output.
   * --------------------------------------------------------------------- */
  const MILESTONES = [
    { id: 'm1848', year: 1848.06, at: 0, title: "Gold at Sutter's Mill", text: 'James Marshall spots gold flakes in the tailrace of [[sutters-mill|Sutter\'s Mill]]. The rush begins.' },
    { id: 'm1849', year: 1849.0, at: 40, title: 'The Forty-Niners', text: 'Some 90,000 fortune-seekers pour into California in a single year, paying in dust weighed by the [[troy-ounce|troy ounce]].' },
    { id: 'm1850', year: 1850.69, at: 700, title: 'California Statehood', text: "Gold fast-tracks California into the Union as the 31st state. Miners' codes define [[property-rights|property rights]] in the meantime." },
    { id: 'm1853', year: 1853.2, at: 6000, title: 'Hydraulic Mining', text: 'Edward Matteson turns a high-pressure hose on a hillside near Nevada City, and invents a new [[externality|externality]].' },
    { id: 'm1857', year: 1857.7, at: 6e4, title: 'Panic of 1857', text: 'Bank failures spread, and the loss of the gold ship SS Central America deepens the [[bank-run|panic]].' },
    { id: 'm1859', year: 1859.45, at: 2.5e5, title: 'The Comstock Lode', text: 'A fabulous silver-and-gold strike in Nevada: the [[comstock|Comstock Lode]] launches deep hard-rock mining.' },
    { id: 'm1862', year: 1862.15, at: 1.5e6, title: 'Legal Tender Act', text: 'Congress prints [[greenbacks|greenbacks]], paper money backed by nothing but law, to fund the Civil War.' },
    { id: 'm1869', year: 1869.36, at: 6e6, title: 'The Golden Spike', text: 'The Transcontinental Railroad is completed at Promontory Summit, Utah.' },
    { id: 'm1873', year: 1873.12, at: 2e7, title: "The Crime of '73", text: 'The Coinage Act drops the silver dollar. [[bimetallism|Bimetallism]] ends and gold alone anchors the dollar.' },
    { id: 'm1879', year: 1879.0, at: 6e7, title: 'Specie Resumption', text: 'Greenbacks become redeemable in gold coin again. Paper is "as good as gold": [[specie|specie]] payments resume.' },
    { id: 'm1887', year: 1887.5, at: 1.5e8, title: 'The Cyanide Process', text: 'The MacArthur–Forrest patent unlocks low-grade ore worldwide: [[cyanide-process|cyanide process]].' },
    { id: 'm1896', year: 1896.52, at: 4e8, title: 'Cross of Gold', text: '"You shall not crucify mankind upon a cross of gold." Bryan rails against [[deflation|deflation]] (William Jennings Bryan, 1896).' },
    { id: 'm1900', year: 1900.2, at: 8e8, title: 'Gold Standard Act', text: 'Gold becomes the sole standard for redeeming paper money: the [[gold-standard|gold standard]] made law.' },
    { id: 'm1907', year: 1907.8, at: 2e9, title: 'Panic of 1907', text: 'J. P. Morgan locks bankers in his library until they agree on a rescue. A [[bank-run|bank run]] without a central bank.' },
    { id: 'm1913', year: 1913.98, at: 5e9, title: 'Federal Reserve Act', text: 'America gets a central bank, the [[federal-reserve|Federal Reserve]], to provide an "elastic currency."' },
    { id: 'm1929', year: 1929.82, at: 1.5e10, title: 'Black Tuesday', text: 'The stock market crashes. Waves of [[bank-run|bank runs]] drain gold over the next three years.' },
    { id: 'm1933', year: 1933.26, at: 3e10, title: 'Executive Order 6102', text: 'Private gold hoarding is outlawed. Coins and bullion go to the Fed at $20.67: [[eo-6102|Executive Order 6102]].' },
    { id: 'm1934', year: 1934.08, at: 4.5e10, title: 'Gold Reserve Act', text: 'Gold is revalued from $20.67 to $35.00 an ounce. Your reserves gain 69% in dollar terms overnight: [[gold-reserve-act|Gold Reserve Act]].' },
    { id: 'm1936', year: 1936.95, at: 7e10, title: 'Fort Knox', text: "The Bullion Depository is completed in Kentucky to hold the nation's gold." },
    { id: 'm1944', year: 1944.55, at: 1.5e11, title: 'Bretton Woods', text: 'The world pegs to the dollar and the dollar to gold at $35: the [[bretton-woods|Bretton Woods system]].' },
    { id: 'm1948', year: 1948.26, at: 2.5e11, title: 'Marshall Plan', text: 'Dollars rebuild Europe and spread worldwide: the [[marshall-plan|Marshall Plan]].' },
    { id: 'm1960', year: 1960.8, at: 4e11, title: 'The Triffin Dilemma', text: 'A Yale economist warns the dollar-gold system contains the seeds of its own collapse: [[triffin-dilemma|Triffin dilemma]].' },
    { id: 'm1961', year: 1961.85, at: 5e11, title: 'London Gold Pool', text: 'Eight central banks join forces to defend $35 gold: the [[gold-pool|London Gold Pool]].' },
    { id: 'm1965', year: 1965.1, at: 6.5e11, title: "De Gaulle's Gambit", text: "France demands gold for its dollars and decries America's [[reserve-currency|exorbitant privilege]]." },
    { id: 'm1968', year: 1968.21, at: 8e11, title: 'Gold Pool Collapses', text: 'Private demand overwhelms the pool. A two-tier gold market emerges: [[gold-pool|London Gold Pool]].' },
    { id: 'm1971', year: 1971.62, at: 1e12, title: 'The Gold Window', text: 'Foreign claims on U.S. gold far exceed the vaults. The [[nixon-shock|Nixon Shock]] is now possible.' },
  ];

  /* Phase 2 gate: the "Sever the Gold Peg" prestige reset (Nixon Shock). */
  const NIXON = {
    cost: 1e12,
    /** Projected Central Bank Credibility for this era's mined gold. */
    credibility(runGold) {
      return runGold < 1e12 ? 0 : Math.floor(10 * Math.cbrt(runGold / 1e12));
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

  /* Lucky strikes: a glowing nugget appears in the territory now and then. */
  const LUCKY = {
    spawnMin: 80, spawnMax: 200, lifetime: 13,
    outcomes: [
      { id: 'motherlode', weight: 50, name: 'Mother Lode', text: 'A pocket of free gold!' },
      { id: 'fever', weight: 35, name: 'Gold Fever', text: 'Output ×7 for 77 seconds.', buff: { kind: 'production', mult: 7, duration: 77 } },
      { id: 'bonanza', weight: 15, name: 'Bonanza', text: 'Strikes ×77 for 13 seconds.', buff: { kind: 'click', mult: 77, duration: 13 } },
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
    return { gold: 0, clicks: 0, clickGold: 0, luckyStrikes: 0, startedAt: now, buildings, upgrades: {}, milestones: { m1848: true } };
  }

  function createState(now = Date.now()) {
    return {
      version: SAVE_VERSION,
      era: 'gold',
      gold: 0,
      run: emptyRun(now),
      buffs: [],
      prestige: { credibility: 0, resets: 0 },
      stats: { lifetimeGold: 0, totalClicks: 0, playTime: 0, luckyStrikes: 0, createdAt: now },
      settings: { notation: 'suffix', motion: 'full', sound: false, buyAmount: 1 },
      flags: { introSeen: false },
      codex: {},
      log: [],
      savedAt: now,
    };
  }

  const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

  /** Validate and upgrade a parsed save into a complete, current state. */
  function migrate(raw, now = Date.now()) {
    const s = createState(now);
    if (!raw || typeof raw !== 'object') return s;
    s.era = raw.era === 'fiat' ? 'fiat' : 'gold';
    s.gold = Math.max(0, num(raw.gold, 0));
    const r = raw.run || {};
    s.run.gold = Math.max(0, num(r.gold, 0));
    s.run.clicks = Math.max(0, num(r.clicks, 0));
    s.run.clickGold = Math.max(0, num(r.clickGold, 0));
    s.run.luckyStrikes = Math.max(0, num(r.luckyStrikes, 0));
    s.run.startedAt = num(r.startedAt, now);
    BUILDINGS.forEach((b) => { s.run.buildings[b.id] = Math.max(0, Math.floor(num(r.buildings && r.buildings[b.id], 0))); });
    if (r.upgrades) Object.keys(r.upgrades).forEach((id) => { if (UPGRADE_BY_ID[id] && r.upgrades[id]) s.run.upgrades[id] = true; });
    if (r.milestones) Object.keys(r.milestones).forEach((id) => { if (r.milestones[id]) s.run.milestones[id] = true; });
    s.buffs = Array.isArray(raw.buffs)
      ? raw.buffs.filter((b) => b && (b.kind === 'production' || b.kind === 'click') && num(b.remaining, 0) > 0)
        .map((b) => ({ id: String(b.id || b.kind), name: String(b.name || ''), kind: b.kind, mult: num(b.mult, 1), remaining: b.remaining, duration: num(b.duration, b.remaining) }))
      : [];
    const p = raw.prestige || {};
    s.prestige.credibility = Math.max(0, num(p.credibility, 0));
    s.prestige.resets = Math.max(0, num(p.resets, 0));
    const st = raw.stats || {};
    Object.keys(s.stats).forEach((k) => { s.stats[k] = num(st[k], s.stats[k]); });
    s.stats.lifetimeGold = Math.max(s.stats.lifetimeGold, s.run.gold);
    const se = raw.settings || {};
    s.settings.notation = se.notation === 'scientific' ? 'scientific' : 'suffix';
    s.settings.motion = se.motion === 'reduced' ? 'reduced' : 'full';
    s.settings.sound = !!se.sound;
    s.settings.buyAmount = [1, 10, 100, 'max'].includes(se.buyAmount) ? se.buyAmount : 1;
    s.flags.introSeen = !!(raw.flags && raw.flags.introSeen);
    if (raw.codex) Object.keys(raw.codex).forEach((id) => { if (GLOSSARY[id] && raw.codex[id]) s.codex[id] = true; });
    s.log = Array.isArray(raw.log) ? raw.log.filter((e) => e && typeof e.text === 'string').slice(-40) : [];
    s.savedAt = num(raw.savedAt, now);
    checkMilestones(s); // a newly added milestone may already be passed
    return s;
  }

  /* ------------------------------------------------------------------------
   * Formulas
   * --------------------------------------------------------------------- */
  /** Total cost of `amount` buildings when `owned` are already owned. */
  function buildingCost(def, owned, amount = 1) {
    const r = COST_GROWTH;
    return Math.ceil(def.baseCost * Math.pow(r, owned) * (Math.pow(r, amount) - 1) / (r - 1));
  }

  /** How many buildings `gold` can buy right now. */
  function maxAffordable(def, owned, gold) {
    const r = COST_GROWTH;
    const first = def.baseCost * Math.pow(r, owned);
    if (gold < first) return 0;
    let n = Math.floor(Math.log((gold * (r - 1)) / first + 1) / Math.log(r));
    while (n > 0 && buildingCost(def, owned, n) > gold) n--;
    return n;
  }

  /** Resolve the buy-amount setting (1 / 10 / 100 / 'max') to a count and price. */
  function purchaseQuote(state, def, amount) {
    const owned = state.run.buildings[def.id];
    let n = amount === 'max' ? maxAffordable(def, owned, state.gold) : amount;
    const isMax = amount === 'max';
    if (n < 1) n = 1;
    return { n, cost: buildingCost(def, owned, n), isMax };
  }

  function yearFor(runGold) {
    const ms = MILESTONES;
    if (runGold <= 0) return ms[0].year;
    const lg = Math.log10(runGold + 1);
    for (let i = 0; i < ms.length - 1; i++) {
      const a = ms[i], b = ms[i + 1];
      if (runGold < b.at) {
        const la = Math.log10(a.at + 1), lb = Math.log10(b.at + 1);
        const t = Math.min(1, Math.max(0, (lg - la) / (lb - la)));
        return a.year + t * (b.year - a.year);
      }
    }
    return ms[ms.length - 1].year;
  }

  function dateLabel(year) {
    const y = Math.floor(year);
    return `${MONTHS[Math.min(11, Math.floor((year - y) * 12))]} ${y}`;
  }

  function goldPrice(state) {
    return state.run.milestones.m1934 ? 35 : 20.67;
  }

  function isBuildingVisible(state, def, year) {
    return state.run.buildings[def.id] > 0 || year >= def.year;
  }

  function isUpgradeUnlocked(state, u, year) {
    if (u.year && year < u.year) return false;
    if (u.requires && !state.run.upgrades[u.requires]) return false;
    if (u.kind === 'building') return state.run.buildings[u.building] >= u.owned;
    if (u.cond) return u.cond(state);
    return true;
  }

  function availableUpgrades(state) {
    const year = yearFor(state.run.gold);
    return UPGRADES.filter((u) => !state.run.upgrades[u.id] && isUpgradeUnlocked(state, u, year))
      .sort((a, b) => a.cost - b.cost);
  }

  function upgradeEffect(u) {
    if (u.kind === 'building') return `${BUILDING_BY_ID[u.building].name} output ×${u.mult}`;
    if (u.kind === 'click') return u.mult ? `Strike yield ×${u.mult}` : `Strikes also yield +${Math.round(u.pct * 100)}% of output/sec`;
    return `All output +${Math.round(u.bonus * 100)}%`;
  }

  // Weights for the "industrial index" that drives the territory's smog.
  const INDUSTRY_WEIGHT = { prospector: 0.2, sluice: 0.4, camp: 0.6, hydraulic: 1, stampmill: 1.6, shaft: 1.6, steamplant: 2.4, vault: 1.2 };
  const INDUSTRY_TOTAL = Object.values(INDUSTRY_WEIGHT).reduce((a, b) => a + b, 0) * 6;

  /** Everything derived from state: multipliers, rates, click value. */
  function derive(state) {
    const run = state.run;
    const tiers = {};
    BUILDINGS.forEach((b) => { tiers[b.id] = 0; });
    let clickMult = 1, clickPct = 0, globalMult = 1, tool = 0;
    for (const u of UPGRADES) {
      if (!run.upgrades[u.id]) continue;
      if (u.kind === 'building') tiers[u.building] = Math.max(tiers[u.building], u.tier);
      else if (u.kind === 'click') { clickMult *= u.mult || 1; clickPct += u.pct || 0; tool = Math.max(tool, u.tool); }
      else globalMult *= 1 + u.bonus;
    }
    let milestones = 0;
    for (const m of MILESTONES) if (run.milestones[m.id]) milestones++;
    const milestoneMult = 1 + MILESTONE_BONUS * Math.max(0, milestones - 1);
    let prodBuff = 1, clickBuff = 1;
    for (const b of state.buffs) {
      if (b.kind === 'production') prodBuff *= b.mult; else clickBuff *= b.mult;
    }
    const unitRate = {}, buildingRate = {};
    let baseRate = 0, industry = 0;
    for (const b of BUILDINGS) {
      const unit = b.rate * TIER_MULTS[tiers[b.id]] * globalMult * milestoneMult;
      unitRate[b.id] = unit;
      buildingRate[b.id] = unit * run.buildings[b.id];
      baseRate += buildingRate[b.id];
      if (run.buildings[b.id] > 0) industry += INDUSTRY_WEIGHT[b.id] * (tiers[b.id] + 1);
    }
    const rate = baseRate * prodBuff;
    return {
      tiers, tool, clickMult, clickPct, globalMult, milestoneMult, milestones,
      prodBuff, clickBuff, unitRate, buildingRate, baseRate, rate,
      clickValue: (clickMult + clickPct * rate) * clickBuff,
      industry: Math.min(1, industry / INDUSTRY_TOTAL),
    };
  }

  /* ------------------------------------------------------------------------
   * Mutations
   * --------------------------------------------------------------------- */
  function earn(state, amount) {
    if (!(amount > 0)) return;
    state.gold += amount;
    state.run.gold += amount;
    state.stats.lifetimeGold += amount;
  }

  function nextMilestone(state) {
    for (const m of MILESTONES) if (!state.run.milestones[m.id]) return m;
    return null;
  }

  function checkMilestones(state, emit) {
    for (const m of MILESTONES) {
      if (state.run.milestones[m.id]) continue;
      if (state.run.gold < m.at * (1 - 1e-9)) break; // milestones are ordered
      state.run.milestones[m.id] = true;
      if (emit) emit({ type: 'milestone', milestone: m });
    }
  }

  /**
   * Advance the economy by `dt` seconds. Production is linear between
   * events (buff expiry, milestone bonuses), so we step from event to event
   * and the result is exact for any dt: one frame or thirty days offline.
   */
  function simulate(state, dt, emit) {
    let guard = 0;
    while (dt > 1e-9 && guard++ < 500) {
      const d = derive(state);
      let step = dt;
      for (const b of state.buffs) if (b.remaining < step) step = b.remaining;
      const next = nextMilestone(state);
      if (next && d.rate > 0) step = Math.min(step, Math.max(0, (next.at - state.run.gold) / d.rate));
      earn(state, d.rate * step);
      if (state.buffs.length) {
        for (const b of state.buffs) b.remaining -= step;
        const ended = state.buffs.filter((b) => b.remaining <= 1e-6);
        if (ended.length) {
          state.buffs = state.buffs.filter((b) => b.remaining > 1e-6);
          if (emit) ended.forEach((b) => emit({ type: 'buffEnd', buff: b }));
        }
      }
      dt -= step;
      checkMilestones(state, emit);
    }
  }

  /** Manual strike on the gold vein. Returns ounces gained. */
  function strike(state, emit) {
    const v = derive(state).clickValue;
    earn(state, v);
    state.run.clicks++;
    state.run.clickGold += v;
    state.stats.totalClicks++;
    checkMilestones(state, emit);
    return v;
  }

  function buyBuilding(state, id, amount) {
    const def = BUILDING_BY_ID[id];
    if (!def) return { ok: false };
    const year = yearFor(state.run.gold);
    if (!isBuildingVisible(state, def, year)) return { ok: false };
    const q = purchaseQuote(state, def, amount);
    if (q.cost > state.gold) return { ok: false, cost: q.cost };
    state.gold -= q.cost;
    state.run.buildings[id] += q.n;
    return { ok: true, n: q.n, cost: q.cost };
  }

  function buyUpgrade(state, id) {
    const u = UPGRADE_BY_ID[id];
    if (!u || state.run.upgrades[id]) return { ok: false };
    if (!isUpgradeUnlocked(state, u, yearFor(state.run.gold))) return { ok: false };
    if (u.cost > state.gold) return { ok: false };
    state.gold -= u.cost;
    state.run.upgrades[id] = true;
    return { ok: true, upgrade: u };
  }

  function rollLucky(rand = Math.random) {
    const total = LUCKY.outcomes.reduce((a, o) => a + o.weight, 0);
    let r = rand() * total;
    for (const o of LUCKY.outcomes) { if ((r -= o.weight) < 0) return o; }
    return LUCKY.outcomes[0];
  }

  /** Apply a lucky-strike outcome. Returns ounces gained (0 for buffs). */
  function applyLucky(state, outcome, emit) {
    state.run.luckyStrikes++;
    state.stats.luckyStrikes++;
    if (outcome.buff) {
      const existing = state.buffs.find((b) => b.id === outcome.id);
      if (existing) existing.remaining = Math.max(existing.remaining, outcome.buff.duration);
      else state.buffs.push({ id: outcome.id, name: outcome.name, kind: outcome.buff.kind, mult: outcome.buff.mult, remaining: outcome.buff.duration, duration: outcome.buff.duration });
      return 0;
    }
    const d = derive(state);
    const gain = 13 + Math.min(state.gold * 0.15, d.rate * 900);
    earn(state, gain);
    checkMilestones(state, emit);
    return gain;
  }

  /** Glossary ids referenced by [[id|label]] markup in a string. */
  function termsIn(text) {
    const out = [];
    String(text || '').replace(/\[\[([a-z0-9-]+)\|[^\]]*\]\]/g, (_, id) => { if (!out.includes(id)) out.push(id); return ''; });
    return out;
  }

  const Economy = {
    SAVE_VERSION, COST_GROWTH, MILESTONE_BONUS, MAX_OFFLINE_SECONDS, GOLD_EVER_MINED_OZ, TIER_RULES, TIER_MULTS,
    BUILDINGS, BUILDING_BY_ID, UPGRADES, UPGRADE_BY_ID, MILESTONES, GLOSSARY, NIXON, FIAT_PREVIEW, LUCKY, HEADLINES,
    setNotation, fmt, fmtUSD, fmtTime, fmtClock,
    createState, migrate,
    buildingCost, maxAffordable, purchaseQuote, yearFor, dateLabel, goldPrice,
    isBuildingVisible, isUpgradeUnlocked, availableUpgrades, upgradeEffect, derive, nextMilestone,
    earn, checkMilestones, simulate, strike, buyBuilding, buyUpgrade, rollLucky, applyLucky, termsIn,
  };

  root.Economy = Economy;
  if (typeof module !== 'undefined' && module.exports) module.exports = Economy;
})(typeof window !== 'undefined' ? window : globalThis);
