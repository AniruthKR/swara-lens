/* Swara Lens - raga identification.
 *
 * What it uses (all computed from the pitch track, nothing is a black box):
 *   1. SWARA SHARES   how much of the singing sits on each of the 12 swarasthanas, counted per 10 ms frame
 *                     of the smoothed pitch, so ornaments and short slips do not outvote the held notes.
 *   2. COVERAGE       how many of a raga's own notes were actually used. A 7-note raga that never touched
 *                     one of its notes is less likely than a raga that uses exactly what was sung.
 *   3. DIRECTION FIT  going up, do you arrive on notes the raga allows in its arohana? Going down, its
 *                     avarohana? This separates ragas whose notes overlap but differ by direction.
 *   4. JOINT TONIC    every raga is scored against all 12 possible Sa positions, and each tonic is weighted
 *                     by how Sa-like it looks (phrase endings, Pa support, optional drone evidence).
 *                     Note usage alone cannot fix the tonic: the same notes are a different valid raga
 *                     under another Sa (graha bhedam). So the tonic evidence matters as much as the notes.
 *
 * It cannot hear characteristic phrases (pidi) or gamaka style, so ragas with identical notes stay grouped.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./dsp.js'));
  else root.RAGAID = factory(root.DSP);
})(typeof self !== 'undefined' ? self : this, function (DSP) {
  'use strict';

  const P = {
    floor: 0.02,      // swaras below 2% of the singing are treated as incidental
    beta: 1,          // how strongly an unused raga note counts against the raga
    alpha: 1.0,       // how strongly sung-but-not-in-raga mass counts against the raga
    dirWeight: 0.15,  // influence of the ascent/descent fit
    lambda: 0.3,      // how strongly a tonic that does not look like Sa is held against its reading
    ambig: 0.05,      // another tonic within this score of the best is reported as ambiguous
    tol: 45,          // cents: a frame further than this from every swara is ignored
  };

  // swara shares and direction steps as seen from tonic = Sa + GRID[t]
  function view(an, t) {
    const off = DSP.GRID[t], share = new Array(12).fill(0);
    let n = 0;
    for (let i = 0; i < an.n; i++) {
      const c = an.center[i];
      if (c !== c) continue;
      const sw = DSP.toSwara(c - off);
      if (Math.abs(sw.dev) <= P.tol) { share[sw.idx]++; n++; }
    }
    if (n) for (let i = 0; i < 12; i++) share[i] /= n;
    const steps = [];
    for (let k = 1; k < an.notes.length; k++) {
      const a = an.notes[k - 1], b = an.notes[k];
      if (!b.contiguous) continue;
      const sa = DSP.toSwara(a.cents - off), sb = DSP.toSwara(b.cents - off);
      const ka = sa.oct * 12 + sa.idx, kb = sb.oct * 12 + sb.idx;
      if (ka !== kb) steps.push({ from: sa.idx, to: sb.idx, dir: kb > ka ? 1 : -1 });
    }
    return { share, steps, frames: n };
  }

  function scoreRaga(r, v, o) {
    const set = new Set(r.notes), sh = v.share.map((x) => (x >= o.floor ? x : 0));
    const tot = sh.reduce((a, b) => a + b, 0) || 1;
    let inMass = 0, used = 0;
    for (const i of r.notes) { inMass += sh[i] / tot; if (sh[i] > 0) used++; }
    const coverage = used / r.notes.length;
    const aro = new Set(r.aroSet), ava = new Set(r.avaSet);
    let ok = 0, n = 0;
    for (const s of v.steps) {
      if (!set.has(s.from) || !set.has(s.to)) continue;
      n++; if (s.dir > 0 ? aro.has(s.to) : ava.has(s.to)) ok++;
    }
    const fit = (ok + 1) / (n + 2);
    const score = Math.pow(inMass, o.alpha) * Math.pow(coverage, o.beta) * (1 - o.dirWeight + o.dirWeight * fit);
    return { score, inMass, coverage, used, fit, steps: n };
  }

  // rank ragas under one tonic, grouping ragas that use exactly the same notes
  function rank(ragas, v, o) {
    const scored = ragas.map((r) => Object.assign({ raga: r }, scoreRaga(r, v, o))).sort((a, b) => b.score - a.score);
    const groups = [], seen = new Map();
    for (const s of scored) {
      const key = s.raga.notes.join(',');
      if (!seen.has(key)) { const g = { score: s.score, inMass: s.inMass, coverage: s.coverage, used: s.used, set: s.raga.notes, members: [] }; seen.set(key, g); groups.push(g); }
      seen.get(key).members.push(s);
    }
    for (const g of groups) g.ragas = g.members.map((m) => m.raga);
    return groups;
  }

  /* opts.prior      array of 12, DSP.tonicPrior(f0, an.sa): how Sa-like each tonic candidate is
   * opts.fixTonic   true when the user chose Sa themselves: only the given Sa is considered
   * opts.drone      optional { boost: array of 12 (0..1), conf: 0..1 } from MELODY.droneTonic */
  function identify(an, ragas, opts) {
    const o = Object.assign({}, P, opts || {});
    const secs = an.notes.reduce((a, n) => a + n.dur, 0);
    if (an.notes.length < 6 || secs < 2.5) return { ok: false, share: new Array(12).fill(0), reason: 'Not enough sung material yet. Try at least about 5 seconds of clear singing or playing.' };

    const tonics = o.fixTonic ? [0] : [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
    const readings = [], byT = {};
    for (const t of tonics) {
      const v = o.views && o.views[t] ? o.views[t] : view(an, t), groups = rank(ragas, v, o);
      let pr = o.prior ? o.prior[t] : (t === 0 ? 1 : 0.5);
      if (o.drone) { const w = 0.6 * o.drone.conf; pr = (1 - w) * pr + w * o.drone.boost[t]; }
      const pen = o.fixTonic ? 0 : o.lambda * (1 - pr);
      byT[t] = { v, groups, pen, prior: pr };
      for (let g = 0; g < Math.min(3, groups.length); g++) readings.push({ t, group: groups[g], adj: groups[g].score - pen, prior: pr });
    }
    readings.sort((a, b) => b.adj - a.adj);
    const best = readings[0], bt = byT[best.t];
    const saHz = (t) => an.sa * Math.pow(2, DSP.GRID[t] / 1200);
    const shown = bt.groups.slice(0, 3).map((g) => Object.assign({}, g, { adj: g.score - bt.pen }));

    // other tonics that read nearly as well: Sa is ambiguous
    const alts = [], seenT = new Set([best.t]);
    for (const r of readings) {
      if (seenT.has(r.t) || r.adj < best.adj - 0.12 || alts.length >= 2) continue;
      seenT.add(r.t); alts.push({ t: r.t, saHz: saHz(r.t), group: r.group, adj: r.adj, close: best.adj - r.adj <= o.ambig });
    }
    const second = shown[1], margin = best.adj - (second ? second.adj : 0);
    const ambiguousSa = alts.some((a) => a.close);
    let confidence = 'low';
    // "high" needs every note of the raga to have been heard, a clear lead, a settled Sa and enough material
    if (!alts.length && best.prior >= 0.85 && best.group.score >= 0.9 && best.group.coverage >= 0.99 && margin >= 0.08 && secs >= 12) confidence = 'high';
    else if (!ambiguousSa && best.group.score >= 0.8) confidence = 'medium';
    return { ok: true, tonic: { t: best.t, saHz: saHz(best.t), changed: best.t !== 0, prior: best.prior }, groups: shown, alts, ambiguousSa, confidence, margin, share: bt.v.share, seconds: secs };
  }

  return { identify, scoreRaga, view, rank, PARAMS: P };
});
