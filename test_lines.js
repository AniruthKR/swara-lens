// Lead-line selection: voice + violin + tanpura + percussion. Usage: node test_lines.js
// The loudest melodic line should come out first; the quieter one second. Synthetic audio only.
const DSP = require('./dsp.js');
const MEL = require('./melody.js');
const SR = 44100, SA = 146.83, g = (i) => DSP.GRID[i];
let bad = false; const fail = (m) => { console.error('FAIL:', m); bad = true; process.exitCode = 1; };

// A: S R2 G3 P D2 S' D2 P G3 R2 S   B: a fourth above A (never an octave, fifth or unison of A)
const A = [0, 204, 386, 702, 906, 1200, 906, 702, 386, 204, 0].map((c) => c);
const B = A.map((c) => c + 498);
const NOTE = 0.9, LEAD = 0.5, total = LEAD + A.length * NOTE + 0.4, N = Math.floor(total * SR);

function line(cents, amp, harm, rolloff, delay, octaveUp, vib) {
  const x = new Float32Array(N), truth = new Float32Array(N); let ph = 0;
  for (let i = 0; i < N; i++) {
    const t = i / SR - LEAD - (delay || 0), idx = Math.floor(t / NOTE);
    if (t < 0 || idx >= cents.length) continue;
    const local = t - idx * NOTE;
    let c = cents[idx] + (octaveUp ? 1200 : 0) + (vib ? 20 * Math.sin(2 * Math.PI * 6 * t) : 0);
    const f = SA * Math.pow(2, c / 1200); truth[i] = f;
    ph += (2 * Math.PI * f) / SR;
    const env = Math.min(1, local / 0.04, (NOTE - local) / 0.04);
    let v = 0; for (let h = 1; h <= harm; h++) v += Math.sin(h * ph) / Math.pow(h, rolloff);
    x[i] = amp * env * v;
  }
  return { x, truth };
}
function drone() {
  const o = new Float32Array(N);
  [SA * 0.75, SA, SA, SA / 2].forEach((f, si) => { for (let h = 1; h <= 20; h++) { const w = 2 * Math.PI * f * h / SR, a = 0.012 / Math.pow(h, 0.7), p0 = Math.random() * 6.28; for (let i = 0; i < N; i++) o[i] += a * (0.6 + 0.4 * Math.sin(2 * Math.PI * (0.5 + 0.13 * si) * (i / SR) + si)) * Math.sin(w * i + p0); } });
  return o;
}
function perc() {
  const o = new Float32Array(N);
  for (let b = 0.3; b < total; b += 0.4) { const s0 = Math.floor(b * SR); for (let i = 0; i < 0.12 * SR && s0 + i < N; i++) { const e = Math.exp(-i / (0.03 * SR)); o[s0 + i] += 0.2 * e * (Math.random() * 2 - 1) + 0.15 * e * Math.sin(2 * Math.PI * 95 * i / SR); } }
  return o;
}
const TAN = drone(), PERC = perc();

function lines(mix) {
  const x16 = MEL.resample(mix, SR, MEL.SR), tm = MEL.createTracker(x16); tm.prepare(); tm.run(0, tm.total);
  return tm.finishLines(2);
}
const T0 = (1024 / 2) / MEL.SR;
function acc(f0, truth) {
  let n = 0, ok = 0;
  for (let i = 0; i < f0.length; i++) {
    const idx = Math.min(N - 1, Math.floor((T0 + i * 0.01) * SR)), tr = truth[idx];
    if (!(tr > 0)) continue; n++;
    if (f0[i] > 0 && Math.abs(1200 * Math.log2(f0[i] / tr)) <= 50) ok++;
  }
  return n ? ok / n : 0;
}
function scenario(name, srcs) {
  const mix = new Float32Array(N);
  for (let i = 0; i < N; i++) { let v = TAN[i] + PERC[i]; for (const s of srcs) v += s.x[i]; mix[i] = v; }
  const L = lines(mix);
  console.log(name.padEnd(46), 'lines found:', L.length, '| salience', L.map((l) => l.sal.toFixed(0)).join(' > '));
  return L;
}

// 1. loud voice (A), soft violin (B)
const voiceA = line(A, 0.12, 8, 0.9, 0, false, true), violinB = line(B, 0.045, 12, 0.6, 0, false, true);
let L = scenario('loud voice A, soft violin B', [voiceA, violinB]);
let a0 = acc(L[0].f0, voiceA.truth), a1 = L[1] ? acc(L[1].f0, violinB.truth) : 0;
console.log('   line 1 matches voice', (100 * a0).toFixed(0) + '%   line 2 matches violin', (100 * a1).toFixed(0) + '%');
if (a0 < 0.85) fail('dominant line should follow the loud voice');
if (a1 < 0.55) fail('second line should follow the soft violin');
if (L[1] && !(L[0].sal > L[1].sal)) fail('dominant line should have more salience');

// 2. loudness swapped: loud violin (B), soft voice (A)
const voiceSoft = line(A, 0.04, 8, 0.9, 0, false, true), violinLoud = line(B, 0.14, 12, 0.6, 0, false, true);
L = scenario('loud violin B, soft voice A', [voiceSoft, violinLoud]);
a0 = acc(L[0].f0, violinLoud.truth); a1 = L[1] ? acc(L[1].f0, voiceSoft.truth) : 0;
console.log('   line 1 matches violin', (100 * a0).toFixed(0) + '%   line 2 matches voice', (100 * a1).toFixed(0) + '%');
if (a0 < 0.85) fail('dominant line should now follow the loud violin');
if (a1 < 0.55) fail('second line should follow the soft voice');

// 3. violin doubles the voice an octave higher, a quarter second late: this is one melody, not two lines
const dbl = line(A, 0.05, 12, 0.6, 0.25, true, true);
L = scenario('voice with violin doubling an octave up', [voiceA, dbl]);
a0 = acc(L[0].f0, voiceA.truth);
console.log('   line 1 matches voice', (100 * a0).toFixed(0) + '%', L[1] ? '   second line covers ' + (100 * L[1].voiced).toFixed(0) + '% of the time' : '   no spurious second line');
if (a0 < 0.85) fail('with a doubling violin the dominant line should still follow the voice');

console.log(bad ? 'LINES TEST FAILED' : 'LINES TEST PASSED');
