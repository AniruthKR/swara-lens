/* Swara Lens - core DSP / analysis engine.
 * Pure JS, no dependencies. Works in the browser (window.DSP) and in Node (require).
 * Pipeline: audio -> 8 kHz mono -> YIN pitch track -> cleanup -> Sa detection
 *           -> swara segmentation -> gamaka heuristics -> raga suggestion.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DSP = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SR = 8000;            // analysis sample rate
  const HOP = 80;             // 10 ms hop
  const W = 512;              // 64 ms analysis window
  const FMIN = 70, FMAX = 1100;
  const TAU_MIN = Math.floor(SR / FMAX), TAU_MAX = Math.ceil(SR / FMIN);
  const DT = HOP / SR;        // seconds per frame
  const T0 = (W / 2) / SR;    // time of first frame centre
  const MIN_NOTE_FRAMES = 9;  // 90 ms

  // 12 swarasthanas in just intonation (cents above Sa)
  const RATIOS = [1, 16 / 15, 9 / 8, 6 / 5, 5 / 4, 4 / 3, 45 / 32, 3 / 2, 8 / 5, 5 / 3, 9 / 5, 15 / 8];
  const GRID = RATIOS.map((r) => 1200 * Math.log2(r));
  const NAMES = ['S', 'R1', 'R2', 'G2', 'G3', 'M1', 'M2', 'P', 'D1', 'D2', 'N2', 'N3'];

  function median(a) {
    if (!a.length) return NaN;
    const s = Array.from(a).sort((x, y) => x - y);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  // Swara symbol with octave dot (below = mandra, above = tara) placed after the first letter.
  function symbol(idx, oct) {
    const n = NAMES[idx];
    const mark = oct < 0 ? '\u0323' : oct > 0 ? '\u0307' : '';
    return n[0] + mark.repeat(Math.min(Math.abs(oct), 2)) + n.slice(1);
  }

  function toSwara(cents) {
    const oct = Math.floor(cents / 1200);
    const pc = cents - oct * 1200;
    let best = 0, bd = Infinity;
    for (let i = 0; i < 12; i++) {
      const d = Math.abs(pc - GRID[i]);
      if (d < bd) { bd = d; best = i; }
    }
    if (Math.abs(pc - 1200) < bd) return { idx: 0, oct: oct + 1, dev: pc - 1200 };
    return { idx: best, oct, dev: pc - GRID[best] };
  }

  // Box-average resampler (cheap anti-aliasing).
  function resample(x, srIn, srOut) {
    if (srIn === srOut) return x;
    const r = srIn / srOut, n = Math.floor(x.length / r), y = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = Math.floor(i * r), b = Math.max(a + 1, Math.floor((i + 1) * r));
      let s = 0, c = 0;
      for (let j = a; j < b && j < x.length; j++) { s += x[j]; c++; }
      y[i] = c ? s / c : 0;
    }
    return y;
  }

  // ---- YIN pitch estimator -------------------------------------------------
  function makeYin() {
    const d = new Float32Array(TAU_MAX + 1), c = new Float32Array(TAU_MAX + 1);
    return function (x, start, thresh) {
      let e = 0;
      for (let i = 0; i < W; i++) { const v = x[start + i]; e += v * v; }
      const rms = Math.sqrt(e / W);
      for (let tau = 1; tau <= TAU_MAX; tau++) {
        let s = 0;
        for (let i = 0; i < W; i++) { const df = x[start + i] - x[start + i + tau]; s += df * df; }
        d[tau] = s;
      }
      let run = 0; c[0] = 1;
      for (let tau = 1; tau <= TAU_MAX; tau++) { run += d[tau]; c[tau] = run > 0 ? (d[tau] * tau) / run : 1; }
      let tau = -1;
      for (let t = TAU_MIN; t < TAU_MAX; t++) {
        if (c[t] < thresh) { while (t + 1 < TAU_MAX && c[t + 1] < c[t]) t++; tau = t; break; }
      }
      if (tau < 0) return { f0: 0, rms, conf: 0 };
      let better = tau;
      if (tau > 1 && tau < TAU_MAX) {
        const a = c[tau - 1], b = c[tau], g = c[tau + 1], den = a - 2 * b + g;
        if (den !== 0) better = tau + (0.5 * (a - g)) / den;
      }
      return { f0: SR / better, rms, conf: 1 - c[tau] };
    };
  }

  // Incremental tracker so the UI can stay responsive on long files.
  function createTracker(x) {
    const total = Math.max(0, Math.floor((x.length - W - TAU_MAX - 1) / HOP));
    const f0 = new Float32Array(total), rms = new Float32Array(total), yin = makeYin();
    return {
      total,
      run(from, to) {
        const end = Math.min(to, total);
        for (let i = from; i < end; i++) { const r = yin(x, i * HOP, 0.15); f0[i] = r.f0; rms[i] = r.rms; }
      },
      result() {
        if (!total) return new Float32Array(0);
        const s = Float32Array.from(rms).sort();
        const gate = Math.max(0.003, 0.06 * s[Math.floor(0.95 * (total - 1))]);
        const out = new Float32Array(total);
        for (let i = 0; i < total; i++) out[i] = rms[i] >= gate ? f0[i] : 0;
        return out;
      },
    };
  }

  // Octave-error repair, isolated-frame removal, short-gap filling.
  function cleanF0(raw) {
    const n = raw.length, lg = new Float32Array(n), out = new Float32Array(n);
    for (let i = 0; i < n; i++) lg[i] = raw[i] > 0 ? Math.log2(raw[i]) : NaN;
    const R = 8;
    for (let i = 0; i < n; i++) {
      if (!(raw[i] > 0)) continue;
      const nb = [];
      for (let j = Math.max(0, i - R); j <= Math.min(n - 1, i + R); j++) if (j !== i && lg[j] === lg[j]) nb.push(lg[j]);
      let v = lg[i];
      if (nb.length >= 8) { const r = v - median(nb); if (Math.abs(r) > 0.7) v -= Math.round(r); }
      out[i] = Math.pow(2, v);
    }
    const res = Float32Array.from(out);
    for (let i = 0; i < n; i++) {
      if (!(out[i] > 0)) continue;
      let c = 0;
      for (let j = Math.max(0, i - 3); j <= Math.min(n - 1, i + 3); j++) if (j !== i && out[j] > 0) c++;
      if (c < 2) res[i] = 0;
    }
    let i = 0;
    while (i < n) {
      if (res[i] > 0) { i++; continue; }
      let j = i;
      while (j < n && !(res[j] > 0)) j++;
      if (i > 0 && j < n && j - i <= 5) {
        const a = Math.log2(res[i - 1]), b = Math.log2(res[j]);
        for (let k = i; k < j; k++) res[k] = Math.pow(2, a + ((b - a) * (k - i + 1)) / (j - i + 1));
      }
      i = j;
    }
    return res;
  }

  // ---- Sa (shruti) ---------------------------------------------------------
  // Put a pitch-class frequency into the octave that makes the singer's median pitch
  // sit between ~3 and ~15 semitones above Sa.
  function placeSa(classHz, f0) {
    const v = Array.prototype.filter.call(f0, (f) => f > 0);
    let sa = classHz;
    if (!v.length) return sa;
    const med = median(v);
    while ((1200 * Math.log2(med / sa)) >= 1500) sa *= 2;
    while ((1200 * Math.log2(med / sa)) < 300) sa /= 2;
    return sa;
  }

  // Heuristic: Sa and Pa are the most "anchored" notes, and phrases usually end on Sa.
  function detectSa(f0) {
    const n = f0.length, H = new Float64Array(1200);
    let voiced = 0;
    const tailFrom = n - Math.round(3 / DT);
    for (let i = 0; i < n; i++) {
      if (!(f0[i] > 0)) continue;
      voiced++;
      let pc = (1200 * Math.log2(f0[i] / 440)) % 1200;
      if (pc < 0) pc += 1200;
      H[Math.round(pc) % 1200] += i >= tailFrom ? 3 : 1;
    }
    if (voiced < 50) return null;
    const S = new Float64Array(1200), sigma = 12, rad = 36;
    const ker = []; for (let k = -rad; k <= rad; k++) ker.push(Math.exp(-(k * k) / (2 * sigma * sigma)));
    for (let c = 0; c < 1200; c++) {
      let s = 0;
      for (let k = -rad; k <= rad; k++) s += H[(c + k + 1200) % 1200] * ker[k + rad];
      S[c] = s;
    }
    let best = 0, bs = -1;
    for (let c = 0; c < 1200; c++) {
      const sc = S[c] + 0.5 * S[(c + 702) % 1200];
      if (sc > bs) { bs = sc; best = c; }
    }
    return placeSa(440 * Math.pow(2, best / 1200), f0);
  }

  // ---- Gamaka heuristics ---------------------------------------------------
  function zigzagTurns(d, th) {
    let mx = d[0], mn = d[0], dir = 0, ext = d[0], turns = 0;
    for (const v of d) {
      if (dir === 0) {
        mx = Math.max(mx, v); mn = Math.min(mn, v);
        if (v - mn >= th) { dir = 1; ext = v; } else if (mx - v >= th) { dir = -1; ext = v; }
      } else if (dir === 1) {
        if (v > ext) ext = v; else if (ext - v >= th) { dir = -1; ext = v; turns++; }
      } else {
        if (v < ext) ext = v; else if (v - ext >= th) { dir = 1; ext = v; turns++; }
      }
    }
    return turns;
  }

  function classifyGamaka(raw, dur) {
    const m = median(raw), d = raw.map((v) => v - m);
    const s = Array.from(d).sort((a, b) => a - b);
    const amp = s[Math.floor(0.9 * (s.length - 1))] - s[Math.floor(0.1 * (s.length - 1))];
    const turns = zigzagTurns(d, 18);
    const q = Math.max(2, Math.floor(d.length / 4));
    const avg = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
    const drift = avg(d.slice(-q)) - avg(d.slice(0, q));
    const rate = dur > 0 ? turns / 2 / dur : 0;
    let type = 'steady';
    if (turns >= 3 && amp >= 40) type = rate >= 3.2 ? 'kampita' : 'andolita';
    else if (Math.abs(drift) >= 45) type = 'slide';
    else if (amp >= 55) type = 'wavering';
    return { type, amp: Math.round(amp), rate: +rate.toFixed(1), drift: Math.round(drift) };
  }

  // ---- Main analysis -------------------------------------------------------
  function analyze(f0, sa) {
    const n = f0.length;
    const cents = new Float32Array(n), center = new Float32Array(n).fill(NaN);
    for (let i = 0; i < n; i++) cents[i] = f0[i] > 0 ? 1200 * Math.log2(f0[i] / sa) : NaN;

    const R = 8;
    for (let i = 0; i < n; i++) {
      if (cents[i] !== cents[i]) continue;
      const w = [];
      for (let j = Math.max(0, i - R); j <= Math.min(n - 1, i + R); j++) if (cents[j] === cents[j]) w.push(cents[j]);
      if (w.length >= 5) center[i] = median(w);
    }
    const nanPre = new Int32Array(n + 1);
    for (let i = 0; i < n; i++) nanPre[i + 1] = nanPre[i] + (center[i] !== center[i] ? 1 : 0);
    const nanIn = (a, b) => (b < a ? 0 : nanPre[b + 1] - nanPre[a]);

    // runs of the same nearest swara, with hysteresis so boundaries do not flicker
    const runs = [];
    let cur = null;
    for (let i = 0; i < n; i++) {
      const c = center[i];
      if (c !== c) { cur = null; continue; }
      if (cur && cur.end === i - 1 && Math.abs(c - (cur.oct * 1200 + GRID[cur.idx])) <= 45) { cur.end = i; continue; }
      const sw = toSwara(c);
      cur = { idx: sw.idx, oct: sw.oct, key: sw.oct * 12 + sw.idx, start: i, end: i };
      runs.push(cur);
    }

    const big = runs.filter((r) => r.end - r.start + 1 >= MIN_NOTE_FRAMES);
    const notes = [];
    for (const b of big) {
      const prev = notes[notes.length - 1];
      const gap = prev ? b.start - prev.end - 1 : 0;
      const contiguous = !!prev && nanIn(prev.end + 1, b.start - 1) === 0;
      if (prev && contiguous && prev.key === b.key && gap >= 2 && gap <= 22) {
        prev.end = b.end; prev.touches++;           // quick excursion and return: sphurita / nokku-like
        continue;
      }
      let entry = 'onset', dir = 0;
      if (prev && contiguous) {
        dir = b.key > prev.key ? 1 : -1;
        entry = gap >= 6 ? 'glide' : 'direct';   // smoothing leaves 1-2 frames even on a sharp step
      }
      notes.push({ start: b.start, end: b.end, key: b.key, idx: b.idx, oct: b.oct, entry, dir, touches: 0, contiguous: !!prev && contiguous });
    }

    for (let k = 0; k < notes.length; k++) {
      const nt = notes[k];
      const raw = [];
      for (let i = nt.start; i <= nt.end; i++) if (cents[i] === cents[i]) raw.push(cents[i]);
      nt.t0 = T0 + nt.start * DT; nt.t1 = T0 + (nt.end + 1) * DT; nt.dur = nt.t1 - nt.t0;
      nt.name = NAMES[nt.idx]; nt.sym = symbol(nt.idx, nt.oct);
      nt.cents = median(raw);
      nt.dev = nt.cents - (nt.oct * 1200 + GRID[nt.idx]);
      nt.g = classifyGamaka(raw, nt.dur);
      nt.gapBefore = k ? nt.t0 - notes[k - 1].t1 : 0;
      let tok = nt.sym;
      if (nt.g.type === 'kampita') tok += '~';
      else if (nt.g.type === 'andolita') tok += '\u2248';
      else if (nt.g.type === 'slide') tok += nt.g.drift > 0 ? '\u2197' : '\u2198';
      if (nt.touches) tok += '*';
      if (nt.entry === 'glide') tok = (nt.dir > 0 ? '/' : '\\') + tok;
      nt.token = tok;
    }

    const fin = Array.prototype.filter.call(cents, (c) => c === c).sort((a, b) => a - b);
    const range = fin.length ? { lo: fin[Math.floor(0.01 * (fin.length - 1))], hi: fin[Math.floor(0.99 * (fin.length - 1))] } : null;
    return { cents, center, notes, n, sa, range, duration: T0 + n * DT, voicedFrac: n ? fin.length / n : 0 };
  }

  // ---- Raga suggestion -----------------------------------------------------
  function pitchClassShare(notes) {
    const w = new Float64Array(12);
    let total = 0;
    for (const n of notes) { w[n.idx] += n.dur; total += n.dur; }
    return { share: Array.from(w, (x) => (total ? x / total : 0)), total };
  }

  function suggestRagas(notes, ragas) {
    const { share, total } = pitchClassShare(notes);
    if (notes.length < 6 || total < 2.5) {
      return { ok: false, share, reason: 'Not enough sung material yet. Try at least ~5 seconds of clear singing or playing.' };
    }
    const scored = ragas.map((r) => {
      const set = r.notes;
      let inMass = 0, missing = 0;
      for (const i of set) { inMass += share[i]; if (share[i] < 0.02) missing++; }
      return { raga: r, score: Math.max(0, inMass - (0.6 * missing) / set.length) };
    }).sort((a, b) => b.score - a.score);
    const groups = [], seen = new Map();
    for (const s of scored) {
      const key = s.raga.notes.join(',');
      if (!seen.has(key)) { const g = { score: s.score, set: s.raga.notes, ragas: [] }; seen.set(key, g); groups.push(g); }
      seen.get(key).ragas.push(s.raga);
    }
    return { ok: true, share, groups: groups.slice(0, 3) };
  }

  // Single-shot pitch of the newest samples in a live buffer (for the tuner view).
  const liveYin = makeYin();
  function pitchOfBuffer(buf, sr) {
    const need = W + TAU_MAX + 1, x = resample(buf, sr, SR);
    if (x.length < need) return null;
    return liveYin(x, x.length - need, 0.15);
  }

  return { SR, DT, T0, GRID, NAMES, toSwara, symbol, resample, createTracker, cleanF0, placeSa, detectSa, analyze, suggestRagas, pitchOfBuffer, median };
});
