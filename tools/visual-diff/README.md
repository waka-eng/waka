# Visual diff tooling

Headless-Chromium screenshot capture that renders the **legacy `index.html`**
and the **new React app** at matched routes/viewports, then writes
side-by-side image pairs and a browsable HTML report under
`tools/visual-diff/output/`.

This is the foundation for AC 4.5 (visual parity). Sub-AC 4.5.1 covers
*tooling setup only* — actual parity verdicts come later.

## What gets produced

```
tools/visual-diff/output/
  legacy/<viewport>/<pair>.png        raw legacy screenshot
  react/<viewport>/<pair>.png         raw react screenshot
  diff/<viewport>__<pair>.png         side-by-side composite
  index.html                          human-friendly report
  manifest.json                       machine-readable index
```

## Usage

```bash
# 1. one-time install of the Chromium binary Playwright drives
pnpm visual-diff:install

# 2. start the React app in another terminal
pnpm --filter @waka/web dev

# 3. capture
pnpm visual-diff
```

The legacy origin is served by a tiny in-process static server that
streams `index.html` from the repo root, so you don't have to start
anything yourself for the legacy side.

### Flags

| flag | default | purpose |
| --- | --- | --- |
| `--react-base-url=URL` | `http://localhost:5173` | React app origin |
| `--legacy-base-url=URL` | (built-in static server) | Override legacy origin |
| `--session-cookie=KV` | — | Raw cookie string applied to the React origin so authenticated routes (e.g. `/`) don't redirect to `/login` |
| `--only=a,b,c` | all | Restrict to specific pair names from `pairs.config.ts` |
| `--viewports=desktop` | all | Restrict to specific viewports (`desktop`, `tablet`, `mobile`) |
| `--out-dir=PATH` | `tools/visual-diff/output` | Output directory |

### Adding new comparisons

Edit `tools/visual-diff/pairs.config.ts`. Each pair declares:
- `legacyPath` and `reactPath` (resolved against the respective origin)
- `viewports` (any subset of `VIEWPORTS`)
- optional `legacyPrep` / `reactPrep` JS to normalize the page state
  (dismiss modals, seed mock data, etc.) before screenshotting.
