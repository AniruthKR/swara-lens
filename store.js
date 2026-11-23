/* Swara Lens - local library (IndexedDB). Nothing leaves the device.
 *
 * A saved item stores the *analysis input* (the cleaned pitch track in Hz, 10 ms per value), not the notes:
 * notes, gamakas and raga are recomputed on open, so improvements to the engine apply to old recordings too.
 * Audio is optional and off by default (space, and copyright for commercial recordings).
 *
 * Record shape:
 *   { id, name, kind: 'analysis'|'practice', createdAt, duration, saHz, mode: 'solo'|'song',
 *     f0: Float32Array, notation: string, raga: string|null, score: number|null, audio: Blob|null }
 *
 * The same small interface (list / get / put / remove) can later be implemented against Supabase or
 * Cloudflare, see the README. exportAll / importJSON give users a portable backup today.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.STORE = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const DB = 'swara-lens', VER = 1, OS = 'items';
  let dbp = null;

  function idb() { return (typeof indexedDB !== 'undefined' && indexedDB) || null; }
  function available() { return !!idb(); }

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      const api = idb();
      if (!api) return reject(new Error('Browser storage is not available here.'));
      const req = api.open(DB, VER);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(OS)) db.createObjectStore(OS, { keyPath: 'id' }).createIndex('createdAt', 'createdAt');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => { dbp = null; reject(req.error || new Error('Could not open storage.')); };
      req.onblocked = () => { dbp = null; reject(new Error('Storage is blocked by another tab.')); };
    });
    return dbp;
  }

  function tx(mode, fn) {
    return open().then((db) => new Promise((resolve, reject) => {
      const t = db.transaction(OS, mode), store = t.objectStore(OS);
      let out;
      Promise.resolve(fn(store)).then((v) => { out = v; }, reject);
      t.oncomplete = () => resolve(out);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('Storage write was aborted (disk full?).'));
    }));
  }
  const wrap = (req) => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });

  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  function put(rec) {
    const r = Object.assign({ id: newId(), createdAt: Date.now(), kind: 'analysis', audio: null }, rec);
    if (r.f0 && !(r.f0 instanceof Float32Array)) r.f0 = Float32Array.from(r.f0);
    return tx('readwrite', (s) => wrap(s.put(r))).then(() => r);
  }
  function get(id) { return tx('readonly', (s) => wrap(s.get(id))); }
  function remove(id) { return tx('readwrite', (s) => wrap(s.delete(id))); }
  // list without the heavy fields, newest first
  function list() {
    return tx('readonly', (s) => wrap(s.getAll())).then((all) =>
      all.sort((a, b) => b.createdAt - a.createdAt).map((r) => ({ id: r.id, name: r.name, kind: r.kind, createdAt: r.createdAt, duration: r.duration, notation: r.notation, raga: r.raga, score: r.score, mode: r.mode, hasAudio: !!r.audio, saHz: r.saHz, bytes: (r.f0 ? r.f0.byteLength : 0) + (r.audio ? r.audio.size : 0) })));
  }
  function rename(id, name) { return get(id).then((r) => { if (!r) throw new Error('Not found'); r.name = name; return tx('readwrite', (s) => wrap(s.put(r))); }); }

  // ---- portable backup (JSON, audio not included) ----
  function exportAll() {
    return tx('readonly', (s) => wrap(s.getAll())).then((all) => JSON.stringify({
      app: 'swara-lens', version: 1, exportedAt: new Date().toISOString(),
      items: all.map((r) => ({ id: r.id, name: r.name, kind: r.kind, createdAt: r.createdAt, duration: r.duration, saHz: r.saHz, mode: r.mode, notation: r.notation, raga: r.raga, score: r.score,
        f0: r.f0 ? Array.from(r.f0, (v) => Math.round(v * 10) / 10) : [] })),
    }));
  }
  function importJSON(text) {
    let data;
    try { data = JSON.parse(text); } catch (e) { return Promise.reject(new Error('That file is not valid JSON.')); }
    if (!data || data.app !== 'swara-lens' || !Array.isArray(data.items)) return Promise.reject(new Error('That does not look like a Swara Lens backup.'));
    let n = 0;
    return data.items.reduce((p, it) => p.then(() => {
      if (!it || !Array.isArray(it.f0) || !it.f0.length || !(it.saHz > 0)) return null;
      n++;
      return put({ id: it.id || undefined, name: String(it.name || 'Imported').slice(0, 80), kind: it.kind === 'practice' ? 'practice' : 'analysis', createdAt: +it.createdAt || Date.now(), duration: +it.duration || 0, saHz: +it.saHz, mode: it.mode === 'song' ? 'song' : 'solo', notation: String(it.notation || '').slice(0, 4000), raga: it.raga || null, score: it.score == null ? null : +it.score, f0: it.f0 });
    }), Promise.resolve()).then(() => n);
  }

  // ---- space and persistence ----
  function usage() {
    const s = typeof navigator !== 'undefined' && navigator.storage;
    if (!s || !s.estimate) return Promise.resolve(null);
    return s.estimate().then((e) => ({ usage: e.usage || 0, quota: e.quota || 0 })).catch(() => null);
  }
  function persisted() { const s = typeof navigator !== 'undefined' && navigator.storage; return s && s.persisted ? s.persisted().catch(() => false) : Promise.resolve(false); }
  // Ask the browser not to evict our data. Chrome decides silently, Firefox asks the user, Safari uses heuristics.
  function persist() { const s = typeof navigator !== 'undefined' && navigator.storage; return s && s.persist ? s.persist().catch(() => false) : Promise.resolve(false); }

  return { available, put, get, list, remove, rename, exportAll, importJSON, usage, persisted, persist };
});
