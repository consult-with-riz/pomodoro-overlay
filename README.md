# Pomodoro timer

**Live: https://pomodoro-overlay-rho.vercel.app**

Two tools that share one engine.

**A focus timer** — open it, press start, work. Pick 25/5, 50/10 or 90/15, choose
a background that shifts when you move from working to a break, and turn on brown
noise if that helps you concentrate.

**A video overlay maker** — the same timer, but rendered out as a video file you
can drop on top of your own footage. Useful if you make "study with me" or
"work with me" videos and want a countdown on screen.

Everything happens inside your browser. Nothing is uploaded, there's no account to
make, and no database storing anything about you. Even the video is put together
on your own machine — which is why a long render takes a while and why the tab has
to stay open while it does.

---

## What each part does

### The focus timer — at `/`

- Three session presets, so there's nothing to set up before you start
- The background changes colour between focus and break, so a break actually
  feels different from working
- A bell, chime, wooden knock or gong at each switch — or silence
- Brown, pink or white noise while the timer runs
- Type what you're working on and it shows on screen
- Your screen won't go to sleep mid-session
- Refresh the page by accident and your session carries on where it was
- Keyboard: `Space` start/pause, `S` skip, `R` reset, `F` full screen

### The overlay maker — at `/overlay`

- Ring, bar or digits; four typefaces; your own colours
- Green screen, blue screen, black, or a genuinely see-through video
- Tell it which editor you use and it picks the right format for you — this
  matters, because Premiere Pro and Final Cut **cannot open** see-through video,
  and picking it by mistake means waiting out a long render for a file your
  editor refuses
- Drop in a clip or a screenshot of your own footage to check how it'll look
  before you commit to rendering
- Style presets if you don't want to fiddle with every setting

---

## Running it on your own machine

You need [Node.js](https://nodejs.org) installed. Then:

```bash
npm install                      # download what the project needs
npx playwright install chromium  # a browser used for the tests
npm run dev                      # now open http://localhost:3000
```

That's it for day-to-day work. Other commands:

```bash
npm run build       # make the production version
npm run typecheck   # check for mistakes without running anything
npm test            # run the whole test suite (takes about a minute)
```

And a few you'll almost never need:

```bash
npm run fonts       # re-download the fonts into public/fonts/
npm run favicon     # regenerate the tab icon from app/icon.svg
npm run harness     # rebuild the test scaffolding around the old prototype
npm run golden      # re-take the reference screenshots (see below)
```

---

## Where things live

```
app/            The pages. app/page.tsx is the focus timer,
                app/overlay/page.tsx is the overlay maker.

src/            The engine. Shared by both pages.
  timeline.ts   Works out which part of the session you're in
  draw.ts       Draws one frame of the timer
  bell.ts       Makes the bell sounds from scratch, no audio files
  noise.ts      Makes the brown/pink/white noise the same way
  live.ts       Runs the clock
  export.ts     Turns the timer into a video file
  ui/           The buttons and panels you actually see

public/fonts/   The four typefaces, bundled rather than loaded from Google
reference/      The original prototype this was built from. Never edited.
tests/          See below
```

One rule worth knowing if you're changing things: **everything in `src/` except
`src/ui/` is plain TypeScript with no React in it.** That's what lets the same
code run the on-screen timer and the video export, and it's why the two can't
drift apart and start disagreeing.

`CLAUDE.md` has the longer version, including things that were deliberately left
out and why.

---

## Why there are so many tests

There are 47, which sounds like a lot for a timer. Each group exists because
something specific could break without anyone noticing.

**Reference screenshots** (`tests/golden/`) — 17 pictures of the timer, taken
from the original prototype before any of it was rewritten. Every change has to
still produce those same pictures.

This is the important one. A video file can be perfectly valid — right size,
right length, right format — and be completely blank. Checking the file tells you
nothing about whether the picture inside it is right. Only comparing actual
pixels catches that.

If you deliberately change how the timer looks, you re-take these with
`npm run golden -- --force` and say why in the commit. It refuses to overwrite
them by accident, because they're the thing everything else is measured against.

**Video checks** (`tests/video.spec.ts`) — renders a real four-minute session and
inspects the finished file: is it the right format, the right size, exactly 248
seconds long, is the see-through version actually see-through. Then it pulls a
single frame back out of the video and compares it to the reference screenshot
for that same moment — which proves that what you see on screen and what lands in
the file are the same thing.

**Page checks** (`tests/focus.spec.ts`, `tests/app.spec.ts`) — the pages load
without errors, the clock keeps proper time, a refresh doesn't destroy a session,
the timer fits on a laptop screen without scrolling, and the warnings fire when
your colour choice would get keyed out.

The video tools come bundled with the project rather than being installed on your
computer, so the tests behave the same everywhere.

---

## Settings you can turn on

All optional — it works fine with none of them set. These go in Vercel under
Project → Settings → Environment Variables.

| Name | What it does |
| --- | --- |
| `NEXT_PUBLIC_SITE_URL` | Your domain, once you have one. Makes link previews work on social media. |
| `NEXT_PUBLIC_EMAIL_FORM_ACTION` | An email signup endpoint. Without it, no signup form appears at all. |
| `NEXT_PUBLIC_TIP_URL` | A Stripe Payment Link. Without it, no tip link appears anywhere. |

One gotcha: these are baked in when the site is built, not read while it's
running. So after adding one in Vercel you have to **redeploy** before it takes
effect.

### About the tip link

It's a [Stripe Payment Link](https://stripe.com/payments/payment-links) — a
checkout page you create by filling in a form on Stripe's website. No payment
code lives in this project at all, which is the point: no secret keys to protect,
nothing stored, and the "nothing is uploaded, no backend" promise stays true.

A tip buys nothing and unlocks nothing. There are no accounts here, so there'd be
nothing to give a paying supporter — and charging for something undeliverable
isn't worth doing.

It appears where the app has just been useful: when a session finishes, while one
is running, once a video is ready to save, and quietly in settings.

---

## Licences

This project is MIT — use it however you like.

Two things inside it belong to other people and have their own terms:

- **[Mediabunny](https://mediabunny.dev)**, which does the video encoding, is
  MPL-2.0. Fine to use commercially. If you ever modify Mediabunny's own files,
  those changes have to be published too. Nothing here modifies them.
- **The four typefaces** — Big Shoulders Display, Schibsted Grotesk, JetBrains
  Mono and Instrument Serif — are under the SIL Open Font License, which allows
  bundling them like this. Their licence text ships alongside them in
  `public/fonts/OFL.txt`.
