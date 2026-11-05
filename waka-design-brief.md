# WAKA — Design brief for the home surface

This brief is for a coding agent working in the WAKA web app (dev.waka.im). It replaces the current Home / Inspirations / Chats navigation with a single capture-first surface. Read the whole brief before changing anything. Where it says "do not", that is a hard constraint, not a preference.

## 1. What this change is for

WAKA's value loop is: **save things mindlessly → the app notices what you keep coming back to (Top of Mind) → over time that becomes principles → eventually, other people with overlapping Top of Minds.**

The current home screen does not express that loop. It has two stacked primary controls (a "+ New inspiration" pill and a three-tab bar), a mascot with a teaser bubble, and no stream. Saving feels like a decision; the reward is hidden behind "Read in full".

The target: **saving is the only action on the screen, and the reward is always visible.**

## 2. Aesthetic vs. usability: the trade-off, decided

Earlier iterations were changed on readability grounds in ad-hoc ways. This section settles the trade-off so it does not get re-litigated per component.

**Keep (this is the brand):**
- Dark starfield background with the subtle noise texture
- Warm cream paper surfaces for anything "the app says to you"
- The blob mascot and its speech bubble as the voice of the app
- The geometric sans (current typeface) for UI; a readable serif or humanist sans is allowed for long-form reading (Top of Mind full text, saved articles)
- Generous whitespace and a single centered column

**Fix (these are the readability problems, solved with rules, not redesigns):**
- No text below 13px. Body text ≥ 16px on mobile, ≥ 15px on desktop.
- Contrast: primary text on dark ≥ 10:1 (cream `#EDE6D6` on `#0B0D12` passes). Secondary text ≥ 4.5:1 — do not dim with opacity below 0.72; use a dedicated secondary color token instead.
- Never put text under 16px directly on the starfield. Small text sits on a surface (paper card or the dark glass bar).
- Light weight (300) is only for sizes ≥ 24px. Everything else is 400 or 500.
- Line length for reading ≤ 68 characters; line-height 1.5 for body, 1.3 for headings.
- Motion: ease-out, 180–240ms, never bouncy. The mascot may breathe (scale 1.00–1.02, 4s loop). Nothing else animates idly.

If a readability concern comes up that these rules do not cover, add a rule here and apply it everywhere, rather than changing one component.

## 3. The target screen

One screen. Three zones, top to bottom:

### 3a. Top bar (unchanged structure, lighter)
- Profile switcher (ME / AGENT1) stays top-left. Reduce to 12px label + 20px avatar; it is not a primary control.
- Actions / info / settings stay top-right as icon-only, 20px, secondary color.

### 3b. The mascot and what it says (center, the reward)
- The mascot stays centered in the upper half.
- The speech bubble is the **Top of Mind** surface. It shows the current reading, not a teaser:
  - Eyebrow (13px, secondary): "On your mind lately" (not "right now"; the reading updates on a 24h cadence).
  - Body: the first Top of Mind entry in full, up to ~70 words. If the reading has several entries, show them as a paged bubble (dots or ← → below the text), one entry per page. No truncation with "…".
  - Footer actions, text only, 14px: "Why?" (expands the cited saves inline, inside the bubble) and "Talk about this" (opens chat with this entry as context).
- Empty state (0–4 saves): the bubble says what will happen — "Save a few things and I'll tell you what I notice." — and nothing else. No review prompts in the first session.
- Emerging state (tentative signals exist, no full reading yet): eyebrow becomes "I might be noticing", body is the tentative statement, footer gains "Yes" / "Not really" as the only two actions. This replaces the separate review flow for the common case.
- Review backlog (≥1 unanswered review card beyond the one shown): a small text link under the bubble, "2 more to look at", secondary color. **Never** an exclamation mark, never a badge, never "Dive into review".

### 3c. Capture bar (bottom, the only primary control)
Replace both the "+ New inspiration" pill and the tab bar with one docked input, like a messaging app:

- A single rounded field, full width minus 16px gutters, docked to the bottom with safe-area padding. Dark glass surface (same as the current tab bar), cream text.
- Placeholder: "Paste, type, or drop anything" (not "New inspiration"). The word "inspiration" does not appear on this screen as a verb or button.
- Left of the field: a `+` icon that opens a sheet for photo / file / voice. Right of the field: a send/save arrow that appears when the field has content.
- Enter / tap arrow **saves immediately**. No title, no tags, no reflection questions at save time. The field clears, and a 1.5s inline confirmation appears above the bar ("Saved") then fades. No modal, no navigation.
- Pasting a URL saves it as a link capture on Enter; do not open a preview first.
- Dropping a file or image anywhere on the screen saves it.
- Voice: press-and-hold the mic (inside the `+` sheet, or long-press the `+`) dictates into the field using browser speech recognition; release to save.

**Chat is a mode of the same field, not a tab.** Two ways in:
1. "Talk about this" from the bubble.
2. A small toggle at the left edge of the field: `Save` / `Ask` (14px text, segmented). Default is Save. In Ask mode the placeholder reads "Ask about what you've saved" and the bar grows into a thread above the field.

The mode must be visually unmistakable: in Ask mode the field border takes the accent color and the mascot's eyes turn toward the field.

