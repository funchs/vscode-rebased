# Brand assets

All brand images live under `docs/screenshots/`. Sources are SVG (in
`_src/`), checked-in PNGs are rendered via `bash scripts/render-from-svg.sh`
(needs `librsvg2-bin` / `librsvg`).

## Files

| File | Size | Use |
|---|---|---|
| `cover.png` | 1280×640 | README hero · GitHub Social Preview · Twitter/X card |
| `banner.png` | 1280×320 | Marketplace listing top banner · narrow page hero |
| `wordmark.png` | 800×400 | Logo + name only · talks / slides · footer logo · favicon-large |
| `media/icons/rebased.png` | 128×128 | Extension icon (`package.json:icon`) |
| `media/icons/activity-bar.svg` | 24×24 | Sidebar activity-bar icon — monochrome, uses `currentColor` |
| `media/icons/rebased.svg` | 128×128 | Marketplace SVG fallback |

## Palette

| Token | Hex | Use |
|---|---|---|
| Brand deep | `#1e1b4b` | Gradient start |
| Brand mid | `#3b3b80` | Marketplace `galleryBanner.color` |
| Brand vibrant | `#7c3aed` | Gradient end / accent |
| Brand soft | `#c4b5fd` | Wordmark gradient stop / accent text |
| Surface | `#1e1e1e` | Mock VS Code editor background |

## Typography

- Wordmark and headings: `-apple-system, "SF Pro Display"`, weight 800,
  letter-spacing −2.
- Body / taglines: `-apple-system, "SF Pro Text"`, weight 500.
- Code / monospace: `"SF Mono", Menlo, monospace`.

These resolve to system fonts on every platform; no font assets need to
be embedded in the rendered PNG.

## Logo construction

Three filled circles (top, middle-right, bottom) joined by a vertical
line on the left and two symmetric curves to the right node. The
"orbits a node" feeling reads as a git graph collapsing a branch back
to a parent — matches the project name.

Always use white circles on a dark gradient. Don't recolor the glyph.

## Using elsewhere

- **Slack / Discord avatar**: crop `wordmark.png` to a circle around the
  glyph (left half).
- **Talk slide title card**: `cover.png` works directly as a 16:9
  introduction slide if scaled to 1920×960 (still proportional).
- **Article header image**: `banner.png` fits Medium / dev.to feature
  image slots.

## License

The brand assets are released under the project's MIT license. Forks
and adaptations are fine; please don't impersonate Rebased on
marketplaces (use your own publisher name in the listing).
