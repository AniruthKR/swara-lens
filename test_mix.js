// Stress test: voice phrase + tanpura drone + percussive noise, tracked by YIN and by the melody tracker.
// Usage: node test_mix.js
const DSP = require('./dsp.js');
const MEL = require('./melody.js');

const SA = 146.83, SR = 44100;
const g = (i) => DSP.GRID[i];
const plan = [
  [g(0), 0.8], [g(2), 0.8], [g(4), 1.0, 'k'], [g(7), 0.8], [g(9), 0.8],
  [g(0) + 1200, 0.8], [g(9), 0.6], [g(7), 0.6], [g(4), 0.6], [g(2), 0.6], [g(0), 1.4],
];
const lead = 0.5, total = lead + plan.reduce((a, p) => a + p[1], 0) + 0.5;
const N = Math.floor(total * SR);
const voice = new Float32Array(N), truth = new Float32Array(N); // truth in Hz, 0 = silent
let tt = lead; const segs = plan.map((p) => { const s = { c: p[0], t0: tt, t1: tt + p[1], k: p[2] === 'k' }; tt += p[1]; return s; });
let ph = 0;
for (let i = 0; i < N; i++) {
  const t = i / SR, s = segs.find((q) => t >= q.t0 && t < q.t1);
  if (!s) continue;
  let c = s.c; if (s.k) c += 50 * Math.sin(2 * Math.PI * 5.5 * (t - s.t0));
  const f = SA * Math.pow(2, c / 1200); truth[i] = f;
  ph += (2 * Math.PI * f) / SR;
  const env = Math.min(1, (t - s.t0) / 0.04, (s.t1 - t) / 0.04);
  let v = 0; for (let h = 1; h <= 8; h++) v += Math.sin(h * ph) / Math.pow(h, 0.9);
  voice[i] = 0.18 * env * v;
}

// tanpura: Pa, Sa, Sa, low Sa strings, always ringing, rich in harmonics
function drone(freqs, gain) {
  const out = new Float32Array(N);
  freqs.forEach((f, si) => {
    for (let h = 1; h <= 20; h++) {
      const w = (2 * Math.PI * f * h) / SR, amp = gain / Math.pow(h, 0.7), pphase = Math.random() * 6.28;
      for (let i = 0; i < N; i++) {
        const swell = 0.6 + 0.4 * Math.sin(2 * Math.PI * (0.55 + 0.1 * si) * (i / SR) + si);
        out[i] += amp * swell * Math.sin(w * i + pphase);
      }
    }
  });
  return out;
}
const tan = drone([SA * 1.5 / 2, SA, SA, SA / 2], 0.012);

// mridangam-ish: decaying noise+low tone bursts every 0.4 s
const perc = new Float32Array(N);
for (let b = 0.3; b < total; b += 0.4) {
  const s0 = Math.floor(b * SR);
  for (let i = 0; i < 0.12 * SR && s0 + i < N; i++) {
    const e = Math.exp(-i / (0.03 * SR));
    perc[s0 + i] += 0.2 * e * (Math.random() * 2 - 1) + 0.15 * e * Math.sin(2 * Math.PI * 95 * (i / SR));
  }
}

const mix = new Float32Array(N);
for (let i = 0; i < N; i++) mix[i] = voice[i] + tan[i] + perc[i];

function score(f0, dt, t0, label) {
  let voiced = 0, within50 = 0, octave = 0, false_pos = 0, silent = 0;
  for (let i = 0; i < f0.length; i++) {
    const idx = Math.min(N - 1, Math.floor((t0 + i * dt) * SR)), tr = truth[idx];
    if (tr > 0) {
      voiced++;
      if (f0[i] > 0) {
        const d = Math.abs(1200 * Math.log2(f0[i] / tr));
        if (d <= 50) within50++; else if (Math.abs(d - 1200) <= 50 || Math.abs(d - 2400) <= 50) octave++;
      }
    } else { silent++; if (f0[i] > 0) false_pos++; }
  }
  console.log(`${label.padEnd(24)} correct ${(100 * within50 / voiced).toFixed(1)}%   octave-errors ${(100 * octave / voiced).toFixed(1)}%   false pitch in silence ${(100 * false_pos / Math.max(1, silent)).toFixed(1)}%`);
  return within50 / voiced;
}

// YIN (existing)
const x8 = DSP.resample(mix, SR, DSP.SR);
const ty = DSP.createTracker(x8); ty.run(0, ty.total);
const yinF0 = DSP.cleanF0(ty.result());
const yinScore = score(yinF0, DSP.DT, DSP.T0, 'YIN on the mix');

// Melody tracker (new)
const t0 = Date.now();
const x16 = MEL.resample(mix, SR, MEL.SR);
const tm = MEL.createTracker(x16); tm.prepare(); tm.run(0, tm.total);
const melF0 = tm.finish();
console.log('melody tracker time:', Date.now() - t0, 'ms for', total.toFixed(1), 's of audio');
const melScore = score(melF0, MEL.HOP / MEL.SR, (1024 / 2) / MEL.SR, 'Melody tracker on the mix');

// Sanity: clean voice alone, YIN vs melody
const c8 = DSP.resample(voice, SR, DSP.SR); const tc = DSP.createTracker(c8); tc.run(0, tc.total);
score(DSP.cleanF0(tc.result()), DSP.DT, DSP.T0, 'YIN on clean voice');
const c16 = MEL.resample(voice, SR, MEL.SR); const tm2 = MEL.createTracker(c16); tm2.prepare(); tm2.run(0, tm2.total);
score(tm2.finish(), MEL.HOP / MEL.SR, (1024 / 2) / MEL.SR, 'Melody on clean voice');

if (melScore < 0.8) { console.error('FAIL: melody tracker below 80% on the mix'); process.exitCode = 1; }
else if (melScore <= yinScore) { console.error('FAIL: melody tracker is not better than YIN on the mix'); process.exitCode = 1; }
else console.log('MIX TEST PASSED');
