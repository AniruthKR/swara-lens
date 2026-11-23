/* Swara Lens - UI. All processing happens in the browser. */
(function () {
  'use strict';
  const { GRID, NAMES } = DSP;
  const $ = (id) => document.getElementById(id);
  const WEST = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const COL = { steady: '#5aa9ff', kampita: '#ff9d3c', andolita: '#c78bff', slide: '#4ed1a0', wavering: '#9aa4b2' };
  const LABEL = { steady: 'Steady', kampita: 'Kampita', andolita: 'Andolita', slide: 'Slide', wavering: 'Unsteady' };
  const STATUS_COL = { good: '#4ed1a0', close: '#ffd166', flat: '#ff6b6b', sharp: '#ff6b6b', missed: '#7b8494' };
  const MAX_SECONDS = 180, SR16 = 16000, LDT = 0.02;

  const state = { lines: null, lead: 0, drone: null, rag: null, x16: null, blob: null, f0: null, saHz: null, saAuto: true, an: null, mode: 'solo', name: '', source: 'record', run: 0 };
  const practice = { ref: null, att: null, res: null };

  // ---------------------------------------------------------------- helpers
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const posOf = (n) => n.oct * 1200 + GRID[n.idx];
  const fmtT = (t) => { t = Math.max(0, t); const m = Math.floor(t / 60), s = t - m * 60; return m ? m + ':' + (s < 10 ? '0' : '') + s.toFixed(0) : (Math.round(s * 10) / 10) + 's'; };
  const fmtClock = (t) => Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0');
  const mb = (b) => (b / 1048576 < 10 ? (b / 1048576).toFixed(1) : Math.round(b / 1048576)) + ' MB';
  let toastT = null;
  function toast(msg) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 5000); }

  function westernName(hz) {
    const m = 69 + 12 * Math.log2(hz / 440), n = Math.round(m);
    const dev = Math.round((m - n) * 100);
    return WEST[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1) + (dev ? ' ' + (dev > 0 ? '+' : '') + dev + '¢' : '');
  }
  function notationString(an) {
    let out = '';
    an.notes.forEach((n, i) => { out += (i && n.gapBefore > 0.35 ? ' | ' : i ? ' ' : '') + n.token; });
    return out;
  }
  function sizeCanvas(cv, w, h) {
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); cv.style.height = h + 'px';
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); return g;
  }
  function forGrid(lo, hi, cb) {
    for (let o = Math.floor(lo / 1200) - 1; o <= Math.ceil(hi / 1200) + 1; o++)
      for (let i = 0; i < 12; i++) { const p = o * 1200 + GRID[i]; if (p >= lo && p <= hi) cb(p, i, o); }
  }
  function rangeOf(cents) {
    let lo = Infinity, hi = -Infinity;
    for (const c of cents) if (c === c) { if (c < lo) lo = c; if (c > hi) hi = c; }
    if (lo === Infinity) return { lo: -200, hi: 1400 };
    lo -= 90; hi += 90;
    if (hi - lo < 800) { const m = (hi + lo) / 2; lo = m - 400; hi = m + 400; }
    return { lo, hi };
  }

  // ---------------------------------------------------------------- Viewer: fixed-width rolling window
  function Viewer(host, opts) {
    opts = opts || {};
    const GUT = 52, PADT = 20, PADB = 22;
    host.classList.add('viewer');
    host.innerHTML = '<div class="vbar"><span class="muted small">Window</span><div class="seg"></div><span class="vtime muted small"></span></div>' +
      '<canvas class="vplot" role="img" tabindex="0"></canvas>' +
      '<canvas class="vover" role="img" aria-label="Overview of the whole recording. Click or drag to move the window."></canvas>';
    const plot = host.querySelector('.vplot'), over = host.querySelector('.vover'), segEl = host.querySelector('.seg'), tEl = host.querySelector('.vtime');
    plot.setAttribute('aria-label', (opts.label || 'Pitch contour') + '. Drag to pan, click to jump, arrow keys to move.');
    const V = { live: false, onSeek: opts.onSeek || null };
    let data = null, win = opts.win == null ? 8 : opts.win, vs = 0, playT = null, holdUntil = 0;

    [[4, '4 s'], [8, '8 s'], [15, '15 s'], [0, 'All']].forEach(([n, l]) => {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = l; b.dataset.win = n;
      b.addEventListener('click', () => { win = n; sync(); V.draw(); });
      segEl.appendChild(b);
    });
    function sync() { segEl.querySelectorAll('button').forEach((b) => b.classList.toggle('on', Number(b.dataset.win) === win)); }
    sync();

    function geom() {
      const w = Math.max(260, Math.floor(plot.clientWidth || host.clientWidth || 600));
      const h = w < 560 ? 260 : 340;
      const dur = Math.max(0.5, data ? data.duration : 0.5);
      const W = V.live ? (win || 30) : (win ? Math.min(win, dur) : dur);
      return { w, h, dur, W, pps: (w - GUT - 8) / W };
    }

    V.draw = function () {
      if (!data) { const g0 = sizeCanvas(plot, 300, 60); g0.clearRect(0, 0, 300, 60); over.style.display = 'none'; tEl.textContent = ''; return; }
      const { w, h, dur, W, pps } = geom();
      vs = V.live ? Math.max(0, dur - W) : clamp(vs, 0, Math.max(0, dur - W));
      const g = sizeCanvas(plot, w, h), lo = data.lo, hi = data.hi;
      const X = (t) => GUT + (t - vs) * pps;
      const Y = (c) => PADT + ((hi - c) / (hi - lo)) * (h - PADT - PADB);
      g.fillStyle = '#0c1016'; g.fillRect(0, 0, w, h);

      g.save(); g.beginPath(); g.rect(GUT, 0, w - GUT, h); g.clip();
      // time grid
      const steps = [0.25, 0.5, 1, 2, 5, 10, 30, 60]; let step = 60;
      for (const s of steps) if (s * pps >= 64) { step = s; break; }
      g.font = '10px system-ui'; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
      for (let t = Math.ceil(vs / step) * step; t <= vs + W + 1e-6; t += step) {
        const x = X(t);
        g.strokeStyle = '#161c26'; g.lineWidth = 1; g.beginPath(); g.moveTo(x, PADT); g.lineTo(x, h - PADB); g.stroke();
        g.fillStyle = '#5d6a80'; g.fillText(fmtT(t), x + 3, h - 8);
      }
      // swarasthana grid
      const labels = [];
      if (data.grid !== false) {
        forGrid(lo, hi, (p, i, o) => {
          const y = Y(p);
          g.strokeStyle = i === 0 ? '#53627c' : i === 7 ? '#33405a' : '#1c2433'; g.lineWidth = i === 0 ? 1.4 : 1;
          g.beginPath(); g.moveTo(GUT, y); g.lineTo(w, y); g.stroke();
          labels.push([DSP.symbol(i, o), y, i]);
        });
      }
      // note bands
      for (const b of data.bands || []) {
        if (b.t1 < vs || b.t0 > vs + W) continue;
        const x0 = X(b.t0), x1 = X(b.t1), y = Y(b.pos);
        if (y < PADT - 8 || y > h - PADB + 8) continue;
        g.fillStyle = b.color + '33'; g.fillRect(x0, y - 8, x1 - x0, 16);
        g.strokeStyle = b.color; g.lineWidth = 1; g.strokeRect(x0 + .5, y - 7.5, Math.max(1, x1 - x0 - 1), 15);
        if (b.token && x1 - x0 > 14) { g.font = '600 11px system-ui'; g.fillStyle = '#e8ecf3'; g.fillText(b.token, x0 + 2, y - 11); }
      }
      // contours
      for (const s of data.series) {
        const n = s.vals.length;
        const i0 = Math.max(0, Math.floor((vs - s.t0) / s.dt) - 1), i1 = Math.min(n - 1, Math.ceil((vs + W - s.t0) / s.dt) + 1);
        g.strokeStyle = s.color; g.lineWidth = s.width || 2; g.lineJoin = 'round'; g.globalAlpha = s.alpha == null ? 1 : s.alpha;
        g.beginPath(); let pen = false;
        for (let i = i0; i <= i1; i++) {
          let c = s.vals[i];
          if (s.hz) c = c > 0 ? 1200 * Math.log2(c / s.sa) : NaN;
          if (!(c === c)) { pen = false; continue; }
          const x = X(s.t0 + i * s.dt), y = Y(c);
          if (pen) g.lineTo(x, y); else { g.moveTo(x, y); pen = true; }
        }
        g.stroke(); g.globalAlpha = 1;
      }
      // playhead
      if (playT != null && !V.live && playT >= vs && playT <= vs + W) {
        g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 2; g.beginPath(); g.moveTo(X(playT), PADT - 6); g.lineTo(X(playT), h - PADB); g.stroke();
      }
      g.restore();
      // swara labels in the gutter
      g.fillStyle = '#0c1016'; g.fillRect(0, 0, GUT, h);
      g.strokeStyle = '#262d3a'; g.beginPath(); g.moveTo(GUT - .5, 0); g.lineTo(GUT - .5, h); g.stroke();
      g.font = '11px system-ui'; g.textAlign = 'right'; g.textBaseline = 'middle';
      for (const [t, y, i] of labels) { g.fillStyle = i === 0 ? '#ffb454' : i === 7 ? '#c9d3e6' : '#7f8da4'; g.fillText(t, GUT - 7, y); }

      // overview strip
      const showOver = !V.live && W < dur - 0.01;
      over.style.display = showOver ? 'block' : 'none';
      if (showOver) {
        const oh = 44, og = sizeCanvas(over, w, oh);
        og.fillStyle = '#0c1016'; og.fillRect(0, 0, w, oh);
        for (const s of data.series) {
          const n = s.vals.length, stride = Math.max(1, Math.floor(n / w));
          og.strokeStyle = s.color; og.globalAlpha = .8; og.lineWidth = 1; og.beginPath(); let pen = false;
          for (let i = 0; i < n; i += stride) {
            const c = s.vals[i];
            if (!(c === c)) { pen = false; continue; }
            const x = ((s.t0 + i * s.dt) / dur) * w, y = 4 + ((hi - c) / (hi - lo)) * (oh - 8);
            if (pen) og.lineTo(x, y); else { og.moveTo(x, y); pen = true; }
          }
          og.stroke(); og.globalAlpha = 1;
        }
        const rx = (vs / dur) * w, rw = Math.max(6, (W / dur) * w);
        og.fillStyle = 'rgba(255,180,84,.18)'; og.fillRect(rx, 0, rw, oh);
        og.strokeStyle = '#ffb454'; og.lineWidth = 1.5; og.strokeRect(rx + .75, .75, rw - 1.5, oh - 1.5);
        if (playT != null) { og.strokeStyle = '#fff'; og.beginPath(); og.moveTo((playT / dur) * w, 0); og.lineTo((playT / dur) * w, oh); og.stroke(); }
      }
      tEl.textContent = V.live ? 'last ' + Math.round(W) + ' s' : fmtT(vs) + ' to ' + fmtT(Math.min(dur, vs + W)) + ' of ' + fmtT(dur);
    };

    V.setData = function (d, keepView) { data = d; if (!keepView && !V.live) vs = 0; V.draw(); };
    V.setPlayT = function (t, playing) {
      playT = t; if (!data || V.live) return;
      const { W, dur } = geom(), maxVs = Math.max(0, dur - W);
      if (playing && performance.now() >= holdUntil) vs = clamp(t - 0.3 * W, 0, maxVs);
      else if (t < vs || t > vs + W) vs = clamp(t - 0.3 * W, 0, maxVs);
      V.draw();
    };
    V.focus = function (t) { if (!data) return; const { W, dur } = geom(); vs = clamp(t - 0.3 * W, 0, Math.max(0, dur - W)); holdUntil = performance.now() + 2500; V.draw(); };
    V.windowSeconds = () => geom().W;

    // drag to pan, click to seek
    let drag = null;
    plot.addEventListener('pointerdown', (e) => {
      if (!data || V.live) return;
      drag = { x: e.clientX, vs, moved: false, pps: geom().pps };
      if (plot.setPointerCapture) { try { plot.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ } }
    });
    plot.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x;
      if (Math.abs(dx) > 4) drag.moved = true;
      if (drag.moved) { vs = drag.vs - dx / drag.pps; holdUntil = performance.now() + 2500; V.draw(); }
    });
    plot.addEventListener('pointerup', (e) => {
      if (!drag) return;
      const d = drag; drag = null;
      if (!d.moved && V.onSeek) {
        const r = plot.getBoundingClientRect(), t = vs + (e.clientX - r.left - GUT) / d.pps;
        if (t >= 0) V.onSeek(Math.min(t, data.duration));
      }
    });
    plot.addEventListener('pointercancel', () => { drag = null; });
    plot.addEventListener('keydown', (e) => {
      if (!data || V.live) return;
      const { W } = geom();
      if (e.key === 'ArrowLeft') { vs -= W * 0.25; } else if (e.key === 'ArrowRight') { vs += W * 0.25; } else return;
      holdUntil = performance.now() + 2500; e.preventDefault(); V.draw();
    });
    // overview: click or drag to move the window
    let od = false;
    const jump = (e) => {
      if (!data) return;
      const r = over.getBoundingClientRect(), t = ((e.clientX - r.left) / r.width) * data.duration;
      vs = t - geom().W / 2; holdUntil = performance.now() + 2500; V.draw();
    };
    over.addEventListener('pointerdown', (e) => { od = true; if (over.setPointerCapture) { try { over.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ } } jump(e); });
    over.addEventListener('pointermove', (e) => { if (od) jump(e); });
    over.addEventListener('pointerup', () => { od = false; });
    over.addEventListener('pointercancel', () => { od = false; });

    if (typeof ResizeObserver !== 'undefined') {
      let pend = false;
      new ResizeObserver(() => { if (pend) return; pend = true; requestAnimationFrame(() => { pend = false; V.draw(); }); }).observe(host);
    }
    return V;
  }

  // ---------------------------------------------------------------- live panel (record + tuner)
  function makeLive(host) {
    host.innerHTML = '<div class="live" hidden><div class="liveTop"><div class="liveNote" aria-live="off">-</div>' +
      '<div class="liveMeta"><span class="lhz">- Hz</span><span class="lcents muted"></span></div>' +
      '<span class="recDot">&#9679; recording <span class="ltime">0:00</span></span></div><div class="lview"></div></div>';
    const el = host.querySelector('.live');
    const viewer = Viewer(el.querySelector('.lview'), { win: 8, label: 'Live pitch' });
    viewer.live = true;
    return { el, viewer, note: el.querySelector('.liveNote'), hz: el.querySelector('.lhz'), cents: el.querySelector('.lcents'), time: el.querySelector('.ltime') };
  }

  const viewerMain = Viewer($('viewerMain'), { win: 8, label: 'Pitch contour of the recording', onSeek: (t) => seekPlayer(t) });
  const viewerPractice = Viewer($('viewerPractice'), { win: 8, label: 'Reference and your attempt' });
  const liveMain = makeLive($('liveMainHost')), liveAtt = makeLive($('liveAttHost'));

  // ---------------------------------------------------------------- audio -> pitch track
  async function decodeBlob(blob, startAt) {
    const AC = window.AudioContext || window.webkitAudioContext;
    const ac = new AC();
    try {
      const buf = await ac.decodeAudioData(await blob.arrayBuffer());
      const s0 = Math.min(Math.max(0, buf.length - 1), Math.floor((startAt || 0) * buf.sampleRate));
      const n = Math.min(buf.length - s0, Math.floor(MAX_SECONDS * buf.sampleRate));
      if (n < buf.sampleRate * 0.5) throw new Error('short');
      const mono = new Float32Array(n);
      for (let c = 0; c < buf.numberOfChannels; c++) { const ch = buf.getChannelData(c); for (let i = 0; i < n; i++) mono[i] += ch[s0 + i] / buf.numberOfChannels; }
      return { x16: MELODY.resample(mono, buf.sampleRate, SR16), seconds: n / buf.sampleRate };
    } finally { if (ac.close) ac.close(); }
  }

  // Solo: YIN, one line. Song: spectral melody tracker with drone suppression, up to two melodic lines
  // (dominant first) and the drone's pitch profile. Returns { lines: [{ f0, sal, voiced }], drone }.
  async function trackF0(x16, mode, prog) {
    if (mode === 'song') {
      const tm = MELODY.createTracker(x16);
      prog('Learning the drone...', 0); await tick();
      tm.prepare();
      const drone = tm.droneProfile();
      const STEP = 300;
      for (let i = 0; i < tm.total; i += STEP) { tm.run(i, i + STEP); prog('Finding the melody...', i / Math.max(1, tm.total)); await tick(); }
      prog('Choosing the main line...', null); await tick();
      const lines = tm.finishLines(2).map((l) => ({ f0: DSP.cleanF0(l.f0), sal: l.sal, voiced: l.voiced })).sort((a, b) => b.sal - a.sal);
      if (!lines.length) lines.push({ f0: new Float32Array(tm.total), sal: 0, voiced: 0 });
      return { lines, drone };
    }
    const tr = DSP.createTracker(DSP.resample(x16, SR16, DSP.SR));
    const STEP = 400;
    for (let i = 0; i < tr.total; i += STEP) { tr.run(i, i + STEP); prog('Tracking pitch...', i / Math.max(1, tr.total)); await tick(); }
    const f0 = DSP.cleanF0(tr.result());
    return { lines: [{ f0, sal: 0, voiced: f0.filter((v) => v > 0).length / Math.max(1, f0.length) }], drone: null };
  }

  // ---------------------------------------------------------------- ANALYZE tab
  function setStatus(msg, p) {
    $('statusRow').hidden = !msg;
    $('status').textContent = msg || '';
    $('prog').style.display = p == null ? 'none' : '';
    if (p != null) $('prog').value = p;
  }

  (function initSaSelect() {
    const sel = $('saNote');
    WEST.forEach((n, i) => { const o = document.createElement('option'); o.value = String(i); o.textContent = n; sel.appendChild(o); });
  })();
  function updateSaUI() {
    if (!state.saHz) return;
    $('saHz').value = state.saHz.toFixed(1);
    $('saInfo').textContent = '≈ ' + westernName(state.saHz) + (state.saAuto ? ' (auto)' : '');
    if (state.saAuto) $('saNote').value = 'auto';
    else { const m = 69 + 12 * Math.log2(state.saHz / 440), n = Math.round(m); $('saNote').value = Math.abs(m - n) < 0.15 ? String(((n % 12) + 12) % 12) : 'custom'; }
  }
  $('saNote').addEventListener('change', () => {
    const v = $('saNote').value;
    if (v === 'auto') state.saAuto = true;
    else if (v !== 'custom' && state.f0) { state.saAuto = false; state.saHz = DSP.placeSa(440 * Math.pow(2, (Number(v) - 9) / 12), state.f0); }
    recompute();
  });
  $('saHz').addEventListener('change', () => {
    const v = parseFloat($('saHz').value);
    if (!(v > 40 && v < 1000)) return;
    state.saAuto = false; state.saHz = v; recompute();
  });

  async function runMain(fresh) {
    if (!state.x16) return;
    const id = ++state.run;
    setStatus('Starting...', 0);
    let tr;
    try { tr = await trackF0(state.x16, state.mode, setStatus); } catch (e) { setStatus(''); toast('Analysis failed on this audio.'); return; }
    if (id !== state.run) return;           // a newer analysis started
    state.lines = tr.lines; state.drone = tr.drone; state.lead = 0;
    state.f0 = tr.lines[0].f0;
    state.saAuto = $('saNote').value === 'auto' || !state.saHz;
    setStatus('');
    recompute();
    // on a phone the controls fill the first screen, so bring the results into view after a new analysis
    if (fresh && window.innerWidth < 700 && $('results').scrollIntoView) $('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function setPlayerSource(blob) {
    const pl = $('player');
    if (pl.dataset.url) { URL.revokeObjectURL(pl.dataset.url); delete pl.dataset.url; }
    if (blob) { pl.dataset.url = URL.createObjectURL(blob); pl.src = pl.dataset.url; pl.hidden = false; }
    else { pl.removeAttribute('src'); pl.hidden = true; }
  }

  // x16 is 16 kHz mono; meta = { name, source: 'record' | 'upload' }
  async function afterDecode(x16, blob, meta) {
    state.x16 = x16; state.blob = blob; state.source = meta.source;
    state.name = meta.name || state.name || 'Recording';
    state.mode = meta.source === 'upload' ? 'song' : 'solo';
    $('mode').value = state.mode;
    $('saveName').value = state.name;
    $('startField').hidden = meta.source !== 'upload';
    setPlayerSource(blob);
    await runMain(true);
  }
  async function loadMain(blob, meta) {
    setStatus('Decoding audio...');
    try {
      const start = meta.source === 'upload' ? Math.max(0, Number($('startAt').value) || 0) : 0;
      const { x16 } = await decodeBlob(blob, start);
      await afterDecode(x16, blob, meta);
    } catch (e) { setStatus(''); toast('Could not read that audio. Try a WAV, MP3, M4A or WebM file (and check the start time).'); }
  }
  $('file').addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) loadMain(f, { source: 'upload', name: f.name.replace(/\.[^.]+$/, '') });
    e.target.value = '';
  });
  $('startAt').addEventListener('change', () => { if (state.blob && state.source === 'upload') loadMain(state.blob, { source: 'upload', name: state.name }); });
  $('mode').addEventListener('change', () => {
    state.mode = $('mode').value;
    if (state.x16) runMain(); else toast('Saved items keep their pitch data; the audio type applies to new recordings and uploads.');
  });

  function recompute(opts) {
    if (!state.f0) return;
    if (state.saAuto && !(opts && opts.keepSa && state.saHz)) state.saHz = DSP.detectSa(state.f0);   // switching lines keeps the same Sa
    $('results').hidden = false;
    if (!state.saHz) {
      state.an = null;
      $('ragaBox').innerHTML = '<p class="muted">Could not find a clear pitch. Try a closer, quieter recording of a single voice or instrument, or choose the audio type that matches.</p>';
      $('chips').innerHTML = ''; $('stats').textContent = '';
      $('pitchTable').querySelector('tbody').innerHTML = ''; $('leadBox').hidden = true; state.rag = null;
      viewerMain.setData(null);
      return;
    }
    updateSaUI();
    state.an = DSP.analyze(state.f0, state.saHz);
    const an = state.an;
    $('stats').textContent = `${an.duration.toFixed(1)} s analysed, ${Math.round(an.voicedFrac * 100)}% pitched, ${an.notes.length} notes found, Sa = ${state.saHz.toFixed(1)} Hz.`;
    $('legend').innerHTML = Object.keys(COL).map((k) => `<span><i style="background:${COL[k]}"></i>${LABEL[k]}</span>`).join('');
    const { lo, hi } = an.range ? rangeOf([an.range.lo, an.range.hi]) : { lo: -200, hi: 1400 };
    viewerMain.setData({
      duration: an.duration, lo, hi, grid: true,
      series: otherLineSeries().concat([{ t0: DSP.T0, dt: DSP.DT, vals: an.cents, color: '#ffd9a0', width: 2 }]),
      bands: an.notes.map((n) => ({ t0: n.t0, t1: n.t1, pos: posOf(n), color: COL[n.g.type] || COL.steady, token: n.token })),
    });
    renderLeadBox();
    state.rag = RAGAID.identify(an, RAGAS, ragaOptions());
    renderRaga(state.rag);
    renderChips();
    renderPitchTable();
    nowInfo(null);
    if (!$('tab-practice').hidden) renderSelfCheck();
  }

  // evidence the raga engine may use: how Sa-like each tonic looks, and what the drone says
  function ragaOptions() {
    const o = { fixTonic: !state.saAuto, prior: DSP.tonicPrior(state.f0, state.saHz) || undefined };
    if (state.drone) { const d = MELODY.droneTonic(state.drone, state.saHz, DSP.GRID); if (d) o.drone = d; }
    return o;
  }
  const CONF_TEXT = { high: 'High confidence', medium: 'Medium confidence', low: 'Low confidence' };
  function setSa(hz) { state.saAuto = false; state.saHz = hz; recompute(); }

  function renderRaga(rag) {
    const el = $('ragaBox');
    if (!rag.ok) { el.innerHTML = `<p class="muted">${esc(rag.reason)}</p>`; return; }
    const topSet = new Set(rag.groups[0].set), max = Math.max(...rag.share, 0.001);
    const conf = `<div class="row"><span class="conf ${rag.confidence}">${CONF_TEXT[rag.confidence]}</span>
      <span class="muted small">${rag.confidence === 'high' ? 'Every note of the raga was heard, it clearly beats the next one, and Sa looks settled.'
        : rag.confidence === 'medium' ? 'A good fit, but another raga is close or part of the raga was not heard.' : 'Treat this as a first guess. More singing, a clearer recording, or setting Sa yourself will help.'}</span></div>`;
    let banner = '';
    if (rag.tonic.changed) {
      banner += `<div class="altSa"><b>These notes read better with a different Sa.</b> <span class="small">With the Sa detected (${state.saHz.toFixed(1)} Hz) they fit poorly; with Sa at ${rag.tonic.saHz.toFixed(1)} Hz (${esc(westernName(rag.tonic.saHz))}) they fit the raga below. The raga shown uses that Sa.</span><br>
        <button class="btn small" type="button" data-sa="${rag.tonic.saHz}">Use Sa = ${rag.tonic.saHz.toFixed(1)} Hz</button></div>`;
    }
    for (const a of rag.alts) {
      banner += `<div class="altSa"><b>${a.close ? 'Sa is ambiguous.' : 'Another reading:'}</b> <span class="small">if Sa were ${a.saHz.toFixed(1)} Hz (${esc(westernName(a.saHz))}), this would look like <b>${esc(a.group.ragas.slice(0, 3).map((r) => r.name).join(' / '))}</b>.</span><br>
        <button class="btn small" type="button" data-sa="${a.saHz}">Try Sa = ${a.saHz.toFixed(1)} Hz</button></div>`;
    }
    const cards = rag.groups.map((g, i) => {
      const items = g.ragas.map((r) => `<div class="ragaItem"><b>${esc(r.name)}</b> <span class="muted small">${esc(r.mela)}${r.aka ? ' &middot; ' + esc(r.aka) : ''}</span>
        <div class="mono">&uarr; ${esc(r.aro)}</div><div class="mono">&darr; ${esc(r.ava)}</div>${r.related ? `<div class="muted small">${esc(r.related)}</div>` : ''}</div>`).join('');
      const same = g.ragas.length > 1 ? '<div class="muted small">These ragas use exactly the same notes. They are listed by how well the ascent and descent fit; their phrases and gamakas decide the rest, which this app does not hear yet.</div>' : '';
      const why = `<p class="muted small why">Heard ${g.used} of its ${g.set.length} notes. ${Math.round(g.inMass * 100)}% of the singing falls inside it.</p>`;
      return `<div class="ragaMain ${i === 0 ? 'top' : ''}"><div class="ragaHead"><span class="muted small">${i === 0 ? 'Best match' : 'Also possible'}</span><span class="badge">${Math.round(g.score * 100)}% fit</span></div>${items}${same}${why}</div>`;
    }).join('');
    const bars = NAMES.map((n, i) => {
      const cls = topSet.has(i) ? 'in' : rag.share[i] > 0.03 ? 'out' : '';
      return `<div class="bar ${cls}"><div style="height:${Math.round((rag.share[i] / max) * 100)}%"></div>${n}</div>`;
    }).join('');
    el.innerHTML = conf + banner + cards + `<p class="muted small">Swaras used (share of time, read against the Sa behind the raga shown). Gold = in the best-match raga, red = sung but not in it.</p><div class="bars">${bars}</div>
      <p class="muted small">This looks at which swaras are used and how the lines go up and down. It cannot hear characteristic phrases, so confirm with your ear or your guru.</p>`;
    el.querySelectorAll('button[data-sa]').forEach((b) => b.addEventListener('click', () => setSa(parseFloat(b.dataset.sa))));
  }

  function renderChips() {
    const box = $('chips'); box.innerHTML = '';
    state.an.notes.forEach((n, i) => {
      if (i && n.gapBefore > 0.35) { const s = document.createElement('span'); s.className = 'sep'; s.textContent = '|'; box.appendChild(s); }
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'chip t-' + n.g.type; b.textContent = n.token;
      b.title = `${n.name} ${n.g.type}, ${n.dur.toFixed(2)} s, ${n.dev >= 0 ? '+' : ''}${Math.round(n.dev)}¢ from the grid`;
      b.addEventListener('click', () => { viewerMain.focus(n.t0); nowInfo(n.t0 + 0.05); playFrom(n.t0); });
      box.appendChild(b);
    });
    if (!state.an.notes.length) box.innerHTML = '<span class="muted">No steady notes found.</span>';
  }
  $('btnCopy').addEventListener('click', async () => {
    if (!state.an) return;
    try { await navigator.clipboard.writeText(notationString(state.an)); $('btnCopy').textContent = 'Copied'; } catch (e) { $('btnCopy').textContent = 'Copy failed'; }
    setTimeout(() => ($('btnCopy').textContent = 'Copy'), 1500);
  });

  // playback follows the window
  const player = $('player');
  function hasAudio() { return !player.hidden && !!player.getAttribute('src'); }
  function seekPlayer(t) { if (hasAudio()) player.currentTime = Math.max(0, t); viewerMain.setPlayT(t, !player.paused); }
  function playFrom(t) { if (!hasAudio()) return; player.currentTime = Math.max(0, t - 0.05); player.play().catch(() => {}); }
  function follow() { viewerMain.setPlayT(player.currentTime, true); nowInfo(player.currentTime, !player.paused); if (!player.paused) requestAnimationFrame(follow); }
  player.addEventListener('play', () => requestAnimationFrame(follow));
  ['seeked', 'timeupdate', 'pause'].forEach((ev) => player.addEventListener(ev, () => { viewerMain.setPlayT(player.currentTime, !player.paused); nowInfo(player.currentTime, false); }));

  // ---------------------------------------------------------------- lead line (which melodic line is followed)
  // The other line, if there is a real second one, is drawn faintly for context.
  function secondLine() { return state.lines && state.lines.length > 1 && state.lines[1].voiced >= 0.15 ? state.lines[1] : null; }
  function otherLineSeries() {
    const o = secondLine(); if (!o || !state.saHz) return [];
    const ln = state.lines[1 - state.lead]; if (!ln) return [];
    const vals = new Float32Array(ln.f0.length);
    for (let i = 0; i < vals.length; i++) vals[i] = ln.f0[i] > 0 ? 1200 * Math.log2(ln.f0[i] / state.saHz) : NaN;
    return [{ t0: DSP.T0, dt: DSP.DT, vals, color: '#7f93b3', width: 1.5, alpha: 0.5 }];
  }
  function renderLeadBox() {
    const two = !!secondLine();
    $('leadBox').hidden = !two;
    if (!two) return;
    $('leadWhich').textContent = state.lead === 0 ? 'louder' : 'quieter';
    document.querySelectorAll('#leadSeg button').forEach((b) => b.classList.toggle('on', Number(b.dataset.lead) === state.lead));
  }
  document.querySelectorAll('#leadSeg button').forEach((b) => b.addEventListener('click', () => {
    const i = Number(b.dataset.lead);
    if (!state.lines || !state.lines[i] || i === state.lead) return;
    state.lead = i; state.f0 = state.lines[i].f0; recompute({ keepSa: true });
  }));

  // ---------------------------------------------------------------- calling out the pitch
  const hzAt = (sa, cents) => sa * Math.pow(2, cents / 1200);
  function renderPitchTable() {
    const an = state.an, tb = $('pitchTable').querySelector('tbody'); tb.innerHTML = '';
    an.notes.forEach((n) => {
      const heard = hzAt(state.saHz, n.cents), ideal = hzAt(state.saHz, posOf(n)), ad = Math.abs(n.dev);
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${n.t0.toFixed(1)} s</td><td class="sw">${esc(n.token)}</td><td>${heard.toFixed(1)} Hz</td><td class="wide">${ideal.toFixed(1)} Hz</td>
        <td class="${ad <= 15 ? 'off-ok' : ad <= 30 ? 'off-mid' : 'off-bad'}">${n.dev >= 0 ? '+' : ''}${Math.round(n.dev)}¢</td><td class="wide">${esc(westernName(heard))}</td><td>${n.g.type === 'steady' ? '-' : esc(LABEL[n.g.type] || n.g.type)}</td>`;
      tr.addEventListener('click', () => { viewerMain.focus(n.t0); nowInfo(n.t0 + 0.05); playFrom(n.t0); });
      tb.appendChild(tr);
    });
  }
  $('btnCopyPitch').addEventListener('click', async () => {
    if (!state.an) return;
    const rows = ['Time (s)\tSwara\tHeard (Hz)\tIdeal (Hz)\tOff (cents)\tWestern\tGamaka'].concat(state.an.notes.map((n) =>
      [n.t0.toFixed(2), n.token, hzAt(state.saHz, n.cents).toFixed(1), hzAt(state.saHz, posOf(n)).toFixed(1), Math.round(n.dev), westernName(hzAt(state.saHz, n.cents)), n.g.type].join('\t')));
    try { await navigator.clipboard.writeText(rows.join('\n')); $('btnCopyPitch').textContent = 'Copied'; } catch (e) { $('btnCopyPitch').textContent = 'Copy failed'; }
    setTimeout(() => ($('btnCopyPitch').textContent = 'Copy table'), 1500);
  });

  const SAY = { S: 'Sa', R1: 'Ri one', R2: 'Ri two', R3: 'Ri three', G2: 'Ga two', G3: 'Ga three', M1: 'Ma one', M2: 'Ma two', P: 'Pa', D1: 'Dha one', D2: 'Dha two', N2: 'Ni two', N3: 'Ni three' };
  let lastNoteSpoken = -1, lastNowHtml = '';
  function speak(n) {
    if (!$('speak').checked || typeof speechSynthesis === 'undefined' || typeof SpeechSynthesisUtterance === 'undefined') return;
    const u = new SpeechSynthesisUtterance((SAY[n.name] || n.name) + (n.oct > 0 ? ' high' : n.oct < 0 ? ' low' : ''));
    u.rate = 1.25; speechSynthesis.cancel(); speechSynthesis.speak(u);
  }
  // t = null clears the readout. playing = true lets it speak a new note once.
  function nowInfo(t, playing) {
    const el = $('nowPlaying'), an = state.an;
    if (t == null || !an) { el.textContent = 'Play the audio or tap a note to see its pitch here.'; lastNowHtml = ''; lastNoteSpoken = -1; return; }
    const i = Math.round((t - DSP.T0) / DSP.DT), f = state.f0 && i >= 0 && i < state.f0.length ? state.f0[i] : 0;
    const k = an.notes.findIndex((n) => t >= n.t0 && t <= n.t1), note = k >= 0 ? an.notes[k] : null;
    let html;
    if (!(f > 0)) html = note ? `<b>${esc(note.token)}</b>${hzAt(state.saHz, note.cents).toFixed(1)} Hz` : '<span class="muted">No clear pitch here</span>';
    else {
      const sw = DSP.toSwara(1200 * Math.log2(f / state.saHz));
      html = `<b>${esc(note ? note.token : DSP.symbol(sw.idx, sw.oct))}</b>${f.toFixed(1)} Hz &middot; ${esc(westernName(f))} &middot; ${sw.dev >= 0 ? '+' : ''}${Math.round(sw.dev)}¢ from ${NAMES[sw.idx]}`;
    }
    if (html !== lastNowHtml) { el.innerHTML = html; lastNowHtml = html; }
    if (playing && k !== lastNoteSpoken) { lastNoteSpoken = k; if (note) speak(note); }
    if (!playing && k < 0) lastNoteSpoken = -1;
  }
  $('speak').addEventListener('change', () => { if (!$('speak').checked && typeof speechSynthesis !== 'undefined') speechSynthesis.cancel(); });

  // ---------------------------------------------------------------- recording with live tuner (shared by Analyze and Practice)
  let rec = null;
  async function startRecording(target) {
    if (rec) { toast('Stop the current recording first.'); return; }
    if (target === 'att' && !practice.ref) { toast('Choose a reference first (step 1).'); return; }
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } }); }
    catch (e) { toast('Microphone access was blocked. Allow it in the browser address bar and try again.'); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    const ac = new AC(), src = ac.createMediaStreamSource(stream), an = ac.createAnalyser();
    an.fftSize = 8192; src.connect(an);
    const chunks = [], mr = new MediaRecorder(stream);
    mr.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    const live = target === 'att' ? liveAtt : liveMain;
    let fixedSa = null;
    if (target === 'att' && $('sameSa').checked) fixedSa = practice.ref.saHz;
    else if (target === 'main' && !state.saAuto && state.saHz) fixedSa = state.saHz;
    rec = { target, live, stream, ac, an, mr, chunks, grid: [], t0: performance.now(), sa: null, fixedSa, lastSa: 0, lo: null, hi: null, stop: false };
    mr.onstop = () => {
      stream.getTracks().forEach((t) => t.stop()); ac.close();
      const blob = new Blob(chunks, { type: mr.mimeType || 'audio/webm' });
      const stamp = new Date().toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
      if (target === 'att') loadAttempt(blob); else loadMain(blob, { source: 'record', name: 'Recording ' + stamp });
    };
    mr.start();
    const btn = target === 'att' ? $('btnRecAtt') : $('btnRec');
    btn.textContent = '■ Stop'; btn.classList.add('rec');
    live.el.hidden = false; live.note.textContent = '-'; live.hz.textContent = '- Hz'; live.cents.textContent = '';
    liveLoop();
  }
  function stopRecording() {
    if (!rec) return;
    const r = rec; rec = null; r.stop = true;
    try { r.mr.stop(); } catch (e) { /* already stopped */ }
    const btn = r.target === 'att' ? $('btnRecAtt') : $('btnRec');
    btn.textContent = r.target === 'att' ? '● Record attempt' : '● Record'; btn.classList.remove('rec');
    r.live.el.hidden = true; r.live.viewer.setData(null);
  }
  $('btnRec').addEventListener('click', () => (rec && rec.target === 'main' ? stopRecording() : startRecording('main')));
  $('btnRecAtt').addEventListener('click', () => (rec && rec.target === 'att' ? stopRecording() : startRecording('att')));

  function liveLoop() {
    const r = rec; if (!r || r.stop) return;
    const buf = new Float32Array(r.an.fftSize);
    r.an.getFloatTimeDomainData(buf);
    const p = DSP.pitchOfBuffer(buf, r.ac.sampleRate);
    const now = (performance.now() - r.t0) / 1000;
    if (now > MAX_SECONDS) { toast('Reached the 3 minute limit.'); stopRecording(); return; }
    const f = p && p.f0 > 0 && p.rms > 0.01 && p.conf > 0.8 ? p.f0 : 0;
    const idx = Math.floor(now / LDT);
    while (r.grid.length <= idx) r.grid.push(f);

    if (!r.fixedSa && now - r.lastSa > 1.5) {
      r.lastSa = now;
      const voiced = r.grid.filter((v) => v > 0);
      if (voiced.length > 60) { const s = DSP.detectSa(Float32Array.from(voiced)); if (s) r.sa = s; }
    }
    const sa = r.fixedSa || r.sa, L = r.live;
    L.time.textContent = fmtClock(now);
    if (f > 0) {
      L.hz.textContent = f.toFixed(1) + ' Hz (' + westernName(f) + ')';
      if (sa) {
        const sw = DSP.toSwara(1200 * Math.log2(f / sa));
        L.note.textContent = DSP.symbol(sw.idx, sw.oct);
        L.cents.textContent = (sw.dev >= 0 ? '+' : '') + Math.round(sw.dev) + '¢ from the swara';
      } else { L.note.textContent = '...'; L.cents.textContent = 'finding your Sa'; }
    }
    // vertical range follows the recent pitch, eased so it does not jump
    const W = L.viewer.windowSeconds(), from = Math.max(0, r.grid.length - Math.ceil(W / LDT)), ref = sa || 440, recent = [];
    for (let i = from; i < r.grid.length; i++) recent.push(r.grid[i] > 0 ? 1200 * Math.log2(r.grid[i] / ref) : NaN);
    const target = rangeOf(recent), t = recent.some((c) => c === c) ? target : { lo: sa ? -200 : -600, hi: sa ? 1400 : 600 };
    r.lo = r.lo == null ? t.lo : r.lo + 0.2 * (t.lo - r.lo); r.hi = r.hi == null ? t.hi : r.hi + 0.2 * (t.hi - r.hi);
    L.viewer.setData({ duration: now, lo: r.lo, hi: r.hi, grid: !!sa, series: [{ t0: 0, dt: LDT, vals: r.grid, hz: true, sa: ref, color: '#ffd9a0', width: 2.5 }], bands: [] }, true);
    requestAnimationFrame(liveLoop);
  }

  // ---------------------------------------------------------------- save to library
  $('btnSave').addEventListener('click', async () => {
    if (!state.an || !state.f0) return;
    if (!STORE.available()) { toast('Saving is not available in this browser (private mode?).'); return; }
    const name = ($('saveName').value || state.name || 'Recording').trim().slice(0, 80);
    const rag = state.rag || { ok: false };
    try {
      await STORE.put({ name, kind: 'analysis', duration: state.an.duration, saHz: state.saHz, mode: state.mode, f0: state.f0, notation: notationString(state.an),
        raga: rag.ok ? rag.groups[0].ragas.map((x) => x.name).join(' / ') : null, score: null, audio: $('keepAudio').checked && state.blob ? state.blob : null });
      toast('Saved to your library.');
      if (!(await STORE.persisted())) STORE.persist();
      refreshLibCount();
    } catch (e) { toast('Could not save: ' + (e && e.message ? e.message : 'storage is full or blocked.')); }
  });

  // ---------------------------------------------------------------- PRACTICE tab
  function renderSelfCheck() {
    const box = $('selfCheck');
    if (!state.an) { box.innerHTML = '<p class="muted">Record or upload a phrase on the Analyze tab first. Slow, held swaras work best.</p>'; return; }
    const r = PRACTICE.intonation(state.an);
    if (!r.ok) { box.innerHTML = `<p class="muted">${esc(r.reason)}</p>`; return; }
    const rows = r.bySwara.map((s) => {
      const m = clamp(s.mean, -50, 50), cls = Math.abs(s.mean) <= 20 ? '' : Math.abs(s.mean) <= 35 ? 'close' : 'off';
      return `<div class="devRow"><b>${esc(s.name)}</b><div class="devTrack"><div class="devDot ${cls}" style="left:${50 + m}%"></div></div><span class="muted small">${s.mean >= 0 ? '+' : ''}${Math.round(s.mean)}¢ (${s.n}x)</span></div>`;
    }).join('');
    box.innerHTML = `<div class="scoreRow"><div class="ring" style="--p:${r.score}"><span>${r.score}</span></div>
      <div class="tiles"><div class="tile"><b>${r.count}</b><span>held notes measured</span></div><div class="tile"><b>±${r.steadiness}¢</b><span>typical wobble on long notes</span></div></div></div>
      <p class="muted small">Each row shows how far your held swara sits from the pure position (centre line). Left is flat, right is sharp.</p>${rows}
      <ul class="advice">${r.advice.map((a) => `<li>${esc(a)}</li>`).join('')}</ul><p class="muted small">${esc(r.caveat)}</p>`;
  }

  function renderRefInfo() {
    const r = practice.ref, el = $('refInfo');
    if (!r) { el.textContent = 'No reference chosen yet.'; return; }
    el.innerHTML = `<b>${esc(r.name)}</b> &middot; ${r.an.duration.toFixed(1)} s &middot; Sa ${r.saHz.toFixed(1)} Hz<br><span class="mono">${esc(r.notation)}</span>`;
  }
  function setRef(name, f0, saHz) {
    const an = DSP.analyze(f0, saHz);
    if (an.notes.length < 3) { toast('That recording has too few clear notes to use as a reference.'); return; }
    practice.ref = { name, f0, saHz, an, notation: notationString(an) };
    practice.att = null; practice.res = null; renderReport(); renderRefInfo();
  }
  $('btnRefCurrent').addEventListener('click', () => {
    if (!state.an) { toast('Record or upload something on the Analyze tab first.'); return; }
    setRef(state.name || 'Current recording', state.f0, state.saHz);
  });
  $('refPick').addEventListener('change', async () => {
    const id = $('refPick').value; if (!id) return;
    const r = await STORE.get(id);
    if (r && r.f0) setRef(r.name, r.f0, r.saHz);
    $('refPick').value = '';
  });
  async function refreshRefPick() {
    const sel = $('refPick');
    sel.innerHTML = '<option value="">or choose from your library...</option>';
    if (!STORE.available()) return;
    try { (await STORE.list()).filter((i) => i.kind === 'analysis').forEach((i) => { const o = document.createElement('option'); o.value = i.id; o.textContent = i.name; sel.appendChild(o); }); } catch (e) { /* library unavailable */ }
  }

  function setAttStatus(msg, p) {
    $('statusAtt').hidden = !msg;
    $('statusAttText').textContent = msg || '';
    $('progAtt').style.display = p == null ? 'none' : '';
    if (p != null) $('progAtt').value = p;
  }
  async function loadAttempt(blob) {
    if (!practice.ref) { toast('Choose a reference first (step 1).'); return; }
    setAttStatus('Decoding...');
    try { const { x16 } = await decodeBlob(blob, 0); await attemptFromX16(x16); }
    catch (e) { setAttStatus(''); toast('Could not read that audio.'); }
  }
  async function attemptFromX16(x16) {
    const f0 = (await trackF0(x16, $('attMode').value, setAttStatus)).lines[0].f0;
    setAttStatus('');
    const sa = $('sameSa').checked ? practice.ref.saHz : DSP.detectSa(f0);
    if (!sa) { toast('Could not find a clear pitch in your attempt. Sing closer to the mic.'); return; }
    const an = DSP.analyze(f0, sa);
    practice.att = { f0, saHz: sa, an };
    practice.res = PRACTICE.compare(practice.ref.an, an);
    renderReport();
  }
  $('fileAtt').addEventListener('change', (e) => { const f = e.target.files && e.target.files[0]; if (f) loadAttempt(f); e.target.value = ''; });

  function renderReport() {
    const res = practice.res;
    $('report').hidden = !res;
    if (!res) return;
    const failed = !res.ok;
    $('viewerPractice').hidden = failed; $('noteList').hidden = failed;
    if (failed) { $('reportSummary').innerHTML = `<p class="muted">${esc(res.reason)}</p>`; return; }

    const word = res.score >= 90 ? 'Excellent' : res.score >= 75 ? 'Good' : res.score >= 55 ? 'Getting there' : 'Keep practising';
    const extra = [];
    if (res.shift) extra.push(`You sang about ${Math.abs(res.shift / 1200)} octave${Math.abs(res.shift) > 1200 ? 's' : ''} ${res.shift < 0 ? 'lower' : 'higher'} than the reference. That is fine, it was lined up for you.`);
    if (res.tempo < 0.85 || res.tempo > 1.18) extra.push(`Your phrase ran ${Math.round(Math.abs(res.tempo - 1) * 100)}% ${res.tempo > 1 ? 'slower' : 'faster'} than the reference.`);
    $('reportSummary').innerHTML = `<div class="scoreRow"><div class="ring" style="--p:${res.score}"><span>${res.score}</span></div>
      <div><b>${word}</b><div class="tiles" style="margin-top:6px">
        <div class="tile"><b>${res.pitch}%</b><span>pitch accuracy</span></div>
        <div class="tile"><b>${res.inTune}/${res.noteCount}</b><span>notes in tune</span></div>
        <div class="tile"><b>${res.gamaka == null ? '-' : res.gamaka + '%'}</b><span>gamaka match${res.gamakaCount ? ' (' + res.gamakaCount + ' in reference)' : ''}</span></div></div></div></div>
      ${res.worst.length ? '<p class="small"><b>Work on first:</b></p><ul class="worst small">' + res.worst.map((w) => `<li>${esc(w)}</li>`).join('') + '</ul>' : '<p class="small">No note stood out as off.</p>'}
      ${extra.map((x) => `<p class="muted small">${esc(x)}</p>`).join('')}
      <button id="btnSaveAtt" class="btn small" type="button">Save this attempt</button>`;
    $('btnSaveAtt').addEventListener('click', saveAttempt);

    const ref = practice.ref.an, wr = rangeOf([...ref.cents, ...res.warped]);
    viewerPractice.setData({
      duration: ref.duration, lo: wr.lo, hi: wr.hi, grid: true,
      series: [{ t0: DSP.T0, dt: DSP.DT, vals: ref.cents, color: '#ffd9a0', width: 2.5, alpha: .9 }, { t0: DSP.T0, dt: DSP.DT, vals: res.warped, color: '#5ad1ff', width: 2 }],
      bands: res.notes.map((n, i) => ({ t0: n.t0, t1: n.t1, pos: posOf(ref.notes[i]), color: STATUS_COL[n.status], token: n.token })),
    });
    renderNoteList();
  }
  function renderNoteList() {
    const res = practice.res; if (!res || !res.ok) return;
    const all = $('showAll').checked, box = $('noteList'); box.innerHTML = '';
    res.notes.forEach((n) => {
      if (!all && n.status === 'good' && !n.issues.length) return;
      const b = document.createElement('button'); b.type = 'button'; b.className = 'noteItem ' + n.status;
      const text = n.issues.length ? n.issues.join(' ') : `Right on (${n.dev >= 0 ? '+' : ''}${Math.round(n.dev)}¢).`;
      b.innerHTML = `<span class="tok">${esc(n.token)}</span><span class="tm">${n.t0.toFixed(1)} s</span><span class="tx">${esc(text)}</span>`;
      b.addEventListener('click', () => viewerPractice.focus(n.t0));
      box.appendChild(b);
    });
    if (!box.children.length) box.innerHTML = '<p class="muted small">Every note was within a few cents of the reference.</p>';
  }
  $('showAll').addEventListener('change', renderNoteList);
  async function saveAttempt() {
    if (!practice.att || !practice.res || !practice.res.ok) return;
    if (!STORE.available()) { toast('Saving is not available in this browser (private mode?).'); return; }
    try {
      await STORE.put({ name: practice.ref.name + ' - attempt', kind: 'practice', duration: practice.att.an.duration, saHz: practice.att.saHz, mode: 'solo', f0: practice.att.f0,
        notation: notationString(practice.att.an), raga: null, score: practice.res.score });
      toast('Attempt saved to your library.'); refreshLibCount();
    } catch (e) { toast('Could not save: ' + (e && e.message ? e.message : 'storage is full or blocked.')); }
  }

  // ---------------------------------------------------------------- LIBRARY tab
  async function refreshLibCount() {
    if (!STORE.available()) return;
    try { const n = (await STORE.list()).length; $('libCount').textContent = n; $('libCount').hidden = !n; } catch (e) { /* ignore */ }
  }
  async function renderLibrary() {
    const box = $('libList');
    if (!STORE.available()) { box.innerHTML = '<p class="muted">This browser is not allowing local storage (private browsing, or storage disabled), so the library is unavailable. You can still analyse and practise.</p>'; return; }
    let items = [];
    try { items = await STORE.list(); } catch (e) { box.innerHTML = '<p class="muted">Could not open the library: ' + esc(e.message) + '</p>'; return; }
    $('libCount').textContent = items.length; $('libCount').hidden = !items.length;
    box.innerHTML = items.length ? items.map((i) => `<div class="libItem" data-id="${esc(i.id)}">
      <div class="libTop"><b>${esc(i.name)}</b><span class="muted small">${new Date(i.createdAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</span></div>
      <div class="muted small">${i.kind === 'practice' ? 'Practice attempt' + (i.score != null ? ', score ' + esc(i.score) : '') : 'Analysis' + (i.raga ? ', ' + esc(i.raga) : '')} &middot; ${Number(i.duration || 0).toFixed(0)} s &middot; ${mb(i.bytes)}${i.hasAudio ? ' &middot; audio kept' : ''}</div>
      <div class="libNote">${esc((i.notation || '').slice(0, 140))}${(i.notation || '').length > 140 ? '...' : ''}</div>
      <div class="row"><button class="btn small" data-act="open" type="button">Open</button><button class="btn small" data-act="ref" type="button">Use as reference</button>
        <button class="btn small" data-act="rename" type="button">Rename</button><button class="btn small danger" data-act="del" type="button">Delete</button></div></div>`).join('')
      : '<p class="muted">Nothing saved yet. Analyse something and press Save.</p>';
    const u = await STORE.usage(), pers = await STORE.persisted();
    $('storeInfo').innerHTML = (u && u.quota ? `Using ${mb(u.usage)} of about ${mb(u.quota)} this browser allows for this site.<div class="meter"><div style="width:${Math.max(1, Math.min(100, (100 * u.usage) / u.quota))}%"></div></div>` : '')
      + (pers ? 'Your browser has agreed to keep this data.' : 'The browser may clear this data if the device runs low on space. Use the button below, and export a backup.');
    $('btnPersist').hidden = pers;
  }
  $('libList').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-act]'); if (!btn) return;
    const id = btn.closest('.libItem').dataset.id, act = btn.dataset.act;
    try {
      if (act === 'open') await openItem(id);
      else if (act === 'ref') { const r = await STORE.get(id); if (r) { setRef(r.name, r.f0, r.saHz); if (practice.ref) { switchTab('practice'); toast('Reference set. Now record your attempt.'); } } }
      else if (act === 'rename') { const r = await STORE.get(id); const n = r && window.prompt('New name', r.name); if (n && n.trim()) { await STORE.rename(id, n.trim().slice(0, 80)); renderLibrary(); } }
      else if (act === 'del') { if (window.confirm('Delete this item?')) { await STORE.remove(id); renderLibrary(); } }
    } catch (err) { toast('That did not work: ' + (err && err.message ? err.message : 'storage error')); }
  });
  async function openItem(id) {
    const r = await STORE.get(id); if (!r || !r.f0) return;
    state.x16 = null; state.run++; state.f0 = r.f0; state.lines = [{ f0: r.f0, sal: 0, voiced: 1 }]; state.lead = 0; state.drone = null; state.saHz = r.saHz; state.saAuto = false; state.mode = r.mode || 'solo';
    state.name = r.name; state.blob = r.audio || null; state.source = 'library'; $('startField').hidden = true;
    $('mode').value = state.mode; $('saveName').value = r.name;
    setPlayerSource(r.audio || null);
    switchTab('analyze'); recompute();
  }
  $('btnPersist').addEventListener('click', async () => { toast((await STORE.persist()) ? 'Done. The browser will try to keep your data.' : 'The browser did not agree this time. Export a backup to be safe.'); renderLibrary(); });
  $('btnExport').addEventListener('click', async () => {
    try {
      const json = await STORE.exportAll(), a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      a.download = 'swara-lens-backup-' + new Date().toISOString().slice(0, 10) + '.json';
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } catch (e) { toast('Could not export: ' + (e && e.message ? e.message : 'storage error')); }
  });
  $('importFile').addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files[0]; e.target.value = '';
    if (!f) return;
    try { const n = await STORE.importJSON(await f.text()); toast(n ? `Imported ${n} item${n > 1 ? 's' : ''}.` : 'No usable items in that file.'); renderLibrary(); }
    catch (err) { toast(err.message || 'Could not import that file.'); }
  });

  // ---------------------------------------------------------------- tabs
  function switchTab(name) {
    document.querySelectorAll('.tab').forEach((t) => { const on = t.dataset.tab === name; t.classList.toggle('on', on); t.setAttribute('aria-selected', on ? 'true' : 'false'); });
    document.querySelectorAll('.tabpane').forEach((p) => { p.hidden = p.id !== 'tab-' + name; });
    if (name === 'practice') { renderSelfCheck(); refreshRefPick(); renderRefInfo(); viewerPractice.draw(); }
    if (name === 'library') renderLibrary();
    if (name === 'analyze') viewerMain.draw();
  }
  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => switchTab(t.dataset.tab)));
  refreshLibCount();

  // hooks for tests and future integrations
  window.SwaraApp = {
    state, practice, switchTab,
    loadSamples: (mono, sr, meta) => afterDecode(MELODY.resample(mono, sr, SR16), null, Object.assign({ source: 'upload', name: 'Test' }, meta || {})),
    attemptSamples: (mono, sr) => attemptFromX16(MELODY.resample(mono, sr, SR16)),
    viewers: { main: viewerMain, practice: viewerPractice },
  };
})();
