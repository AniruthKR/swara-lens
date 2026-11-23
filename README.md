# Swara Lens

Record or upload Carnatic music to see its swaras, gamakas and likely raga, and practise against a reference. A static site: no backend, no database, no build step. All audio analysis runs in the user's browser, so hosting is free and nothing is uploaded.

## What it does

**Analyze**
- Mic recording with a live tuner (current swara, cents off, rolling contour) or audio upload, up to 3 minutes, with a start-time control for longer files
- Two pitch trackers: **Solo** (YIN, for one voice or instrument) and **Song / concert** (spectral melody tracker with drone suppression, for recordings with tanpura, violin or percussion). Uploads default to Song, mic recordings to Solo; switching re-analyses instantly
- Sa (shruti) auto-detection with manual override by note or exact Hz
- **Fixed-width rolling view**: the contour always fits the screen. Choose a 4 s, 8 s, 15 s or full window; it follows playback or the live signal, has a mini-map to jump around, drag to pan, tap to seek
- Swara notation with octave marks and gamaka hints (kampita, andolita, jaru, slide, touch), raga suggestion with arohana / avarohana

**Practice**
- *Self-check*: how far each held swara sits from the pure position, with advice for individual notes that are off
- *Compare with a reference*: sing a phrase back; your attempt is aligned to the reference (DTW), so a different tempo, shruti or octave does not count against you. You get a score, pitch accuracy, gamaka match, and note-by-note feedback ("G3: flat by 47 cents, kampita missing")

**Library**
- Save analyses and practice attempts in the browser (IndexedDB). Pitch data is tiny (about 10 KB per 100 s); audio is optional. Export / import a JSON backup

## Files

| File | Purpose |
| --- | --- |
| `index.html`, `style.css`, `app.js` | UI, viewer, practice and library screens |
| `dsp.js` | YIN pitch tracking, Sa detection, swara and gamaka analysis, raga scoring |
| `melody.js` | Melody tracker for mixed music |
| `practice.js` | Intonation report and DTW reference comparison |
| `store.js` | IndexedDB library, backup, storage persistence |
| `ragas.js` | Raga data (starter set, have a guru review it) |
| `test.js`, `test_mix.js`, `test_practice.js` | Node tests on synthetic audio: `node test.js` etc. |
| `vercel.json` | Mic permission header, clean URLs |

## Run locally

```bash
npx serve .        # or: python3 -m http.server 3000
```

The mic works on `localhost` and on any HTTPS site.

## Deploy to Vercel (free)

1. Push this folder to a GitHub repo.
2. On vercel.com choose Add New, then Project, and import the repo.
3. Framework Preset **Other**, leave build settings empty, Deploy.

CLI alternative: `npm i -g vercel`, then `vercel --prod`.

Check Vercel's Terms of Service before charging users on the free Hobby plan. I could not confirm the exact wording of its commercial-use rules from their docs pages, so do not rely on this README for that. Cloudflare Pages and Netlify also host static sites for free, and this project moves over unchanged.

## Storage options

Checked against the providers' pages in November 2026. Limits change, so re-check before you commit.

| Option | Free allowance | Catches | Fit |
| --- | --- | --- | --- |
| **Browser (IndexedDB)**, built in | Browser-managed quota | Private to one device and browser. Browsers can evict it; `persist()` helps (Chrome decides silently, Firefox asks, Safari uses heuristics). Safari may clear sites you have not used for a while | Best for now: free, private, no sign-up. Export a backup |
| **Supabase** | 500 MB database, 1 GB files, 50 MB max upload, 5 GB egress, 50,000 monthly users, 2 active projects | Free projects pause after about a week of inactivity (they keep their data and can be restored) | Best first cloud step: Postgres, login and file storage in one. 500 MB holds thousands of pitch-only recordings (about 100 KB for 3 minutes) |
| **Cloudflare R2 + D1** | R2: 10 GB-month, 1M writes, 10M reads, no egress fees. D1: 5 GB, 5M rows read and 100k rows written per day | You must write a Worker to front them. From 1 September 2026 D1 queries fail after the daily limits until midnight UTC | Good for audio files later; more setup |
| **Vercel Blob (Hobby)** | 1 GB, 10,000 simple and 2,000 advanced operations, 10 GB transfer | Going over blocks Blob for 30 days | Fine for a demo, tight for real use |
| **Firebase** | Firestore: about 20,000 writes and 50,000 reads per day (example figures on their plans page) | Their September 2024 FAQ says Cloud Storage now needs the pay-as-you-go Blaze plan, while the plans page still lists it under the free plan. Confirm in the console before relying on it | Skip unless you already use Firebase |

**Recommendation:** keep the browser library as the default. Add accounts and sync only when users ask for another device, using Supabase and storing the pitch track and notation, not audio. Keep audio local; it is the heavy part and the copyright-sensitive part. `store.js` already has the small `put / get / list / remove` interface a cloud backend would plug into.

## Known limits (say these in your pitch before anyone else does)

- **Tested only on synthetic audio and a fake microphone.** Real concerts and film songs are harder: a violin shadowing the voice, a pitched mridangam, reverb. The Song tracker handles drone and percussion in tests; it does not separate a voice from other melodic instruments. Heavily produced songs need source separation, which is the next phase.
- Gamaka detection is rule-based: steady, oscillation (kampita or andolita), glide, slide. It does not name nokku, sphurita or pratyahatam reliably.
- Practice mode does not yet check whether you reproduced each jaru. It checks pitch, gamaka type, timing and steadiness.
- The self-check cannot tell a flat G3 from a sharp G2 on its own (they are about 70 cents apart); a reference settles it.
- Raga suggestion uses swara usage, not phrases, so ragas with identical notes are grouped.
- The pure-intonation grid is a reference, not the truth; singers and ragas vary, so treat under 20 cents as fine.
- Raga data is a starter set written without a guru's review.

## Roadmap

1. **Pilot with 5 to 10 teachers and students.** Record real phrases, note where gamaka labels and scores are wrong. This data is your edge.
2. Jaru and entry-shape checks in practice mode; progress over time from saved attempts.
3. Source separation (small ONNX model in the browser) for polyphonic recordings.
4. Phrase (pidi) matching for raga identification, trained on CompMusic datasets.
5. Accounts and cross-device sync (Supabase), then a PWA / mobile wrapper.