### 3d. The stream (below the fold, pull up to see)
- Below the mascot zone, the stream of saves, newest first, in plain cards: date (13px secondary), content preview (16px), source chip if it came from the share sheet / extension / agent.
- The stream is reachable by scrolling; the mascot zone shrinks (not disappears) as you scroll, and the capture bar stays docked.
- Tapping a card opens it in a sheet. Each sheet has, at most: the content, "What this supports" (the signals it is evidence for), delete.
- Signals and principles get their own section headers inside the stream ("Patterns" and "Principles"), **not** separate tabs. Order: Top of Mind (the bubble) → stream of saves → patterns → principles, as one scrollable page with sticky section labels.

### What is removed
- The "+ New inspiration" pill.
- The Home / Inspirations / Chats tab bar.
- The "There is N thing to review!" prompt.
- "Read in full" (the bubble shows the full entry).

## 4. Capture outside the app (same milestone, if feasible)

"Mindless" means capturing from where the user already is. If any of these are achievable in this pass, do them; otherwise leave stubs and note what is missing:
- **Web Share Target** (PWA manifest `share_target`) so the app appears in the mobile share sheet; a shared URL or text saves on arrival with no screen shown except the "Saved" toast.
- **Browser extension or bookmarklet** that saves the current page or selection in one click.
- **Email-in address** per profile (display it in settings).

## 5. Tokens

Define these once in CSS variables and use them everywhere. Values are starting points; keep the relationships.

```
--bg:            #0B0D12   /* starfield base */
--bg-glass:      rgba(22,24,30,0.86) + backdrop-blur 16px
--paper:         #EDE6D6
--paper-ink:     #1A1814
--paper-muted:   #6B655A   /* 4.9:1 on paper */
--ink:           #EDE6D6   /* text on dark */
--ink-secondary: #A8A196   /* 7.2:1 on bg */
--accent:        #D9B86A   /* Ask mode, focus rings, nothing else */
--radius-field:  22px
--radius-card:   16px
--space-unit:    8px
```

Type scale (px): 13 / 15 / 16 / 20 / 24 / 32. Nothing in between.

## 6. States that must exist

| State | Bubble | Capture bar | Stream |
|---|---|---|---|
| New account, 0 saves | "Save a few things and I'll tell you what I notice." | Default, focused | Empty, no placeholder illustration |
| 1–4 saves | Same as above, plus "N saved so far" under it | Default | Cards |
| Tentative signal | "I might be noticing…" + Yes / Not really | Default | Cards + Patterns header with the tentative item marked |
| Reading available | Full first entry, pager, Why? / Talk about this | Default | All sections |
| Ask mode | Unchanged | Accent border, thread above | Hidden behind thread |
| Save in flight | Unchanged | Field cleared, "Saved" toast | New card at top, optimistic |
| Save failed | Unchanged | Field restores content, inline error under the field | No card |
| Offline | Unchanged | Saves queue locally; toast says "Saved, will sync" | Card marked pending |

## 7. Responsive rules

- Mobile first. One column, 16px gutters, capture bar respects `env(safe-area-inset-bottom)`.
- Desktop: the same layout in a 640px centered column. Do not add a sidebar or move the capture bar to the top. Keyboard: `/` focuses the field, `Cmd/Ctrl+Enter` saves, `Esc` leaves Ask mode.
- The mascot scales from 120px (mobile) to 160px (desktop). The bubble width is min(560px, 100% − 32px).

## 8. Do not

- Do not add tabs, badges, counters, or notification dots anywhere.
- Do not introduce a second font family for UI.
- Do not ask the user anything at save time.
- Do not show percentages, scores, or confidence numbers to the user.
- Do not change the memory pipeline, API contracts, or data models in this task. If the UI needs a field that does not exist (for example `status: "emerging"` on a signal), stub it and list it in the PR description.
- Do not change the profile switcher, settings, or agent profile screens beyond the sizing in 3a.
- Do not "improve readability" by changing a token in one place. Change the token.

## 9. Acceptance criteria

1. From a cold load on a 390px-wide viewport, a user can save a pasted URL in **two interactions** (tap field, press Enter) with no other screen shown.
2. The home screen has exactly one primary control (the capture bar). An automated check: no more than one element with `data-primary="true"` is rendered.
3. Every text node passes the contrast and size rules in §2 (run an axe or Lighthouse accessibility audit; zero contrast failures).
4. Top of Mind is readable in full on the home screen without a tap.
5. The "Yes / Not really" path on a tentative signal records the answer and dismisses the card without leaving the screen.
6. Ask mode and Save mode are distinguishable with the screen desaturated (not by color alone).
7. The stream, patterns, and principles are reachable by scrolling only.
8. Before/after screenshots at 390px and 1280px are attached to the PR, plus a 10-second screen recording of a save.

## 10. Order of work

1. Tokens and type scale (§5, §2). Ship alone; it should change nothing visible yet.
2. Capture bar with Save mode only; remove the pill and tab bar; stream below. Ship.
3. Bubble states (§3b, §6) including Yes / Not really. Ship.
4. Ask mode. Ship.
5. Share target / extension / email-in (§4), in whichever order is cheapest.

If a step cannot be completed as specified, stop and describe the blocker in the PR instead of substituting a different design.
