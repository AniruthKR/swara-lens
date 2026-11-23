/* Swara Lens - melody tracker for mixed music (voice + tanpura + violin + percussion).
 *
 * YIN assumes one pitch at a time. In a concert recording the tanpura drone, violin and
 * mridangam all fight for the answer. This tracker works in the spectral domain instead:
 *   1. FFT every 10 ms (64 ms Hann window, 16 kHz audio)
 *   2. Drone suppression: subtract each frequency bin's long-term low percentile.
 *      A tanpura sounds almost continuously, so it dominates that floor; a melody does not.
 *   3. Harmonic salience: for each candidate pitch (10-cent grid, 65-1100 Hz) add up the
 *      energy at its first 8 harmonics. A singing voice lights up many harmonics at once.
 *   4. Keep the 5 strongest peaks per frame, then pick one path through time with Viterbi,
 *      so the track stays continuous and a frame may be declared silent.
 * Output is one f0 value (Hz, 0 = no melody) every 10 ms, same grid as the YIN tracker.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MELODY = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SR = 16000, WIN = 1024, NFFT = 2048, HOP = 160;
  const FMIN = 65, FMAX = 1100, CENT_STEP = 10, NH = 8, K = 5;
  const BIN_HZ = SR / NFFT, NB = Math.floor(3500 / BIN_HZ);
  const NC = Math.ceil((1200 * Math.log2(FMAX / FMIN)) / CENT_STEP) + 1;
  const FLOOR_PCT = 0.35, FLOOR_GAIN = 1.0;
  const ALPHA = 0.06, TAU = 0.25, SWITCH = 0.25;

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

  function makeFFT(n) {
    const cos = new Float32Array(n / 2), sin = new Float32Array(n / 2), rev = new Uint16Array(n);
    for (let i = 0; i < n / 2; i++) { cos[i] = Math.cos((2 * Math.PI * i) / n); sin[i] = Math.sin((2 * Math.PI * i) / n); }
    const bits = Math.log2(n) | 0;
    for (let i = 0; i < n; i++) { let r = 0; for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b); rev[i] = r; }
    return function (re, im) {
      for (let i = 0; i < n; i++) {
        const j = rev[i];
        if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
      }
      for (let size = 2; size <= n; size <<= 1) {
        const half = size >> 1, step = n / size;
        for (let i = 0; i < n; i += size) {
          for (let j = i, k = 0; j < i + half; j++, k += step) {
            const l = j + half;
            const tre = re[l] * cos[k] + im[l] * sin[k], tim = -re[l] * sin[k] + im[l] * cos[k];
            re[l] = re[j] - tre; im[l] = im[j] - tim; re[j] += tre; im[j] += tim;
          }
        }
      }
    };
  }

  // lookup tables shared by all trackers
  const hann = new Float32Array(WIN);
  for (let i = 0; i < WIN; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (WIN - 1));
  const hw = new Float32Array(NH);
  for (let h = 0; h < NH; h++) hw[h] = Math.pow(0.85, h);
  const pos = new Float32Array(NC * NH), prior = new Float32Array(NC);
  for (let k = 0; k < NC; k++) {
    const f = FMIN * Math.pow(2, (k * CENT_STEP) / 1200);
    const x = Math.log2(f / 200) / 2.0;
    prior[k] = Math.exp(-0.5 * x * x);
    for (let h = 0; h < NH; h++) { const p = ((h + 1) * f) / BIN_HZ; pos[k * NH + h] = p < NB - 1 ? p : -1; }
  }
  const fft = makeFFT(NFFT);

  function createTracker(x) {
    const total = x.length >= WIN ? Math.floor((x.length - WIN) / HOP) + 1 : 0;
    const floor = new Float32Array(NB);
    const candC = new Float32Array(total * K), candS = new Float32Array(total * K), maxSal = new Float32Array(total);
    const re = new Float32Array(NFFT), im = new Float32Array(NFFT), mag = new Float32Array(NB), sal = new Float32Array(NC);

    function spectrum(i) {
      const s = i * HOP;
      let mean = 0;
      for (let j = 0; j < WIN; j++) mean += x[s + j];
      mean /= WIN;
      for (let j = 0; j < WIN; j++) { re[j] = (x[s + j] - mean) * hann[j]; im[j] = 0; }
      for (let j = WIN; j < NFFT; j++) { re[j] = 0; im[j] = 0; }
      fft(re, im);
      for (let b = 0; b < NB; b++) mag[b] = Math.sqrt(Math.sqrt(re[b] * re[b] + im[b] * im[b]));  // sqrt-compressed magnitude
    }

    return {
      total,
      // Pass 0: estimate the stationary floor (tanpura) from every 8th frame.
      prepare() {
        if (!total) return;
        const idx = []; for (let i = 0; i < total; i += 8) idx.push(i);
        const store = new Float32Array(idx.length * NB);
        idx.forEach((fi, r) => { spectrum(fi); store.set(mag, r * NB); });
        const col = new Float32Array(idx.length), q = Math.min(idx.length - 1, Math.floor(FLOOR_PCT * (idx.length - 1)));
        for (let b = 0; b < NB; b++) {
          for (let r = 0; r < idx.length; r++) col[r] = store[r * NB + b];
          floor[b] = Float32Array.from(col).sort()[q];
        }
      },
      // Pitch of the steady background (tanpura / shruti box). Call after prepare().
      // Returns a 1200-bin profile (cents above A, one octave) of how Sa-like each pitch class is
      // (its own weight plus half the weight of the note a fifth above), and how peaked it is.
      droneProfile() {
        const raw = new Float64Array(1200);
        for (let k = 0; k < NC; k++) {
          let s = 0;
          for (let h = 0; h < NH; h++) {
            const p = pos[k * NH + h];
            if (p < 0) break;
            const i0 = p | 0, fr = p - i0;
            s += hw[h] * (floor[i0] * (1 - fr) + floor[i0 + 1] * fr);
          }
          const f = FMIN * Math.pow(2, (k * CENT_STEP) / 1200);
          raw[Math.round((((1200 * Math.log2(f / 440)) % 1200) + 1200) % 1200) % 1200] += s;
        }
        const S = new Float64Array(1200), sigma = 12, rad = 36, ker = [];
        for (let k = -rad; k <= rad; k++) ker.push(Math.exp(-(k * k) / (2 * sigma * sigma)));
        for (let c = 0; c < 1200; c++) { let s = 0; for (let k = -rad; k <= rad; k++) s += raw[(c + k + 1200) % 1200] * ker[k + rad]; S[c] = s; }
        const score = new Float64Array(1200); let best = 0, mx = 0;
        for (let c = 0; c < 1200; c++) { score[c] = S[c] + 0.5 * S[(c + 702) % 1200]; if (score[c] > mx) { mx = score[c]; best = c; } }
        const sorted = Array.from(score).sort((a, b) => a - b), med = Math.max(1e-9, sorted[600]);
        // contrast: how far the best pitch class stands above a typical one. A real drone gives roughly 0.3 to 0.8,
        // noise and percussion alone roughly 0.1 to 0.4, so it is used as a soft weight, never a hard switch.
        const contrast = (mx - med) / med;
        return { score, best, max: mx, contrast, conf: Math.max(0, Math.min(1, (contrast - 0.25) / 0.45)) };
      },
      // Pass 1: salience and candidate peaks for frames [from, to)
      run(from, to) {
        const end = Math.min(to, total);
        for (let i = from; i < end; i++) {
          spectrum(i);
          for (let b = 0; b < NB; b++) { const v = mag[b] - FLOOR_GAIN * floor[b]; mag[b] = v > 0 ? v : 0; }
          for (let k = 0; k < NC; k++) {
            let s = 0;
            for (let h = 0; h < NH; h++) {
              const p = pos[k * NH + h];
              if (p < 0) break;
              const i0 = p | 0, fr = p - i0;
              s += hw[h] * (mag[i0] * (1 - fr) + mag[i0 + 1] * fr);
            }
            sal[k] = s * prior[k];
          }
          // top-K local maxima
          const bk = new Array(K).fill(-1), bv = new Array(K).fill(0);
          for (let k = 3; k < NC - 3; k++) {
            const v = sal[k];
            if (!(v > 0)) continue;
            let ok = true;
            for (let d = 1; d <= 3; d++) if (sal[k - d] > v || sal[k + d] > v) { ok = false; break; }
            if (!ok) continue;
            let slot = -1;
            for (let m = 0; m < K; m++) if (bk[m] < 0 || v > bv[m]) { slot = m; break; }
            if (slot < 0) continue;
            for (let m = K - 1; m > slot; m--) { bk[m] = bk[m - 1]; bv[m] = bv[m - 1]; }
            bk[slot] = k; bv[slot] = v;
          }
          for (let m = 0; m < K; m++) {
            if (bk[m] < 0) { candS[i * K + m] = 0; candC[i * K + m] = 0; continue; }
            const k = bk[m], a = sal[k - 1], b = sal[k], c = sal[k + 1], den = a - 2 * b + c;
            candC[i * K + m] = k + (den !== 0 ? 0.5 * (a - c) / den : 0);
            candS[i * K + m] = b;
          }
          maxSal[i] = bv[0];
        }
      },
      // Viterbi over candidates plus a "silent" state. mask[i*K+k] = 1 forbids that candidate.
      viterbi(mask) {
        const res = { f0: new Float32Array(total), cand: new Int8Array(total).fill(-1), sal: 0, voiced: 0 };
        if (!total) return res;
        const nz = Array.from(maxSal).filter((v) => v > 0).sort((a, b) => a - b);
        if (!nz.length) return res;
        const ref = nz[Math.floor(0.95 * (nz.length - 1))] || 1;
        const S = K + 1, back = new Uint8Array(total * S);
        let prev = new Float64Array(S), cur = new Float64Array(S);
        const emis = (i, k) => (k < K ? (candS[i * K + k] > 0 && !(mask && mask[i * K + k]) ? -Math.min(candS[i * K + k] / ref, 1.5) : 1e9) : -TAU);
        for (let k = 0; k < S; k++) prev[k] = emis(0, k);
        for (let i = 1; i < total; i++) {
          for (let k = 0; k < S; k++) {
            let best = Infinity, arg = 0;
            for (let j = 0; j < S; j++) {
              let tc;
              if (k < K && j < K) {
                tc = candS[(i - 1) * K + j] > 0 ? (ALPHA * Math.min(Math.abs(candC[i * K + k] - candC[(i - 1) * K + j]) * CENT_STEP, 1200)) / 100 : 1e9;
              } else tc = k === K && j === K ? 0 : SWITCH;
              const v = prev[j] + tc;
              if (v < best) { best = v; arg = j; }
            }
            cur[k] = best + emis(i, k); back[i * S + k] = arg;
          }
          const t = prev; prev = cur; cur = t;
        }
        let st = 0, bc = Infinity;
        for (let k = 0; k < S; k++) if (prev[k] < bc) { bc = prev[k]; st = k; }
        for (let i = total - 1; i >= 0; i--) {
          if (st < K && candS[i * K + st] > 0 && !(mask && mask[i * K + st])) {
            res.f0[i] = FMIN * Math.pow(2, (candC[i * K + st] * CENT_STEP) / 1200);
            res.cand[i] = st; res.sal += candS[i * K + st]; res.voiced++;
          }
          st = back[i * S + st];
        }
        res.voiced /= total;
        return res;
      },
      finish() { return this.viterbi(null).f0; },
      // Several melodic lines, dominant first. After each line is found, candidates at the same pitch and at
      // its harmonic "ghosts" (octaves, fifths above the octave, the fifth) are masked, so the next line is
      // something genuinely different. A line is dominant when it has more salience, i.e. it is louder and more
      // continuous after the steady drone has been removed. This separates melodic lines by pitch, it is not
      // source separation: a violin doubling the singer at the same pitch is one line, not two.
      finishLines(maxLines) {
        const lines = [], mask = new Uint8Array(total * K), ghosts = [0, 1200, -1200, 2400, -2400, 1902, -1902, 702, -702];
        for (let li = 0; li < (maxLines || 2); li++) {
          const r = this.viterbi(mask);
          if (r.voiced < 0.05) break;
          lines.push(r);
          for (let i = 0; i < total; i++) {
            const kc = r.cand[i]; if (kc < 0) continue;
            const c0 = candC[i * K + kc];
            for (let k = 0; k < K; k++) {
              const d = (candC[i * K + k] - c0) * CENT_STEP;
              for (const gh of ghosts) if (Math.abs(d - gh) < 100) { mask[i * K + k] = 1; break; }
            }
          }
        }
        return lines;
      },
    };
  }

  // For each of the 12 swarasthanas above saHz: how strongly does the drone say "this is Sa"? 0..1.
  // Returns { boost, conf } or null when the drone cue is negligible. conf (0..1) says how much to trust it.
  function droneTonic(drone, saHz, grid) {
    if (!drone || drone.conf < 0.05) return null;
    const boost = grid.map((g) => {
      const hz = saHz * Math.pow(2, g / 1200), c = Math.round((((1200 * Math.log2(hz / 440)) % 1200) + 1200) % 1200);
      let m = 0; for (let k = -15; k <= 15; k++) m = Math.max(m, drone.score[(c + k + 1200) % 1200]);
      return m / drone.max;
    });
    return { boost, conf: drone.conf };
  }

  return { SR, HOP, createTracker, resample, droneTonic };
});
