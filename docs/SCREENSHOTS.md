# Screenshots

The README references 10 images and a hero GIF under `docs/screenshots/`.
There are **three** ways to (re)produce them, depending on what platform
you're on and what kind of fidelity you want.

| Path | Where it runs | What it produces | Fidelity |
|---|---|---|---|
| **A. SVG mockup re-render** | Anywhere (macOS / Linux / CI) | PNGs + GIF | Illustrative — looks like VS Code, isn't VS Code |
| **B. macOS `screencapture`** | macOS only | PNGs from a real VS Code window | Real |
| **C. (future) Playwright + openvscode-server** | Headless on any Linux | PNGs from a real browser-VS-Code | Real, fully automated |

Path A is what's currently committed. B is the recommended upgrade if you
want photo-real captures. C isn't implemented yet but the door is open.

---

## A. SVG mockup re-render (cross-platform)

This is the default path — everything in `docs/screenshots/_src/*.svg` is the
source of truth, and the PNGs + GIF are generated from them. Anyone can edit
the mockups and re-render.

**Install prerequisites** (one-time):

```bash
# macOS
brew install librsvg ffmpeg

# Debian / Ubuntu
sudo apt-get install -y librsvg2-bin ffmpeg
```

**Render** (idempotent — rewrites every output every run):

```bash
bash scripts/render-from-svg.sh     # 10 PNGs
bash scripts/build-demo-gif.sh      #  1 GIF (depends on the PNGs)
```

---

## B. macOS `screencapture` (real captures, manual)

For photo-real screenshots from an actual VS Code session, **macOS only**:

```bash
bash scripts/take-screenshots.sh           # all 7
bash scripts/take-screenshots.sh log-graph # just one
```

The script:

1. Builds an ephemeral demo repo at `$TMPDIR/rebased-screenshot-fixture`
   with 3 branches, 9 CC-style commits, a UU conflict file, and a dirty
   file with two distinct hunks.
2. Opens VS Code at the fixture.
3. For each screenshot, prints what to set up, waits for `<Enter>`, then
   runs `screencapture -W -o` so you click the target window.
4. Saves to `docs/screenshots/<name>.png` (overwrites the SVG-rendered
   mockup with a real capture).

**Permission**: Screen Recording must be granted to Terminal.app — see
System Settings → Privacy & Security → Screen Recording. Without it
`screencapture` fails silently with "could not create image from display".

---

## C. Playwright-driven (planned)

Browser-based VS Code (`openvscode-server`) can be driven headless via
Playwright. A future `scripts/take-screenshots-headless.mjs` could:

1. Start `openvscode-server` with the extension preloaded.
2. Launch a headless Chromium pointing at the local URL.
3. For each scenario, trigger VS Code commands via the `command:` URL
   scheme, wait for the resulting UI, snap with `page.screenshot()`.
4. Save to `docs/screenshots/`.

This would give photo-real screenshots without manual intervention, and
would run on Codespaces / CI. Contributions welcome — the
groundwork (deterministic fixture + per-screenshot prep instructions)
is already in `scripts/setup-screenshot-fixture.sh` and
`scripts/take-screenshots.sh`.

---

## Per-shot fidelity notes

| Name | Path A (SVG mockup) | Path B (real capture) |
|---|---|---|
| `rebase-editor.png` | ✓ | recommended (shows real drag) |
| `log-graph.png` | ✓ | recommended (real swim-lane on real branches) |
| `commit-details.png` | ✓ | nice-to-have |
| `commit-wizard.png` | ✓ | photo-real adds nothing (QuickPick is identical) |
| `blame-gutter.png` | ✓ | recommended (real code wraps differently) |
| `local-history.png` | ✓ | nice-to-have |
| `conflict-panel.png` | ✓ | nice-to-have |
| `status-bar.png` | ✓ | trivial, mockup is fine |
| `changelists.png` | ✓ | recommended (interactions are richer) |
| `submodules.png` | ✓ | trivial |
| `demo.gif` | ✓ | auto-rebuilt from the PNGs above |

---

## Compression (optional)

PNGs out of `rsvg-convert` are already ~40-100 KB each, no compression
needed. Real `screencapture` shots can be 1-3 MB — compress with:

```bash
brew install pngquant     # one-time
pngquant --ext .png --force --quality=70-90 docs/screenshots/*.png
```
