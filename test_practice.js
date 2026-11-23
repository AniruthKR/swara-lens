// Practice-mode test: a reference phrase vs several attempts (different shruti, tempo, octave, deliberate mistakes).
// Usage: node test_practice.js
const DSP = require('./dsp.js');
const PRACTICE = require('./practice.js');
const g = (i) => DSP.GRID[i], SR = 44100;

function synth(plan, SA) {
  const lead = 0.3, total = lead + plan.reduce((a, p) => a + p.d, 0) + 0.3;
  const x = new Float32Array(Math.floor(total * SR));
  let tt = lead, ph = 0; const segs = plan.map((p, i) => { const s = { ...p, t0: tt, t1: tt + p.d, prev: i ? plan[i - 1].c : p.c }; tt += p.d; return s; });
  for (let i = 0; i < x.length; i++) {
    const t = i / SR, s = segs.find((q) => t >= q.t0 && t < q.t1); if (!s) continue;
    let c = s.c;
    if (s.glideIn && t < s.t0 + s.glideIn) c = s.prev + (s.c - s.prev) * ((t - s.t0) / s.glideIn);
    if (s.kampita) c += 50 * Math.sin(2 * Math.PI * 5.5 * (t - s.t0));
    ph += (2 * Math.PI * SA * Math.pow(2, c / 1200)) / SR;
    const env = Math.min(1, (t - s.t0) / 0.03, (s.t1 - t) / 0.03);
    let v = 0; for (let h = 1; h <= 5; h++) v += Math.sin(h * ph) / h;
    x[i] = 0.3 * env * v;
  }
  return x;
}
function analyse(x, forcedSa) {
  const x8 = DSP.resample(x, SR, DSP.SR), tr = DSP.createTracker(x8); tr.run(0, tr.total);
  const f0 = DSP.cleanF0(tr.result());
  return DSP.analyze(f0, forcedSa || DSP.detectSa(f0));
}
const refPlan = [
  { c: g(0), d: 0.8 }, { c: g(2), d: 0.8 }, { c: g(4), d: 1.0, kampita: true }, { c: g(7), d: 0.8, glideIn: 0.15 },
  { c: g(9), d: 0.8 }, { c: g(0) + 1200, d: 0.8 }, { c: g(9), d: 0.6 }, { c: g(7), d: 0.6 },
  { c: g(4), d: 0.6 }, { c: g(2), d: 0.6 }, { c: g(0), d: 1.4 },
];
const ref = analyse(synth(refPlan, 130.81));
let failed = false;
const fail = (m) => { console.error('FAIL:', m); failed = true; process.exitCode = 1; };

// 1. Same phrase, different shruti (E3), 20% slower: should score high and report nothing
const slow = refPlan.map((p) => ({ ...p, d: p.d * 1.2 }));
let r = PRACTICE.compare(ref, analyse(synth(slow, 164.81)));
console.log('different shruti + tempo   score', r.score, 'pitch', r.pitch, 'gamaka', r.gamaka, 'shift', r.shift, 'tempo', r.tempo, 'issues', r.notes.filter((n) => n.issues.length).length);
if (!r.ok || r.score < 90) fail('same phrase at another shruti/tempo should score >= 90, got ' + (r.score));
if (r.notes.some((n) => n.status === 'flat' || n.status === 'sharp' || n.status === 'missed')) fail('no note should be flagged for the faithful attempt');

// 2. Singing along at the reference's shruti but an octave lower (female reference, male voice, "same shruti" ticked)
const refHigh = analyse(synth(refPlan, 261.63));
r = PRACTICE.compare(refHigh, analyse(synth(refPlan, 130.81), 261.63));
console.log('octave lower, same Sa      score', r.score, 'shift', r.shift);
if (!r.ok || r.shift !== -1200 || r.score < 90) fail('octave-lower attempt should be shifted by -1200 and score >= 90');

// 3. Deliberate mistakes: G3 flat by 40 and no kampita, first D2 sharp by 40, no jaru into P
const bad = refPlan.map((p) => ({ ...p, d: p.d * 1.1 }));
bad[2] = { c: g(4) - 40, d: bad[2].d };
bad[3] = { c: g(7), d: bad[3].d };
bad[4] = { c: g(9) + 40, d: bad[4].d };
const badAn = analyse(synth(bad, 130.81));
r = PRACTICE.compare(ref, badAn);
console.log('with mistakes              score', r.score, 'pitch', r.pitch, 'gamaka', r.gamaka);
r.notes.forEach((n) => console.log('  ', n.token.padEnd(5), n.status.padEnd(7), n.dev == null ? '   -' : String(Math.round(n.dev)).padStart(4), n.issues.join(' ')));
const byName = (nm, k = 0) => r.notes.filter((n) => n.name === nm)[k];
const G = byName('G3'), D2 = byName('D2', 0), R2 = byName('R2'), S1 = byName('S', 0);
if (!G || G.status !== 'flat' || Math.abs(G.dev + 40) > 15) fail('G3 should be flat by ~40, got ' + JSON.stringify(G && [G.status, G.dev]));
if (!G || !G.issues.some((s) => /Gamaka missing/.test(s))) fail('G3 should report the missing kampita');
if (!D2 || D2.status !== 'sharp' || Math.abs(D2.dev - 40) > 15) fail('first D2 should be sharp by ~40');
if (!R2 || R2.status !== 'good') fail('R2 should be good');
if (!S1 || S1.status !== 'good') fail('opening S should be good');
if (r.score >= 90 || r.score < 40) fail('score with mistakes should be between 40 and 90, got ' + r.score);

// 4. Self-check without a reference: a mildly flat G3 (-25) and sharp D2 (+22), both still nearest their own swara
const mild = refPlan.map((p) => ({ ...p, glideIn: 0, kampita: false }));
mild[2] = { c: g(4) - 25, d: 1.0 }; mild[4] = { c: g(9) + 22, d: 0.8 };
const self = PRACTICE.intonation(analyse(synth(mild, 130.81)));
console.log('self-check score', self.score, '|', self.advice.join(' | '));
if (!self.ok || !self.advice.some((s) => /^G3 at [\d.]+ s: flat by about 2[0-9]/.test(s))) fail('self-check should flag the flat G3 with its time');
if (!self.advice.some((s) => /^D2 at [\d.]+ s: sharp by about 2[0-9]/.test(s))) fail('self-check should flag the sharp D2 with its time');
if (self.advice.length !== 2) fail('only the two off notes should be reported, got ' + self.advice.length);
// and the ambiguous case (G3 40 cents flat reads as G2 sharp) must carry the warning
const amb = PRACTICE.intonation(badAn);
console.log('ambiguous case             |', amb.advice.join(' | '));
if (!amb.advice.some((s) => /neighbouring swara/.test(s))) fail('large deviations should carry the neighbouring-swara warning');

// 5. Silence / too little input is handled, not thrown
r = PRACTICE.compare(ref, { notes: [], n: 0 });
if (r.ok) fail('empty attempt should not produce a report');

console.log(failed ? 'PRACTICE TEST FAILED' : 'PRACTICE TEST PASSED');
