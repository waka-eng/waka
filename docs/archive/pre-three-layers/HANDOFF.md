# Handoff — ambition-mirror UI pass

Branch: `ralph/ambition-mirror-context-graph`. This note hands off an in-progress
design/UX pass so another agent (Codex) can continue. Full step-by-step history
is in `progress.txt` (newest entries at the bottom).

## How to get oriented
- Read the last ~6 entries of `progress.txt`.
- `git log` on this branch + `git show HEAD` for the latest committed batch.
- App runs locally on `:3030` (built `dist`, static-served) and via Vite on `:5173`
  (`pnpm --filter @waka/web dev`). `:3030` only reflects source after
  `pnpm --filter @waka/web build`.

## Verify state
- `pnpm --filter @waka/web typecheck` → clean.
- `pnpm --filter @waka/web test` → 156/156.
- `pnpm --filter @waka/api test` → runnable again (see API fix below); ~251 pass,
  ~21 pre-existing legacy-WOW failures remain (not from this work).

## What was built in this pass
- **Drawer "constellation"** (Inspiration Drawer, Shopify-Editions style): saved-
  inspiration groups render as `/slug` text tags on a clean opaque field
  (`#f4f2ee`). Centered flex-wrap layout so tags never overlap; no connecting
  lines; full opacity by default, dim to 0.4 once hovered/opened; hover morphs the
  tag in place (background-color + min-width, Shopify `skill-tag` feel) with a
  forgiving `::before` hit-area; hovering reveals an anchored card (blurb + "open
  these N saves" + label). Files: `packages/web/src/pages/Home.tsx`,
  `packages/web/src/styles/global.css`.
- **Category contents screen** (after clicking a `/tag`): redesigned to "recede &
  reveal in place" — `.memory-contents-flow`: chosen tag becomes the title, plain
  text list (`.memory-contents-item`, hairline separators, no boxes/shadows), light
  fade-in (`contentsFlowIn`), `← back to map`. Sort toggle removed (always newest).
- **Capture modal chrome:** close centered (top); attach + expand (focus mode)
  bottom-left; Reflect deeper / Save it now bottom-right; no enclosing bar; smaller/
  lighter treatment. Expand fills to the top. Files:
  `packages/web/src/components/capture/CaptureCell.tsx`, `Home.tsx`, `global.css`.
- **Post-save UX:** the old "Saved." mirror card is gone. On save the modal closes
  and the capture button flashes "saved" with a warm-yellow glow
  (`onSaved` → `handleCaptureSaved`, `.nc-save--saved`). A `···` hint shows on the
  capture button when an unsaved draft is in local storage.
- **Bottom bar:** capture↔search states unified (translucent glass); both directions
  animate; search bar shows a warm amber focus ring while typing.
- **Action checklist:** removed the client-side fallback action generator (it
  produced generic templates and broke the learning loop). Actions now come only
  from the server recommender.
- **Rename/test cleanup:** user-facing noun is "inspiration"/"영감" ("signal" is
  internal only). Fixed login copy + i18n/InspirationCard/WowMomentsSection stale
  tests so the full web suite is green.
- **API test fix:** `packages/api/test/setup.ts` now layers `.env` then `.env.local`
  (override) — the repo `.env` ships a placeholder `HOST.neon.tech` that made the
  whole suite fail at import. Also bumped `hookTimeout` 10s→45s in
  `packages/api/vitest.config.ts` for the remote-DB schema setup.

## OPEN ITEMS — what to continue building (this is the to-do list)

### A. Verify / finish in-flight (do first)
1. **Re-run `pnpm --filter @waka/api test`** to confirm the `hookTimeout` 10s→45s
   bump cleared the DB-setup hook-timeout cascade (dominant cause of the
   "36 files failed / 21 tests failed" gap). This change is committed but was not
   re-run.
2. **Verify the capture close animation** on `:3030` — the user flagged that
   closing the capture modal should animate back. The `--closing` keyframes
   (`captureSheetToPill` / `captureBackdropOut`) exist; confirm it actually plays,
   and tune if it feels abrupt.

### B. Forward design work to continue (the user is mid-iteration here)
3. **Redesign the saved-inspiration DETAIL screen** (`renderMemoryStackDetail` /
   `.memory-stack-detail` in `Home.tsx` + `global.css`). The user just had me
   redesign the category *contents* list ("recede & reveal in place"); the *detail*
   view a save opens into is still the older treatment and should be brought into
   the same calm, text-forward language. Likely the next thing they ask for.
4. **Keep refining the constellation drawer** to match Shopify Editions
   (`/editions/winter2026`) — current state is collision-free tags + hover card.
   Open polish: card edge-flip near viewport edges, the "make my own" create node is
   intentionally hidden (browse-only) — confirm that's the desired end state.

### C. Known debt / cleanup
5. **Legacy WOW test failures (~21):** `test/wow-judge.test.ts`,
   `test/wow-moments.test.ts`, `src/routes/admin-meaning-graph.test.ts` — stale
   prompt-copy assertions + a few judge logic/mock mismatches. Legacy (WOW
   superseded by Top of Mind); decide: fix or quarantine.
6. **Dead code to remove:** `renderMemoryWindow` / `renderMemoryFlow` are `void`-ed
   (US-040/041 superseded); `WowMomentsSection` is orphaned; unused CSS
   `.reference-capture-controls` / `.reference-capture-min` left after the
   minimize-control rework; stray untracked `apps/` (`.next/trace`) — delete or
   gitignore.

### D. Deferred audit / product items (from the PRD audit earlier this session)
7. **US-029**: the saved-inspiration detail never renders the required reflection
   prompts ("what did this mean then / now / is this still me") or the
   still-alive / changed-shape / not-anymore feedback. Build these into the detail
   redesign (item 3).
8. **Top-of-Mind fallback leak**: when there are no generated notes, the wall falls
   back to `top-of-mind-preview.ts` output, which can emit **raw graph labels** —
   exactly the banned label-summary voice. The generated path is fine; the fallback
   isn't voice-validated.
9. **Static per-dimension Top-of-Mind titles**: `postItThoughtForDimension` returns
   8 fixed strings, so the deterministic voice tests pass but generation is
   template-like (two "work" nodes yield identical text).

### Decisions already made (do NOT re-open)
- Capture **resonance/reaction chips were intentionally removed** (highlight-only
  capture). PRD US-050 is annotated; treat as done, not a regression.
- Memory-drawer **keep/dismiss + "make my own" were dropped** in favor of the
  browse-only Shopify-style constellation. Intentional.
- User-facing noun is **"inspiration"/"영감"**; "signal" is internal-only.

## Conventions
- Match surrounding code style; user-facing copy is lowercase + warm.
- After any change, run web typecheck + the relevant test file; run the FULL web
  suite before declaring done (per-story runs previously let failures accumulate).
- `:3030` is a built bundle — rebuild after source changes or it looks stale.
