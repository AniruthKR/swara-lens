// Raga identification on SIMULATED phrases (no audio). Usage: node test_raga.js [--tune]
// For each raga we generate phrases that follow its arohana / avarohana (random walk, skips, gamakas,
// pitch jitter, dropouts), run the real analysis + identification, and count how often the right
// note-set is ranked first. Scenarios: clean, noisy (tracker slips), wrong Sa, short clips.
// This tests the scoring logic. It does NOT prove performance on real recordings.
const DSP = require('./dsp.js');
const RAGAS = require('./ragas.js');
const RAGAID = require('./ragaid.js');

function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const gauss = (r) => Math.sqrt(-2 * Math.log(r() + 1e-9)) * Math.cos(2 * Math.PI * r());

function genF0(raga, r, o) {
  const keysOf = (set) => { const k = []; for (let key = -5; key <= 19; key++) if (set.includes(((key % 12) + 12) % 12)) k.push(key); return k; };
  const up = keysOf(raga.aroSet), down = keysOf(raga.avaSet);
  const notes = []; let cur = 0, t = 0;
  while (t < o.seconds) {
    const goUp = cur <= 0 ? r() < 0.75 : cur >= 14 ? r() < 0.2 : r() < 0.5;
    const steps = 1 + (r() < 0.35 ? 1 : 0) + (r() < 0.1 ? 1 : 0);
    const pool = goUp ? up.filter((k) => k > cur) : down.filter((k) => k < cur);
    if (pool.length) cur = goUp ? pool[Math.min(steps - 1, pool.length - 1)] : pool[Math.max(pool.length - steps, 0)];
    const d = r() < 0.1 ? 1.3 : 0.3 + r() * 0.7;
    notes.push({ key: cur, d, gam: r() < 0.3 }); t += d;
  }
  notes.push({ key: 0, d: 1.2, gam: false });
  const SA = 110 + r() * 90, dt = 0.01, frames = [];
  let prev = 0;
  for (const n of notes) {
    const nf = Math.round(n.d / dt), center = Math.floor(n.key / 12) * 1200 + DSP.GRID[((n.key % 12) + 12) % 12];
    const art = r() < o.noise ? { from: Math.floor(nf * 0.3), len: Math.round((0.12 + r() * 0.08) / dt), off: center + (r() < 0.5 ? -1 : 1) * (100 + (r() < 0.3 ? 100 : 0)) } : null;
    for (let i = 0; i < nf; i++) {
      let c = center;
      if (n.gam) c += 45 * Math.sin(2 * Math.PI * 5 * i * dt);
      if (art && i >= art.from && i < art.from + art.len) c = art.off;
      if (i < 6) c = prev + (c - prev) * ((i + 1) / 6);
      frames.push(c + gauss(r) * 5);
    }
    prev = center;
  }
  for (let i = 0; i < frames.length; i++) if (r() < 0.02) { const L = 1 + Math.floor(r() * 3); for (let k = 0; k < L && i + k < frames.length; k++) frames[i + k] = NaN; i += L; }
  const f0 = Float32Array.from(frames, (c) => (c === c ? SA * Math.pow(2, c / 1200) : 0));
  return { f0, SA };
}

