# Swara Lens

Record or upload a Carnatic phrase and see its swaras, gamakas and likely raga. Pure static site: no backend, no database, no build step. All audio analysis runs in the user's browser, so hosting is free and nothing is uploaded.

## What it does today

- Pitch tracking (YIN) on mic recordings or uploaded audio, up to 3 minutes
- Live tuner view while recording (current swara and cents off)
- Sa (shruti) auto-detection, with manual override by note or exact Hz
- Pitch contour drawn over the swarasthana grid, with tap-to-seek audio playback
- Swara segmentation with octave marks, plus gamaka hints: kampita, andolita, jaru (glide into a note), slide within a note, quick touches
- Raga suggestion from swara usage (22 starter ragas in `ragas.js`), with arohana / avarohana and melakarta info
- Copyable notation string

## Files

| File | Purpose |
| --- | --- |
| `index.html`, `style.css`, `app.js` | UI |
| `dsp.js` | Pitch tracking, Sa detection, swara and gamaka analysis, raga scoring (works in browser and Node) |
| `ragas.js` | Raga data. Have a guru check and extend it |
| `test.js` | `node test.js` synthesizes a Mohanam phrase and checks the engine |
| `vercel.json` | Mic permission header, clean URLs |

## Run locally

```bash
npx serve .        # or: python3 -m http.server 3000
```

Open the printed URL. The mic works on `localhost` and on any HTTPS site.

## Deploy to Vercel (free)

**Option A, no CLI:**
1. Create a GitHub repo and upload these files (or `git init && git add . && git commit && git push`).
2. On vercel.com choose Add New, then Project, and import the repo.
3. Framework Preset: **Other**. Leave Build Command and Output Directory empty. Deploy.
4. You get `https://<name>.vercel.app` with HTTPS, which the mic needs.

**Option B, CLI:**
```bash
npm i -g vercel
vercel          # first run links the project
vercel --prod
```

Notes on cost:
- Vercel's free Hobby plan is meant for personal, non-commercial use. That is fine for a pitch demo. Check their current terms before you charge users; Cloudflare Pages and Netlify have free static hosting too, and this project moves over unchanged.
- A custom domain is the only real cost (about 700 to 1,000 INR a year).

## Known limits (say these in your pitch before anyone else does)

- Works best on a single voice or instrument. Full concerts with violin, mridangam and tanpura need source separation, which is a later phase.
- Gamaka detection is rule-based. It separates steady notes, oscillations, slow swings and glides; it does not yet name every gamaka (nokku, sphurita, pratyahatam, etc.) reliably.
- Raga suggestion is by swara usage, not by characteristic phrases, so ragas with identical notes (for example Natabhairavi and Bhairavi) are listed together.
- Intonation grid is just intonation; real singers vary, and the app shows the deviation in cents on each chip's tooltip.
- Raga data is a starter set. Get it reviewed by a teacher before launch.

## Roadmap

1. **Pilot with 5 to 10 teachers and students.** Record real phrases, note where gamaka labels are wrong. This is your most valuable data.
2. **Practice mode:** record a teacher's phrase, let the student sing it back, overlay both contours and score pitch accuracy, shruti stability and gamaka shape.
3. **Better raga ID:** add phrase (pidi) matching and more ragas, trained on CompMusic / Dunya Carnatic datasets.
4. **Save sessions** (free tier of Supabase or Firebase) and share a result link.
5. **ML upgrade:** run a small ONNX model in the browser (CREPE-tiny for pitch, a separation model for polyphonic audio) when you have data to justify it.
6. **PWA / mobile wrapper** once the web version is proven.

## Pitch tips

- Demo with a live phrase from a real singer, not a studio file. The moving contour with kampita highlighted is the moment people get it.
- Lead with the learner problem ("practising at night with no guru nearby"), then the tech.
- Show the practice-feedback idea as the next step; that is what retains users.
