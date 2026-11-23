// Drone-based Sa cue: does the steady background tell us the tonic? Usage: node test_drone.js
// Synthetic tanpura (strings are Pa-Sa-Sa-lowSa, or Ma-Sa-Sa-lowSa) under a sung phrase, with percussion.
const DSP = require('./dsp.js');
const MEL = require('./melody.js');
const SR = 44100, g = (i) => DSP.GRID[i];
let bad = false; const fail = (m) => { console.error('FAIL:', m); bad = true; process.exitCode = 1; };

function tanpura(N, sa, strings) {
  const out = new Float32Array(N), freqs = strings.map((r) => sa * r);
  freqs.forEach((f, si) => {
    for (let h = 1; h <= 20; h++) {
      const w = (2 * Math.PI * f * h) / SR, a = 0.012 / Math.pow(h, 0.7), p0 = Math.random() * 6.28;
      for (let i = 0; i < N; i++) out[i] += a * (0.6 + 0.4 * Math.sin(2 * Math.PI * (0.5 + 0.13 * si) * (i / SR) + si)) * Math.sin(w * i + p0);
    }
  });
  return out;
}
function voice(N, sa, plan) {
  const x = new Float32Array(N); let t = 0.3, ph = 0;
  const segs = plan.map((p) => { const s = { c: p[0], t0: t, t1: t + p[1] }; t += p[1]; return s; });
  for (let i = 0; i < N; i++) {
    const tt = i / SR, s = segs.find((q) => tt >= q.t0 && tt < q.t1); if (!s) continue;
    ph += (2 * Math.PI * sa * Math.pow(2, s.c / 1200)) / SR;
    const env = Math.min(1, (tt - s.t0) / 0.04, (s.t1 - tt) / 0.04);
    let v = 0; for (let h = 1; h <= 8; h++) v += Math.sin(h * ph) / Math.pow(h, 0.9);
    x[i] = 0.1 * env * v;
  }
  return x;
}
function perc(N, total) {
  const o = new Float32Array(N);
  for (let b = 0.3; b < total; b += 0.4) { const s0 = Math.floor(b * SR); for (let i = 0; i < 0.12 * SR && s0 + i < N; i++) { const e = Math.exp(-i / (0.03 * SR)); o[s0 + i] += 0.2 * e * (Math.random() * 2 - 1) + 0.15 * e * Math.sin(2 * Math.PI * 95 * i / SR); } }
  return o;
}
function profileOf(x) {
  const x16 = MEL.resample(x, SR, MEL.SR), tm = MEL.createTracker(x16); tm.prepare();
  return tm.droneProfile();
}
const pcErr = (best, saHz) => { const want = (((1200 * Math.log2(saHz / 440)) % 1200) + 1200) % 1200; const d = Math.abs(best - want); return Math.min(d, 1200 - d); };

const plan = [[g(0), 1], [g(2), 1], [g(4), 1], [g(7), 1], [g(9), 1], [g(0) + 1200, 1], [g(7), 1], [g(4), 1], [g(0), 1.5]];
const total = 0.3 + 9.5 + 0.4, N = Math.floor(total * SR);
let correct = 0, trials = 0;
for (const sa of [110, 123.47, 138.59, 146.83, 164.81, 185, 207.65]) {
  for (const strings of [[1.5 / 2, 1, 1, 0.5], [4 / 3 / 2, 1, 1, 0.5]]) {   // Pa-Sa-Sa-Sa and Ma-Sa-Sa-Sa
    const mix = new Float32Array(N), t = tanpura(N, sa, strings), v = voice(N, sa, plan), p = perc(N, total);
    for (let i = 0; i < N; i++) mix[i] = t[i] + v[i] + p[i];
    const pr = profileOf(mix); trials++;
    const e = pcErr(pr.best, sa);
    if (e < 25) correct++; else console.log('  miss: Sa', sa, strings.map((x) => x.toFixed(2)).join('/'), 'error', e.toFixed(0), 'cents, drone confidence', pr.conf.toFixed(2));
  }
}
console.log(`drone Sa correct (pitch class): ${correct}/${trials}`);
if (correct < trials * 0.9) fail('drone should give the right Sa in at least 90% of cases');

// confidence should be clearly higher with a tanpura than without, and the tonic it points to should be right
const sa = 146.83, plan2 = plan;
let withSum = 0, withoutSum = 0, k = 0;
for (const strings of [[0.75, 1, 1, 0.5], [2 / 3, 1, 1, 0.5]]) for (const s0 of [123.47, 146.83, 185]) {
  const t = tanpura(N, s0, strings), v = voice(N, s0, plan2), p = perc(N, total);
  const a = new Float32Array(N), b = new Float32Array(N);
  for (let i = 0; i < N; i++) { a[i] = t[i] + v[i] + p[i]; b[i] = v[i] * 3 + p[i]; }
  withSum += profileOf(a).conf; withoutSum += profileOf(b).conf; k++;
}
console.log('mean drone confidence: with tanpura', (withSum / k).toFixed(2), '| voice + percussion only', (withoutSum / k).toFixed(2));
if (withSum / k < 0.5) fail('mean confidence with a tanpura should be at least 0.5');
if (withoutSum / k > 0.25) fail('mean confidence without a tanpura should be at most 0.25');
const tm = (() => { const t = tanpura(N, sa, [0.75, 1, 1, 0.5]), v = voice(N, sa, plan2), p = perc(N, total), m = new Float32Array(N); for (let i = 0; i < N; i++) m[i] = t[i] + v[i] + p[i]; return profileOf(m); })();
const dt = MEL.droneTonic(tm, sa, DSP.GRID);
if (!dt || dt.boost[0] < 0.99) fail('droneTonic should rate the true Sa highest');
else console.log('drone rating of the 12 candidate tonics (index 0 = true Sa):', dt.boost.map((x) => x.toFixed(2)).join(' '), '| conf', dt.conf.toFixed(2));
console.log(bad ? 'DRONE TEST FAILED' : 'DRONE TEST PASSED');