// scenario: auto = Sa detected by the app (free tonic search); otherwise Sa is given (fixTonic) or deliberately wrong
function build(o, count) {
  const out = [];
  RAGAS.forEach((raga, ri) => {
    for (let k = 0; k < count; k++) {
      const r = rng(ri * 1000 + k * 7 + (o.seed || 1));
      const { f0, SA } = genF0(raga, r, o);
      let sa = SA;
      if (o.auto) sa = DSP.detectSa(f0);
      else if (o.wrongSa != null) sa = SA * Math.pow(2, DSP.GRID[o.wrongSa] / 1200);
      if (!sa) continue;
      const an = DSP.analyze(f0, sa);
      out.push({ raga, an, prior: DSP.tonicPrior(f0, sa), views: Array.from({ length: 12 }, (_, t) => RAGAID.view(an, t)) });
    }
  });
  return out;
}
function evaluate(label, data, o, opts, quiet) {
  let n = 0, top1 = 0, top3 = 0, high = 0, highRight = 0, amb = 0, ambRight = 0, tonicRight = 0;
  const misses = {};
  for (const d of data) {
    const res = RAGAID.identify(d.an, RAGAS, Object.assign({ prior: d.prior, views: d.views, fixTonic: o.fixTonic }, opts));
    n++;
    if (!res.ok) continue;
    const key = d.raga.notes.join(), keys = res.groups.map((g) => g.set.join());
    const right = keys[0] === key;
    if (right) top1++; else misses[d.raga.name] = (misses[d.raga.name] || 0) + 1;
    if (keys.includes(key)) top3++;
    if (res.confidence === 'high') { high++; if (right) highRight++; }
    if (res.ambiguousSa) { amb++; if (right || res.alts.some((a) => a.close && a.group.set.join() === key)) ambRight++; }
  }
  const pct = (x) => (100 * x / n).toFixed(1).padStart(5) + '%';
  if (!quiet) console.log(label.padEnd(36), 'top-1', pct(top1), ' top-3', pct(top3), ' | high-confidence: ' + high + ' answers, ' + (high ? Math.round(100 * highRight / high) : '-') + '% right', ' | Sa flagged ambiguous: ' + amb);
  return { top1: top1 / n, top3: top3 / n, n, high, highRight, amb, ambRight, misses };
}

const N = 4;
if (process.argv.includes('--tune')) {
  const A = build({ seconds: 30, noise: 0.05, seed: 31, auto: true }, 2), B = build({ seconds: 9, noise: 0.05, seed: 32, auto: true }, 2), C = build({ seconds: 30, noise: 0.15, seed: 33, auto: true }, 2);
  const res = [];
  for (const lambda of [0, 0.1, 0.2, 0.3, 0.5, 0.8, 1.2]) for (const beta of [1, 1.5, 2, 3]) for (const dirWeight of [0, 0.15, 0.3]) {
    const opts = { lambda, beta, dirWeight };
    res.push({ opts, score: (evaluate('', A, {}, opts, true).top1 + evaluate('', B, {}, opts, true).top1 + evaluate('', C, {}, opts, true).top1) / 3 });
  }
  res.sort((x, y) => y.score - x.score);
  res.slice(0, 6).forEach((r) => console.log(JSON.stringify(r.opts), (100 * r.score).toFixed(1) + '%'));
  process.exit(0);
}

console.log(RAGAS.length + ' ragas x ' + N + ' simulated phrases per scenario (full chain unless noted)');
const known = build({ seconds: 30, noise: 0, seed: 1 }, N), knownNoisy = build({ seconds: 30, noise: 0.15, seed: 2 }, N), knownShort = build({ seconds: 9, noise: 0.05, seed: 3 }, N);
const auto = build({ seconds: 30, noise: 0.05, seed: 4, auto: true }, N), autoShort = build({ seconds: 9, noise: 0.05, seed: 5, auto: true }, N), autoNoisy = build({ seconds: 30, noise: 0.15, seed: 6, auto: true }, N);
const K = evaluate('Sa given by user, clean 30 s', known, { fixTonic: true }, null);
const KN = evaluate('Sa given by user, noisy 30 s', knownNoisy, { fixTonic: true }, null);
evaluate('Sa given by user, short 9 s', knownShort, { fixTonic: true }, null);
const AU = evaluate('Sa AUTO-detected, 30 s', auto, {}, null);
evaluate('Sa AUTO-detected, short 9 s', autoShort, {}, null);
evaluate('Sa AUTO-detected, noisy 30 s', autoNoisy, {}, null);
console.log('most-missed with auto Sa:', Object.entries(AU.misses).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => k + ' x' + v).join(', '));
let bad = false; const fail = (m) => { console.error('FAIL:', m); bad = true; process.exitCode = 1; };
if (K.top1 < 0.9) fail('Sa given, clean: top-1 below 90%');
if (KN.top1 < 0.85) fail('Sa given, noisy: top-1 below 85%');
if (AU.top1 < 0.8) fail('Sa auto: top-1 below 80%');
if (AU.high && AU.highRight / AU.high < 0.95) fail('high-confidence answers should be right at least 95% of the time');
console.log(bad ? 'RAGA TEST FAILED' : 'RAGA TEST PASSED');
