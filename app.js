/* Swara Lens - UI glue. All processing happens in the browser. */
(function () {
  'use strict';
  const { GRID, NAMES } = DSP;
  const $ = (id) => document.getElementById(id);
  const WEST = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const COL = { steady: '#5aa9ff', kampita: '#ff9d3c', andolita: '#c78bff', slide: '#4ed1a0', wavering: '#9aa4b2' };
  const LABEL = { steady: 'Steady', kampita: 'Kampita (fast oscillation)', andolita: 'Andolita (slow swing)', slide: 'Slide within note', wavering: 'Unsteady' };
  const H = 380, PAD_T = 26, PAD_B = 30, MAX_SECONDS = 180;
  const state = { f0: null, saHz: null, saAuto: true, an: null, pps: 90 };
  const tick = () => new Promise((r) => setTimeout(r, 0));

  // ---------- small helpers ----------
  function westernName(hz) {
    const m = 69 + 12 * Math.log2(hz / 440), n = Math.round(m);
    const dev = Math.round((m - n) * 100);
    return WEST[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1) + (dev ? ' ' + (dev > 0 ? '+' : '') + dev + '¢' : '');
  }
  function setStatus(msg, p) {
    $('statusRow').hidden = !msg;
    $('status').textContent = msg || '';
    $('prog').style.display = p == null ? 'none' : '';
    if (p != null) $('prog').value = p;
  }
  const posOf = (n) => n.oct * 1200 + GRID[n.idx];

  // ---------- Sa controls ----------
  (function initSaSelect() {
    const sel = $('saNote');
    WEST.forEach((n, i) => { const o = document.createElement('option'); o.value = String(i); o.textContent = n; sel.appendChild(o); });
  })();
  function updateSaUI() {
    if (!state.saHz) return;
    $('saHz').value = state.saHz.toFixed(1);
    $('saInfo').textContent = '≈ ' + westernName(state.saHz) + (state.saAuto ? ' (auto)' : '');
    if (state.saAuto) $('saNote').value = 'auto';
    else {
      const m = 69 + 12 * Math.log2(state.saHz / 440), n = Math.round(m);
      $('saNote').value = Math.abs(m - n) < 0.15 ? String(((n % 12) + 12) % 12) : 'custom';
    }
  }
  $('saNote').addEventListener('change', () => {
    const v = $('saNote').value;
    if (v === 'auto') { state.saAuto = true; }
    else if (v !== 'custom' && state.f0) {
      state.saAuto = false;
      state.saHz = DSP.placeSa(440 * Math.pow(2, (Number(v) - 9) / 12), state.f0);
    }
    recompute();
  });
  $('saHz').addEventListener('change', () => {
    const v = parseFloat($('saHz').value);
    if (!(v > 40 && v < 1000)) return;
    state.saAuto = false; state.saHz = v; recompute();
  });

  // ---------- pipeline ----------
  async function processSamples(samples, sr) {
    setStatus('Tracking pitch...', 0);
    await tick();
    const x = DSP.resample(samples, sr, DSP.SR);
    const tr = DSP.createTracker(x);
    const STEP = 400;
    for (let i = 0; i < tr.total; i += STEP) {
      tr.run(i, i + STEP);
      setStatus('Tracking pitch...', i / Math.max(1, tr.total));
      await tick();
    }
    state.f0 = DSP.cleanF0(tr.result());
    state.saAuto = $('saNote').value === 'auto' || !state.saHz;
    setStatus('');
    recompute();
  }

  function recompute() {
    if (!state.f0) return;
    if (state.saAuto) state.saHz = DSP.detectSa(state.f0);
    $('results').hidden = false;
    if (!state.saHz) {
      state.an = null;
      $('ragaBox').innerHTML = '<p class="muted">Could not find a clear pitch. Try a closer, quieter recording of a single voice or instrument.</p>';
      $('chips').innerHTML = ''; $('stats').textContent = '';
      clearPlot();
      return;
    }
    updateSaUI();
    state.an = DSP.analyze(state.f0, state.saHz);
    renderStats(); renderLegend(); draw(); renderRaga(DSP.suggestRagas(state.an.notes, RAGAS)); renderChips();
  }

  // ---------- rendering ----------
  function renderStats() {
    const an = state.an;
    $('stats').textContent = `${an.duration.toFixed(1)} s analysed, ${Math.round(an.voicedFrac * 100)}% pitched, ${an.notes.length} notes found, Sa = ${state.saHz.toFixed(1)} Hz.`;
  }
  function renderLegend() {
    $('legend').innerHTML = Object.keys(COL).map((k) => `<span><i style="background:${COL[k]}"></i>${LABEL[k]}</span>`).join('');
  }

  function renderRaga(rag) {
    const el = $('ragaBox');
    if (!rag.ok) { el.innerHTML = `<p class="muted">${rag.reason}</p>`; return; }
    const topSet = new Set(rag.groups[0].set);
    const max = Math.max(...rag.share, 0.001);
    const cards = rag.groups.map((g, i) => {
      const items = g.ragas.map((r) => `<div class="ragaItem"><b>${r.name}</b> <span class="muted small">${r.mela}</span>
        <div class="mono">&uarr; ${r.aro}</div><div class="mono">&darr; ${r.ava}</div>${r.related ? `<div class="muted small">${r.related}</div>` : ''}</div>`).join('');
      const same = g.ragas.length > 1 ? '<div class="muted small">These ragas share the same notes. Their phrases and gamakas tell them apart, which this app does not hear yet.</div>' : '';
      return `<div class="ragaMain ${i === 0 ? 'top' : ''}"><div class="ragaHead"><span class="muted small">${i === 0 ? 'Best match' : 'Also possible'}</span><span class="badge">${Math.round(g.score * 100)}% note match</span></div>${items}${same}</div>`;
    }).join('');
    const bars = NAMES.map((n, i) => {
      const cls = topSet.has(i) ? 'in' : rag.share[i] > 0.03 ? 'out' : '';
      return `<div class="bar ${cls}"><div style="height:${Math.round((rag.share[i] / max) * 100)}%"></div>${n}</div>`;
    }).join('');
    el.innerHTML = cards + `<p class="muted small">Swaras used (share of time). Gold = in the best-match raga, red = sung but not in it.</p><div class="bars">${bars}</div>
      <p class="muted small">This is a suggestion from swara usage only. Confirm with your ear or your guru.</p>`;
  }

  function renderChips() {
    const box = $('chips');
    box.innerHTML = '';
    state.an.notes.forEach((n, i) => {
      if (i && n.gapBefore > 0.35) { const s = document.createElement('span'); s.className = 'sep'; s.textContent = '|'; box.appendChild(s); }
      const b = document.createElement('button');
      b.className = 'chip t-' + n.g.type;
      b.textContent = n.token;
      b.title = `${n.name} ${n.g.type}, ${n.dur.toFixed(2)} s, ${n.dev >= 0 ? '+' : ''}${Math.round(n.dev)}¢ from grid`;
      b.addEventListener('click', () => playFrom(n.t0));
      box.appendChild(b);
    });
    if (!state.an.notes.length) box.innerHTML = '<span class="muted">No steady notes found.</span>';
  }
  $('btnCopy').addEventListener('click', async () => {
    if (!state.an) return;
    let out = '';
    state.an.notes.forEach((n, i) => { out += (i && n.gapBefore > 0.35 ? ' | ' : i ? ' ' : '') + n.token; });
    try { await navigator.clipboard.writeText(out); $('btnCopy').textContent = 'Copied'; } catch (e) { $('btnCopy').textContent = 'Copy failed'; }
    setTimeout(() => ($('btnCopy').textContent = 'Copy'), 1500);
  });

  // ---------- contour plot ----------
  function plotRange() {
    const r = state.an.range;
    let lo = r.lo - 90, hi = r.hi + 90;
    if (hi - lo < 800) { const m = (hi + lo) / 2; lo = m - 400; hi = m + 400; }
    return { lo, hi };
  }
  const yOf = (c, lo, hi) => PAD_T + ((hi - c) / (hi - lo)) * (H - PAD_T - PAD_B);
  function forGrid(lo, hi, cb) {
    for (let o = Math.floor(lo / 1200) - 1; o <= Math.ceil(hi / 1200) + 1; o++)
      for (let i = 0; i < 12; i++) { const p = o * 1200 + GRID[i]; if (p >= lo && p <= hi) cb(p, i, o); }
  }
  function sizeCanvas(cv, w, h) {
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    cv.style.width = w + 'px'; cv.style.height = h + 'px';
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); return g;
  }
  function clearPlot() { const g = sizeCanvas($('cv'), 10, H); g.clearRect(0, 0, 10, H); const g2 = sizeCanvas($('gut'), 56, H); g2.clearRect(0, 0, 56, H); }

  function draw() {
    const an = state.an;
    if (!an || !an.range) { clearPlot(); return; }
    const { lo, hi } = plotRange(), pps = state.pps;
    const w = Math.max($('scroller').clientWidth - 2, Math.ceil(an.duration * pps) + 30);
    const g = sizeCanvas($('cv'), w, H), gg = sizeCanvas($('gut'), 56, H);
    g.fillStyle = '#0c1016'; g.fillRect(0, 0, w, H);

    // time grid
    const step = pps >= 60 ? 1 : 5;
    g.font = '10px system-ui'; g.textBaseline = 'alphabetic';
    for (let t = 0; t <= an.duration; t += step) {
      const x = t * pps;
      g.strokeStyle = '#161c26'; g.lineWidth = 1; g.beginPath(); g.moveTo(x, PAD_T); g.lineTo(x, H - PAD_B); g.stroke();
      g.fillStyle = '#5d6a80'; g.fillText(t + 's', x + 3, H - 10);
    }
    // swarasthana grid + gutter labels
    gg.fillStyle = '#0c1016'; gg.fillRect(0, 0, 56, H);
    gg.font = '11px system-ui'; gg.textAlign = 'right'; gg.textBaseline = 'middle';
    forGrid(lo, hi, (p, i, o) => {
      const y = yOf(p, lo, hi);
      g.strokeStyle = i === 0 ? '#53627c' : i === 7 ? '#33405a' : '#1c2433';
      g.lineWidth = i === 0 ? 1.4 : 1;
      g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke();
      gg.fillStyle = i === 0 ? '#ffb454' : i === 7 ? '#c9d3e6' : '#7f8da4';
      gg.fillText(DSP.symbol(i, o), 50, y);
    });
    // note bands
    g.font = '600 11px system-ui'; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    for (const n of an.notes) {
      const x0 = n.t0 * pps, x1 = n.t1 * pps, y = yOf(posOf(n), lo, hi), c = COL[n.g.type] || COL.steady;
      g.fillStyle = c + '33'; g.fillRect(x0, y - 8, x1 - x0, 16);
      g.strokeStyle = c; g.lineWidth = 1; g.strokeRect(x0 + .5, y - 8 + .5, x1 - x0 - 1, 15);
      g.fillStyle = '#e8ecf3'; g.fillText(n.token, x0 + 2, y - 11);
    }
    // contour
    g.strokeStyle = '#ffd9a0'; g.lineWidth = 2; g.lineJoin = 'round'; g.beginPath();
    let pen = false;
    for (let i = 0; i < an.n; i++) {
      const c = an.cents[i];
      if (c !== c) { pen = false; continue; }
      const x = (DSP.T0 + i * DSP.DT) * pps, y = yOf(c, lo, hi);
      if (pen) g.lineTo(x, y); else { g.moveTo(x, y); pen = true; }
    }
    g.stroke();
    movePlayhead();
  }

  // ---------- audio playback ----------
  const player = $('player');
  function movePlayhead() {
    $('playhead').style.left = player.currentTime * state.pps + 'px';
  }
  function follow() {
    movePlayhead();
    const sc = $('scroller'), x = player.currentTime * state.pps;
    if (!player.paused) {
      if (x > sc.scrollLeft + sc.clientWidth - 80 || x < sc.scrollLeft) sc.scrollLeft = Math.max(0, x - 80);
      requestAnimationFrame(follow);
    }
  }
  player.addEventListener('play', follow);
  player.addEventListener('seeked', movePlayhead);
  player.addEventListener('timeupdate', movePlayhead);
  function playFrom(t) { player.currentTime = Math.max(0, t - 0.05); player.play().catch(() => {}); }
  $('cv').addEventListener('click', (e) => {
    const r = $('cv').getBoundingClientRect();
    player.currentTime = Math.max(0, (e.clientX - r.left) / state.pps);
  });
  $('zoom').addEventListener('input', () => { state.pps = Number($('zoom').value); draw(); });
  window.addEventListener('resize', () => { if (state.an) draw(); });

  // ---------- loading audio ----------
  async function loadBlob(blob) {
    setStatus('Decoding audio...');
    const AC = window.AudioContext || window.webkitAudioContext;
    const ac = new AC();
    try {
      const buf = await ac.decodeAudioData(await blob.arrayBuffer());
      const n = Math.min(buf.length, Math.floor(MAX_SECONDS * buf.sampleRate));
      const mono = new Float32Array(n);
      for (let c = 0; c < buf.numberOfChannels; c++) {
        const ch = buf.getChannelData(c);
        for (let i = 0; i < n; i++) mono[i] += ch[i] / buf.numberOfChannels;
      }
      if (player.dataset.url) URL.revokeObjectURL(player.dataset.url);
      player.dataset.url = URL.createObjectURL(blob);
      player.src = player.dataset.url;
      await processSamples(mono, buf.sampleRate);
    } catch (e) {
      setStatus('');
      alert('Could not read that audio. Try a WAV, MP3, M4A or WebM file.');
    } finally { ac.close && ac.close(); }
  }
  $('file').addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) { state.saHz = null; loadBlob(f); }
    e.target.value = '';
  });

  // ---------- recording with live tuner ----------
  let rec = null;
  async function startRecording() {
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    } catch (e) { alert('Microphone access was blocked. Allow it in the browser address bar and try again.'); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    const ac = new AC(), src = ac.createMediaStreamSource(stream), an = ac.createAnalyser();
    an.fftSize = 8192; src.connect(an);
    const chunks = [], mr = new MediaRecorder(stream);
    mr.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec = { stream, ac, an, mr, chunks, hist: [], t0: performance.now(), sa: state.saAuto ? null : state.saHz, lastSa: 0, stop: false };
    mr.onstop = () => { stream.getTracks().forEach((t) => t.stop()); ac.close(); loadBlob(new Blob(chunks, { type: mr.mimeType || 'audio/webm' })); };
    mr.start();
    $('btnRec').textContent = '■ Stop'; $('btnRec').classList.add('rec');
    $('live').hidden = false; state.saHz = state.saAuto ? null : state.saHz;
    liveLoop();
  }
  function stopRecording() {
    if (!rec) return;
    rec.stop = true; rec.mr.stop(); rec = null;
    $('btnRec').textContent = '● Record'; $('btnRec').classList.remove('rec');
    $('live').hidden = true;
  }
  $('btnRec').addEventListener('click', () => (rec ? stopRecording() : startRecording()));

  function liveLoop() {
    const r = rec; if (!r || r.stop) return;
    const buf = new Float32Array(r.an.fftSize);
    r.an.getFloatTimeDomainData(buf);
    const p = DSP.pitchOfBuffer(buf, r.ac.sampleRate);
    const now = (performance.now() - r.t0) / 1000;
    let f = 0;
    if (p && p.f0 > 0 && p.rms > 0.01 && p.conf > 0.8) f = p.f0;
    r.hist.push({ t: now, f });
    const keep = now - 8; while (r.hist.length && r.hist[0].t < keep) r.hist.shift();
    if (state.saAuto && now - r.lastSa > 1.5) {
      r.lastSa = now;
      const voiced = r.hist.filter((h) => h.f > 0).map((h) => h.f);
      if (voiced.length > 60) { const s = DSP.detectSa(Float32Array.from(voiced)); if (s) r.sa = s; }
    }
    const sa = r.sa || (state.saAuto ? null : state.saHz);
    if (f > 0) {
      $('liveHz').textContent = f.toFixed(1) + ' Hz (' + westernName(f) + ')';
      if (sa) {
        const sw = DSP.toSwara(1200 * Math.log2(f / sa));
        $('liveSwara').textContent = DSP.symbol(sw.idx, sw.oct);
        $('liveCents').textContent = (sw.dev >= 0 ? '+' : '') + Math.round(sw.dev) + '¢ from the swara';
      } else { $('liveSwara').textContent = '...'; $('liveCents').textContent = 'finding your Sa'; }
    }
    drawLive(r, sa);
    requestAnimationFrame(liveLoop);
  }
  function drawLive(r, sa) {
    const cv = $('liveCv'), w = cv.clientWidth || 600, g = sizeCanvas(cv, w, 90);
    g.fillStyle = '#11151c'; g.fillRect(0, 0, w, 90);
    const pts = r.hist.filter((h) => h.f > 0);
    if (!pts.length) return;
    const ref = sa || 440;
    const cs = pts.map((h) => 1200 * Math.log2(h.f / ref));
    let lo = Math.min(...cs) - 100, hi = Math.max(...cs) + 100;
    if (hi - lo < 600) { const m = (hi + lo) / 2; lo = m - 300; hi = m + 300; }
    const y = (c) => 8 + ((hi - c) / (hi - lo)) * 74;
    if (sa) {
      g.strokeStyle = '#222b3a'; g.lineWidth = 1;
      forGrid(lo, hi, (p, i) => { g.strokeStyle = i === 0 ? '#53627c' : '#1d2635'; g.beginPath(); g.moveTo(0, y(p)); g.lineTo(w, y(p)); g.stroke(); });
    }
    const t1 = r.hist[r.hist.length - 1].t;
    g.strokeStyle = '#ffd9a0'; g.lineWidth = 2; g.beginPath();
    let pen = false, last = null;
    r.hist.forEach((h) => {
      if (!(h.f > 0)) { pen = false; return; }
      const x = w - ((t1 - h.t) / 8) * w, yy = y(1200 * Math.log2(h.f / ref));
      if (pen) g.lineTo(x, yy); else { g.moveTo(x, yy); pen = true; }
      last = h;
    });
    g.stroke();
  }

  // exposed for testing / future integrations
  window.SwaraApp = { processSamples, state };
})();
