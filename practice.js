/* Swara Lens - practice feedback.
 *
 *   intonation(an)            self-check: how close are your held notes to the swarasthana grid?
 *   compare(refAn, attAn)     align your attempt to a reference with DTW, then report per note:
 *                             pitch (cents sharp/flat), missing or extra gamaka, timing.
 *
 * Both analyses are relative to their own Sa, so a different shruti does not matter, and an
 * attempt an octave away (male vs female voice) is shifted back automatically.
 * Everything here is descriptive and transparent: the thresholds are constants at the top.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./dsp.js'));
  else root.PRACTICE = factory(root.DSP);
})(typeof self !== 'undefined' ? self : this, function (DSP) {
  'use strict';

  const GOOD = 20;        // cents: within this is "good"
  const OFF = 35;         // cents: beyond this is reported as sharp / flat
  const OSC = { kampita: 1, andolita: 1 };
  const D = 3;            // DTW works on every 3rd frame (30 ms)
  const MAX_FRAMES = 2000; // about 60 s per clip

  const med = DSP.median;
  const noteScore = (d) => { const a = Math.abs(d); return a <= 15 ? 1 : Math.max(0, 1 - (a - 15) / 60); };

  // ---------- self-check, no reference needed ----------
  function intonation(an) {
    const steady = an.notes.filter((n) => n.g.type === 'steady' && n.dur >= 0.25);
    if (steady.length < 3) return { ok: false, reason: 'Need a few held (steady) notes of at least a quarter second. Try singing the swaras slowly, one at a time.' };
    let wsum = 0, ssum = 0;
    const by = new Map();
    for (const n of steady) {
      wsum += n.dur; ssum += n.dur * noteScore(n.dev);
      if (!by.has(n.idx)) by.set(n.idx, { idx: n.idx, name: n.name, devs: [], dur: 0 });
      const e = by.get(n.idx); e.devs.push(n.dev); e.dur += n.dur;
    }
    const bySwara = Array.from(by.values()).map((e) => ({ idx: e.idx, name: e.name, n: e.devs.length, mean: e.devs.reduce((a, b) => a + b, 0) / e.devs.length, dur: e.dur }))
      .sort((a, b) => a.idx - b.idx);
    const advice = [];
    const FAR = ' That is close to the neighbouring swara, so check which one you are aiming for. A reference recording settles this.';
    const tendency = new Set();
    // 1. a swara that is consistently off across the phrase
    for (const s of bySwara) {
      if (s.n >= 2 && Math.abs(s.mean) >= 15) {
        tendency.add(s.idx);
        advice.push(`${s.name} tends to be ${s.mean < 0 ? 'flat' : 'sharp'} by about ${Math.round(Math.abs(s.mean))}¢ (heard ${s.n} times).${Math.abs(s.mean) >= 25 ? FAR : ''}`);
      }
    }
    // 2. individual held notes that are off, even if the same swara was fine elsewhere
    let oneOffs = 0;
    for (const n of steady) {
      if (tendency.has(n.idx) || Math.abs(n.dev) <= GOOD || n.dur < 0.4 || oneOffs >= 4) continue;
      oneOffs++;
      advice.push(`${n.name} at ${n.t0.toFixed(1)} s: ${n.dev < 0 ? 'flat' : 'sharp'} by about ${Math.round(Math.abs(n.dev))}¢.${Math.abs(n.dev) >= 25 ? FAR : ''}`);
    }
    const steadiness = med(steady.map((n) => n.sd));
    if (steadiness > 14) advice.push(`Long notes wander by about ±${Math.round(steadiness)}¢. Try holding each one against a tanpura or shruti box.`);
    if (!advice.length) advice.push('Your held notes sit close to the swara positions. Nice.');
    return { ok: true, score: Math.round((100 * ssum) / wsum), steadiness: Math.round(steadiness), count: steady.length, bySwara, advice,
      caveat: 'Measured against pure (just-intonation) positions. Some ragas and gurus use slightly different shades for R2, G3, D2 or N3, so treat anything under about 20¢ as fine.' };
  }

  // ---------- DTW alignment ----------
  function alignDTW(a, b) {
    const n = a.length, m = b.length, INF = 1e9;
    const back = new Uint8Array(n * m);
    let prev = new Float32Array(m).fill(INF), cur = new Float32Array(m);
    const cost = (x, y) => {
      const nx = x !== x, ny = y !== y;
      if (nx && ny) return 0;
      if (nx || ny) return 0.5;
      return Math.min(Math.abs(x - y), 300) / 300;
    };
    const PEN = 0.1;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < m; j++) {
        const c = cost(a[i], b[j]);
        if (i === 0 && j === 0) { cur[j] = c; back[0] = 0; continue; }
        let best = INF, arg = 0;
        if (i > 0 && j > 0 && prev[j - 1] < best) { best = prev[j - 1]; arg = 0; }
        if (i > 0 && prev[j] + PEN < best) { best = prev[j] + PEN; arg = 1; }
        if (j > 0 && cur[j - 1] + PEN < best) { best = cur[j - 1] + PEN; arg = 2; }
        cur[j] = best + c; back[i * m + j] = arg;
      }
      const t = prev; prev = cur; cur = t;
    }
    const jmin = new Int32Array(n).fill(-1), jmax = new Int32Array(n).fill(-1);
    let i = n - 1, j = m - 1;
    while (i >= 0 && j >= 0) {
      if (jmin[i] < 0 || j < jmin[i]) jmin[i] = j;
      if (j > jmax[i]) jmax[i] = j;
      const s = back[i * m + j];
      if (i === 0 && j === 0) break;
      if (s === 0) { i--; j--; } else if (s === 1) i--; else j--;
    }
    return { jmin, jmax };
  }

  function sampleSeries(an) {
    const out = [];
    for (let i = 0; i < an.n; i += D) out.push(an.center[i]);
    return out;
  }

  // ---------- compare attempt with reference ----------
  function compare(refAn, attAn) {
    if (!refAn || refAn.notes.length < 3) return { ok: false, reason: 'The reference needs at least a few clear notes.' };
    if (!attAn || attAn.notes.length < 2) return { ok: false, reason: 'Could not hear enough of your attempt. Sing closer to the mic and keep the shruti low.' };
    const a = sampleSeries(refAn), b = sampleSeries(attAn);
    if (a.length > MAX_FRAMES || b.length > MAX_FRAMES) return { ok: false, reason: 'Practice clips are limited to about 60 seconds. Use a shorter phrase.' };

    const fa = a.filter((v) => v === v), fb = b.filter((v) => v === v);
    const diff = med(fb) - med(fa);
    const shift = Math.abs(diff) >= 800 ? Math.round(diff / 1200) * 1200 : 0;
    const b2 = b.map((v) => v - shift);
    const { jmin, jmax } = alignDTW(a, b2);

    const refFirst = refAn.notes[0].t0, refLast = refAn.notes[refAn.notes.length - 1].t1;
    const attFirst = attAn.notes[0].t0, attLast = attAn.notes[attAn.notes.length - 1].t1;
    const tempo = (attLast - attFirst) / Math.max(0.1, refLast - refFirst);

    // attempt contour warped onto the reference timeline (for the overlay plot)
    const warped = new Float32Array(refAn.n).fill(NaN);
    for (let i = 0; i < a.length; i++) {
      if (jmin[i] < 0) continue;
      const vals = [];
      for (let j = jmin[i]; j <= jmax[i]; j++) { const k = j * D; if (k < attAn.n && attAn.cents[k] === attAn.cents[k]) vals.push(attAn.cents[k] - shift); }
      if (vals.length) { const v = med(vals); for (let k = i * D; k < Math.min(refAn.n, (i + 1) * D); k++) warped[k] = v; }
    }

    const notes = [];
    let pitchW = 0, pitchS = 0, gTotal = 0, gHit = 0, inTune = 0;
    for (const nt of refAn.notes) {
      const len = nt.end - nt.start + 1;
      const iA = Math.floor((nt.start + 0.15 * len) / D), iB = Math.max(iA, Math.floor((nt.end - 0.15 * len) / D));
      let j0 = Infinity, j1 = -1;
      for (let i = iA; i <= iB && i < a.length; i++) { if (jmin[i] >= 0) { j0 = Math.min(j0, jmin[i]); j1 = Math.max(j1, jmax[i]); } }
      const rec = { token: nt.token, name: nt.name, t0: nt.t0, t1: nt.t1, refType: nt.g.type, attType: null, dev: null, status: 'missed', issues: [] };
      let raw = [];
      if (j1 >= j0) {
        const k0 = j0 * D, k1 = Math.min(attAn.n - 1, (j1 + 1) * D - 1);
        for (let k = k0; k <= k1; k++) if (attAn.cents[k] === attAn.cents[k]) raw.push(attAn.cents[k] - shift);
      }
      const need = Math.max(3, 0.35 * (j1 - j0 + 1) * D);
      if (raw.length < need) {
        rec.issues.push('Not heard here.');
      } else {
        const refMed = nt.cents;
        rec.dev = med(raw) - refMed;
        const ad = Math.abs(rec.dev);
        rec.status = ad <= GOOD ? 'good' : ad <= OFF ? 'close' : rec.dev < 0 ? 'flat' : 'sharp';
        if (rec.status === 'flat' || rec.status === 'sharp') rec.issues.push(`${rec.status === 'flat' ? 'Flat' : 'Sharp'} by about ${Math.round(ad)}¢.`);
        else if (rec.status === 'close') rec.issues.push(`Slightly ${rec.dev < 0 ? 'flat' : 'sharp'} (${Math.round(ad)}¢).`);

        const att = DSP.classifyGamaka(raw, raw.length * DSP.DT);
        rec.attType = att.type;
        const refOsc = !!OSC[nt.g.type], attOsc = !!OSC[att.type];
        if (nt.g.type !== 'steady') {
          gTotal++;
          const match = (refOsc && attOsc) || nt.g.type === att.type;
          if (match) gHit++;
          else if (refOsc && att.type === 'steady') rec.issues.push('Gamaka missing: the reference oscillates here (kampita).');
          else if (nt.g.type === 'slide' && att.type === 'steady') rec.issues.push('The reference slides within this note; yours is flat.');
          else rec.issues.push(`Movement differs: reference ${nt.g.type}, yours ${att.type}.`);
        } else if (att.type === 'kampita' || att.type === 'andolita' || att.type === 'wavering') {
          rec.issues.push(`Unsteady: the reference holds this note still, yours moves about ±${Math.round(att.amp / 2)}¢.`);
        }
        const span = (j1 - j0 + 1) * D * DSP.DT, rel = span / Math.max(0.05, nt.dur) / Math.max(0.3, tempo);
        if (nt.dur >= 0.3 && (rel < 0.55 || rel > 1.8)) rec.issues.push(rel < 1 ? 'Held much shorter than the reference.' : 'Held much longer than the reference.');
        pitchS += nt.dur * noteScore(rec.dev); if (ad <= OFF) inTune++;
      }
      pitchW += nt.dur;
      notes.push(rec);
    }
    const pitch = Math.round((100 * pitchS) / pitchW);
    const gamaka = gTotal ? Math.round((100 * gHit) / gTotal) : null;
    const score = gamaka == null ? pitch : Math.round(0.7 * pitch + 0.3 * gamaka);
    const worst = notes.filter((n) => n.issues.length && n.status !== 'good').slice(0, 3).map((n) => `${n.token}: ${n.issues[0]}`);
    return { ok: true, score, pitch, gamaka, gamakaCount: gTotal, inTune, noteCount: notes.length, shift, tempo: +tempo.toFixed(2), notes, warped, worst };
  }

  return { intonation, compare, GOOD, OFF };
});
