# Pomodoro timer and overlay maker

A browser-only Pomodoro timer that also renders itself to a video file you can lay
over footage — green screen, blue screen, or WebM with real transparency.

Nothing is uploaded. There is no backend, no account, no analytics on your session.
The encoding happens on your machine, in your browser.

## Status

Phase 1 of 4. The prototype works and the test harness is in place; the Next.js port
has not started.

- [x] **1 · Harness** — repo, pinned fonts, golden frames captured from the prototype
- [ ] **2 · Port** — extract to Next.js + TypeScript, mediabunny from npm, File System Access API
- [ ] **3 · Ship gaps** — capability detection, size guard, wake lock, metadata, analytics, email capture
- [ ] **4 · Deploy** — GitHub → Vercel, CI on pull requests

## Working on it

```bash
npm install
npx playwright install chromium

npm run fonts     # pin the four fonts into public/fonts/ (already committed)
npm run harness   # derive the test harness from the prototype
npm run golden    # capture reference frames (refuses to overwrite without --force)
npm test          # Playwright
```

`reference/pomodoro-overlay.html` is the original working prototype and the spec for
how the timer looks and counts. It is read-only — the golden frames in `tests/golden/`
were captured from it, and they are what the port is tested against.

See `CLAUDE.md` for the architecture, the rules, and what is deliberately out of scope.

## Licences

The app is MIT. [Mediabunny](https://mediabunny.dev) is MPL-2.0. The four fonts —
Big Shoulders Display, Schibsted Grotesk, JetBrains Mono, Instrument Serif — are under
the SIL Open Font License and are redistributed in `public/fonts/`.
