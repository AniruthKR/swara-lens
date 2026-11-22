// Node test: synthesize a Mohanam phrase with a known shruti, a kampita and a jaru, then run the engine.
// Usage: node test.js
const DSP = require('./dsp.js');
const RAGAS = require('./ragas.js');

const SA = 130.81, SR = 44100;
const g = (i) => DSP.GRID[i];
// [swara cents, duration, options]
const plan = [
  { c: g(0), d: 0.8 },
  { c: g(2), d: 0.8 },
  { c: g(4), d: 1.0, kampita: true },          // G3 with ~5.5 Hz oscillation, +/- 50 cents
  { c: g(7), d: 0.8, glideIn: 0.15 },          // jaru from G3 up to P
  { c: g(9), d: 0.8 },
  { c: g(0) + 1200, d: 0.8 },
  { c: g(9), d: 0.6 },
  { c: g(7), d: 0.6 },
  { c: g(4), d: 0.6 },
  { c: g(2), d: 0.6 },
  { c: g(0), d: 1.4 },                         // ends on Sa
];

const lead = 0.3;
const total = lead + plan.reduce((a, p) => a + p.d, 0) + 0.3;
const x = new Float32Array(Math.floor(total * SR));
let phase = 0, t = 0;
const segs = []; let tt = lead;
plan.forEach((p, i) => { segs.push({ ...p, t0: tt, t1: tt + p.d, prev: i ? plan[i - 1].c : p.c }); tt += p.d; });
for (let i = 0; i < x.length; i++) {
  t = i / SR;
  const s = segs.find((q) => t >= q.t0 && t < q.t1);
  if (!s) continue;
  let cents = s.c;
  if (s.glideIn && t < s.t0 + s.glideIn) cents = s.prev + (s.c - s.prev) * ((t - s.t0) / s.glideIn);
  if (s.kampita) cents += 50 * Math.sin(2 * Math.PI * 5.5 * (t - s.t0));
  const f = SA * Math.pow(2, cents / 1200);
  phase += (2 * Math.PI * f) / SR;
  const env = Math.min(1, (t - s.t0) / 0.03, (s.t1 - t) / 0.03);
  let v = 0; for (let h = 1; h <= 5; h++) v += Math.sin(h * phase) / h;
  x[i] = 0.3 * env * v;
}

const t0 = Date.now();
const x8 = DSP.resample(x, SR, DSP.SR);
const tr = DSP.createTracker(x8);
tr.run(0, tr.total);
const f0 = DSP.cleanF0(tr.result());
const sa = DSP.detectSa(f0);
const an = DSP.analyze(f0, sa);
const rag = DSP.suggestRagas(an.notes, RAGAS);
console.log('analysis ms:', Date.now() - t0);
console.log('true Sa', SA, '-> detected', sa && sa.toFixed(2));
console.log('notation:', an.notes.map((n) => n.token).join(' '));
an.notes.forEach((n) => console.log(n.sym.padEnd(4), n.entry.padEnd(7), n.g.type.padEnd(9), 'dur', n.dur.toFixed(2), 'dev', n.dev.toFixed(0), 'amp', n.g.amp, 'rate', n.g.rate));
console.log('raga groups:', rag.groups.map((gr) => gr.ragas.map((r) => r.name).join('/') + ' ' + (gr.score * 100).toFixed(0) + '%'));

// assertions
const fail = (m) => { console.error('FAIL:', m); process.exitCode = 1; };
if (!sa || Math.abs(1200 * Math.log2(sa / SA)) > 30) fail('Sa detection off by more than 30 cents');
const names = an.notes.map((n) => n.name).join(' ');
if (!names.startsWith('S R2 G3 P D2 S D2 P G3 R2 S')) fail('swara sequence mismatch: ' + names);
const g3 = an.notes.find((n) => n.name === 'G3');
if (!g3 || g3.g.type !== 'kampita') fail('G3 should be kampita');
const p = an.notes.find((n) => n.name === 'P');
if (!p || p.entry !== 'glide' || p.dir !== 1) fail('P should be entered by an upward glide');
const glides = an.notes.filter((n) => n.entry === 'glide').length;
if (glides !== 1) fail('expected exactly 1 glide, got ' + glides);
if (!rag.ok || rag.groups[0].ragas[0].name !== 'Mohanam') fail('top raga should be Mohanam');
if (!process.exitCode) console.log('ALL CHECKS PASSED');
