# Component audit — every component we ship, and its counterpart in the reference library

Founder, 2026-10-11, with the reference library's component catalogue open (the library's name is redacted throughout this document and must not appear anywhere in this repository — see §8j):

> "it looks so much better. Can you audit every single component that we used in
> this product and find what the best component in [the reference library] would be to use, and
> rather than just using it straight, I want you to reference that code and
> obviously make it so that our look and feel is not gone."

This is the map. It is a plan to be executed by someone else, so every entry
names the file, the reference page, the exact part we are missing (quoted), the
change, and the refusal. **The refusals matter as much as the adoptions.**
The reference library is a general-purpose enterprise system with five status colours, four
elevations, three densities, numbered steppers, shimmer skeletons and a full
icon registry. This product has one typeface, no accent, no red, light as its
only meaning channel, and a founder who has deleted explainer text, helper
text, counts and labels repeatedly. Taking the reference's *anatomy vocabulary* and
*accessibility rules* is the win. Taking its visual system would undo a year of
rulings.

The reference library was read at **core package v0.6.8**. Its pages were
rendered with headless Chromium (they are client-rendered; `WebFetch` returns
an empty shell). 136 component pages were pulled; the ANATOMY tables and
BEST PRACTICES Do/Don't lists are the source for every quotation below.

---

## 0. The refusal register — read this before touching anything

These are not preferences. Each one is a recorded founder ruling, and a PR that
breaks one is a regression no matter which reference page suggested it.

| # | Law | What it refuses in the reference |
|---|---|---|
| R1 | **No accent colour. No red anywhere, including destructive actions and errors.** "colour temperature means aliveness and is not spent on warnings." `chrome.css` drains `--error` of hue with the note *"there is no red in Waka"*. | `Badge` variants (`success`/`warning`/`error`/`info`/blue/purple/pink/teal/orange), `Banner` status colours, `StatusDot`'s "five semantic variants", `ProgressBar`'s "color variant that matches the context: accent for general progress, success for completion, warning or error for alerts", `AlertDialog`'s "Destructive by default", `SelectableCard`'s "accent border", `ChatToolCalls`' "Green additions and red deletions counts". |
| R2 | **One typeface.** `--waka-face` (Jost 300) everywhere; hierarchy comes from size and weight, never a change of face. One hand-drawn glyph set in `HomeActionIcon.tsx` and nothing else. | `Icon`'s semantic registry and `registerIcons()`; every "Start icon" / "Status icon" / "Upload icon" / "Search glyph" that would need an imported set; `Text type="code"` and `Code`/`CodeBlock`'s monospace; `ChatToolCalls`' "tool name displayed in monospace". |
| R3 | **Light is the only meaning channel. Motion explains, never decorates.** `test/motion.test.ts`: motion "runs once on appearance (never loops)", lands in the 0.4–0.8s band, and stays home under `prefers-reduced-motion`. | `Spinner` ("An animated loading indicator"), `Skeleton` ("An animated shimmer placeholder"), `ProgressBar`'s indeterminate fill, `StatusDot`'s "optional pulse animation", `Thumbnail`'s "shimmer effect while uploading", `ChatDictationButton`'s "Animated equalizer bars… React to real microphone volume", `useStreamingText`'s character-by-character reveal, `useEntryAnimation`. |
| R4 | **"Only the most absolutely necessary things should be shown."** | Every reference anatomy part named *Description*, *Helper text*, *Hint*, *Character counter*, *Count readout*, *Value text*, *Status* that restates a visible fact. Named individually below each time it comes up. |
| R5 | **Already decided; not to be revisited.** The four dock destinations and their bar; the creature; the one-note-page rule (`test/one-note.test.tsx`); filled-for-you / ghost-for-WAKA bubbles; settings living only in the gear's panel. | `AppShell`+`SideNav`+`TopNav` as a shell; `TabList` as primary navigation; `BottomSheetSwitcher` as a replacement for the notepad; any second home for settings. |
| R6 | **Colour literals are capped by a downward-only ratchet.** `test/type-scale.test.ts`, `COLOUR_CEILING = 79` over `home.css`, `chrome.css`, `global.css`, `claims.css`, `chat.css`. | Any new hex/rgba at a call site. Every recommendation below must spend only existing custom properties: `--jar-live`, `--jar-live-edge`, `--jar-panel`, `--jar-panel-edge`, `--jar-sheet`, `--jar-sheet-edge`, `--jar-row`, `--jar-row-hover`, `--jar-ink`, `--jar-muted`, `--jar-faint`, `--jar-mark`, `--jar-atmos`, `--w-ink`, `--w-muted`, `--w-faint`, `--w-edge`, `--w-raised`, `--w-warm`, `--moon-*`, `--waka-scrim`, `--waka-raised`, `--waka-lift`, `--waka-r-control`, `--waka-r-surface`, `--waka-r-hand`, `--error` (hueless), `--sp-*`, `--t-*`, `--dur*`, `--ease*`. |

One more thing worth stating because it changes how this document should be
read: **this codebase already cites the reference library in nine source
comments and has already adopted several of its rules correctly** — those
comments name the library, which §8j says they must stop doing while keeping
every argument they make. `SavesOverlay`'s search field quotes
the `TextInput` anatomy and implements the clear-with-focus-return verbatim.
`ConversationPanel` quotes `ChatComposer`, `ChatMessageList`, `ChatMessageMetadata`
and `ChatDictationButton` and takes `elevation="none"` *against* the reference's default
with a reason. `Menu` quotes `Popover`'s no-nesting rule and declines the reference's
focus trap with an argument. `HowItWorksPanel` quotes `Collapsible`'s
"Don't use a collapsible for a single short paragraph". So the work left is the
*unvisited* surfaces and the *structural* gaps, not a first pass.

---

## 1. Chrome and navigation

### 1.1 `components/Menu.tsx` — the whole top of the screen

**OURS.** 498 lines. The three rungs (`nav.waka-rungs`), the one-press exit
chevron, the "i" and the cog, each hanging one `.waka-account` card. Dressed by
`claims.css` (`.waka-corner*`, `.waka-rungs`, `.waka-rung`, `.waka-switch*`,
`.waka-account*`, `.waka-menu-scrim`). 2 call sites: `pages/Home.tsx`,
`pages/Days.tsx`.

**THE REFERENCE.** `Popover` (the two cards), `IconButton` (the two triggers),
`TabList` / `SegmentedControl` (the rungs — see below), `useFocusTrap`
(declined, correctly), `useListFocus`.

**WHAT THEIR ANATOMY HAS THAT WE DO NOT.**
- `Popover` → **"Fallback close control — Keyboard-reachable close affordance appended by usePopover when enabled."** We have the scrim and Escape; there is no keyboard-reachable close *inside* the card.
- `IconButton` → **"Add a tooltip: even a gear icon can mean Settings, Preferences, or Configure."** and **"Don't: Skip the tooltip; label only reaches screen readers, sighted users need the hover hint."** Both corners carry `aria-label` and no `title`.
- `TabList` → **"Reach for `role="tablist"` when the strip switches panels in place… Leave it off for navigation between views."**

**WHAT TO TAKE.**
1. `aria-haspopup="dialog"` on both corner triggers alongside the existing `aria-expanded`. The file's own header reasons at length about focus return (and implements it) but never tells assistive tech that the button opens a surface at all.
2. A `title` on the cog and the "i", from the same `MessageKey` the `aria-label` uses. The reference's reason is exactly ours: a drawn gear is not self-naming. This costs no new copy and no new element.
3. Leave the rungs as plain `<button>`s in a `<nav>` with `aria-current="page"` — which is **already** what the reference prescribes. Record it here so nobody "upgrades" them to `role="tablist"`: the reference's `TabList` page says in as many words *"Leave it off for navigation between views"*, and the rungs navigate.

**WHAT TO REFUSE.**
- The focus trap. The file already argues this and the argument is exactly what the reference prescribes: a trap belongs to `Dialog`, "whose backdrop blocks page interaction"; these cards do not block the page.
- An explicit `×` in the card. The reference's `Popover`: "Provide a clear way to close: **either** by clicking outside **or** with an explicit close button." The full-screen scrim is the first. R4.
- Arrow-key movement between the card's groups. The file's argument stands: `DropdownMenu` is "a list of actionable items"; the settings card is a text field, a `<select>` and three disclosures.
- `TabList`'s overflow "more" menu for the rungs. Three rungs never overflow.

**EFFORT.** Trivial.

---

### 1.2 `components/ChatCorner.tsx` — one press, top-left

**OURS.** 60 lines. A single `<button class="waka-corner">` with a hand-drawn
speech bubble. `claims.css`. 1 call site: `pages/Days.tsx` (Home passes the
creature's two faces into `Menu`'s `left` slot instead).

**THE REFERENCE.** `IconButton`.

**WHAT THEIR ANATOMY HAS THAT WE DO NOT.** `IconButton` → **"Do: Add a tooltip: even a gear icon can mean Settings, Preferences, or Configure."** / **"Don't: Use IconButton if the action isn't obvious from the icon alone; use Button with text."**

**WHAT TO TAKE.** One `title` attribute carrying `worldOpenConversations`, the same string the `aria-label` already holds. A lone speech bubble in a corner is precisely the case the reference's don't-skip-the-tooltip rule exists for, and this is the only chrome control on `/days` whose meaning is carried by a glyph alone.

**WHAT TO REFUSE.** A visible text label. The corner is 44px and the dock below already says "Chats" in words on the world; a second word here is R4.

**EFFORT.** Trivial.

---

### 1.3 `components/HomeActionIcon.tsx` — the nine glyphs

**OURS.** 63 lines, nine shapes (`capture`, `chat`, `record`, `photo`, `play`,
`pause`, `keep`, `send`, `stop`), each `aria-hidden` with the name on the
button. The header already records that `send`/`stop` were drawn *because of*
the reference's `ChatSendButton` rule. 11 call sites across `NoteTools`,
`InspirationComposer`, `ConversationPanel`, `Home`.

**THE REFERENCE.** `Icon`.

**WHAT THEIR ANATOMY HAS THAT WE DO NOT.** Nothing we want. `Icon`'s anatomy is one part: **"Glyph — Required: Visual symbol rendered for the selected icon."**

**WHAT TO TAKE.** Two rules, as comments/tests rather than code:
- **"Don't: Mix icon styles (e.g. outline and filled) within the same context."** We currently mix: `record`/`photo` are outlined at stroke 1.7, `play`/`pause`/`stop` are solid fills, `keep` is a stroke at 2.1. The file argues each case individually (and the arguments are good — "at 20px a stroked triangle reads as a chevron"), but `record` (outline) and `play` (solid) now sit **in the same context**: the attachment tiles. Worth one look on screen, and either a reason recorded or `record` thickened/filled to match.
- **"Do: For a meaningful standalone icon (no adjacent text), give it an accessible name via the `label` prop."** We satisfy this by naming the *button*, which is better. Record it so nobody adds `role="img"` to the SVG and double-announces.

**WHAT TO REFUSE.** The icon registry, `registerIcons()`, theme-level icon overrides, and every semantic icon name. R2 — the hand-drawn set is the whole point, and the `chat` shape being unused is already documented rather than quietly deleted.

**EFFORT.** Trivial.

---

### 1.4 `components/HowItWorksPanel.tsx` — the loop, behind the "i"

**OURS.** 116 lines. `div.waka-about[role=group][aria-labelledby]` → `h2` → lead
→ `<dl class="waka-about-loop">` of four rungs → caveat. `claims.css`.
1 call site: `Menu`.

**THE REFERENCE.** `MetadataList` (the `<dl>`), `Collapsible` (declined, correctly),
`Section`.

**WHAT THEIR ANATOMY HAS THAT WE DO NOT.** `MetadataList` → **"Disclosure — Collapse/expand control for the list"** and **"Do: Choose label position based on content: 'start' for short values, 'top' for long or complex values."**

**WHAT TO TAKE.** The label-position rule, as a check rather than a change: our four `<dt>`/`<dd>` pairs have short labels and sentence-long values, which is the reference's `top` case. Verify `.waka-about-loop` stacks rather than aligning in two columns; if it is a two-column grid, the sentences are being measured against four short words and losing.

**WHAT TO REFUSE.**
- The disclosure. The file already quotes `Collapsible`'s "Don't use a collapsible for a single short paragraph; just show the text directly instead" and adds the better reason: the *relationship* between the four rungs is the content, and folding three of them hides it.
- `Stepper`. It is the obvious-looking fit for a four-stage loop and it is wrong twice: the reference renders it as **"a 4px segmented bar per step"** with **"A numbered badge"** indicators and status colours. "States render, numerals never" plus R1 and R3.

**EFFORT.** Trivial (verification only).

---

### 1.5 `components/SettingsPanel.tsx` — all of settings, in the card

**OURS.** 298 lines. `div.waka-settings[role=group]` holding: name field,
language `<select>`, agents list, public page block (handle + two checkboxes +
Keep), sign out, delete account. Three `.waka-settings-row` disclosures with
`aria-expanded` and a `+`/`–` text glyph. `claims.css`. 2 call sites: `Menu`.

**THE REFERENCE.** `Collapsible` + `CollapsibleGroup` + `useCollapsible`, `Field`,
`TextInput`, `Selector`, `CheckboxInput`, `AlertDialog`, `Switch`.

**WHAT THEIR ANATOMY HAS THAT WE DO NOT.**
- `Collapsible` → **"Container — Required: The root that contains one trigger and its controlled content"**, **"Chevron — Animated disclosure arrow… points inward when collapsed (mirrored under RTL), and turns down when expanded"**. Our trigger has `aria-expanded` but **no `aria-controls`**, so nothing connects the button to the region it opens.
- `CollapsibleGroup` → **"Do: Use CollapsibleGroup with `type="single"` for settings or FAQ pages where only one section should be open at a time."** Our three rows can all be open at once, in a card the file itself describes as bounded on a short screen.
- `Field` → **"Optional/Required indicator"**, **"Description"**, **"Label tooltip"**. (Refused — R4.)
- `CheckboxInput` → **"Don't: Use a checkbox for actions that take effect immediately; use a toggle switch or button instead."** Our two public-page checkboxes are paired with an explicit Keep, so we are *compliant* — record it.
- `AlertDialog` → **"Cancel button — Required: Ghost button that dismisses without acting. Takes initial focus, and Escape does the same thing."**

**WHAT TO TAKE.**
1. `aria-controls` on each `.waka-settings-row`, pointing at an `id` on the content it reveals. One attribute, three sites. This is the single cheapest real a11y gain in the file.
2. `CollapsibleGroup type="single"` behaviour: hoist the three rows' `showing` state into one `null | "agents" | "public" | "danger"` value, exactly the way `Menu` already holds `corner` as one slot with the reasoning written out ("two independent `open` flags would let both be true"). The same argument applies one level down.
3. The chevron direction rule: `+`/`–` is a text glyph in a product that draws its marks. Replace with a 10px chevron path (same geometry as `Menu`'s `waka-switch-trigger` chevron, rotated) so the disclosure wears the product's material. Rotation on open is motion that *explains* the state change — inside R3, and inside `motion.test.ts`' once-on-change envelope.
4. The delete-account confirmation: adopt `AlertDialog`'s **structure** (see §2.9) — title is the question, description is the consequence, Cancel takes initial focus, Escape cancels, the destructive control is not beside its own yes.

**WHAT TO REFUSE.**
- `Switch` for the public-page toggles. The reference: "Use for settings that apply immediately; the toggle should take effect without a separate save action." These do not — they are staged behind Keep. Checkbox is correct.
- Field descriptions, required indicators, label tooltips, character counters. R4; the founder pruned eleven sections to six on this exact surface.
- Wrapping each `Collapsible` in a `Card` ("Do: Wrap each Collapsible in an Card for visual separation in accordion layouts"). The card is `.waka-account` and there is one of it; nesting is the reference's own "Don't nest cards inside other cards".
- `Section`/`FormLayout`. R5 — settings live in this card and nowhere else.

**EFFORT.** Moderate.

---

## 2. Dialogs, sheets and the four destinations

### 2.1 `components/DialogSurface.tsx` — the shared modal primitive  ⚠️ **highest-value finding in the audit**

**OURS.** 100 lines. `role="dialog"`, `aria-modal`, a hand-rolled
`focusableWithin` walk, Tab wrapping in both directions, Escape → `onClose`,
focus-first on mount, focus-return-to-opener on unmount, and a
`visualViewport` keyboard-inset shim for iOS. **15 call sites across 11 files**
— the most-used component in the product. `chrome.css` / `claims.css` dress its
consumers.

**THE REFERENCE.** `Dialog` + `DialogHeader`, `useFocusTrap`, `useScrollLock`,
`AlertDialog`, `BottomSheet`, and — critically — `AppShell`.

**WHAT THEIR ANATOMY HAS THAT WE DO NOT.**
- `Dialog` → **"Header — Required: Title, optional subtitle, and close button. The title receives focus on open and labels the dialog via `aria-labelledby`."** Every one of our fifteen call sites passes `aria-label` instead, and **four of them render a visible `<h2>` saying the same words** (`SavesOverlay`, `PrinciplesOverlay`, `ClaimsOverlay`, `ConversationsOverlay`). `HowItWorksPanel` already made exactly this fix one level up, with the reason in its header: *"a second copy of the same words in an attribute is a [duplication]"*.
- `Dialog` → **"Backdrop — Required: Semi-transparent overlay behind the dialog that blocks page interaction."** Four of our call sites have **no backdrop at all** and deliberately do not block the page.
- `Dialog` → **"Choose the right purpose: `info` for dismissable content, `form` to prevent accidental backdrop dismissal, `required` when the user must respond."** We have one behaviour for all fifteen.
- `useScrollLock` → **"Locks body scroll when active by pinning the body with `position: fixed`. This prevents background scrolling behind modals and dialogs, which is necessary for iOS Safari where `overscroll-behavior: contain` does not work."** We use `overscroll-behavior: contain` in eleven places and lock the body in zero. This is a mobile-first product.
- `useFocusTrap` → **"Mouse clicks outside the container are not intercepted; use a light-dismiss handler for that."**

**WHAT TO TAKE.**

**(a) Split the primitive in two, because fifteen call sites are two different
things wearing one component.** Nine are genuine sheets over a surface you are
still in: `InspirationComposer`, `InspirationSearch`, `PrincipleShare`,
`ReadingChanges`, `SpaceSettings`, `GroupPanel`, and Home's own sheets. Four are
**pages**: the dock destinations. `claims.css` states it outright —
`.waka-page` is `z-index: 56`, the dock is `z-60`, and the comment reads *"the
dock is the only chrome that outranks a room, because the dock is how you leave
one"*, quoting the founder: *"this should be its own page, so bottom navigation
always visible."*

So on those four, `role="dialog"` + `aria-modal` + a Tab trap says three false
things at once: that nothing outside exists, that the page behind is blocked,
and that the exit is inside. **A keyboard user standing in the inspirations
archive cannot Tab to the dock** — `focusableWithin(event.currentTarget)` wraps
to the first element in the sheet — and the dock is the documented way out.
That is Law 2 ("every surface you can enter has a visible way out, and it costs
one press") failing on the four most-visited surfaces in the product, which
`test/way-out.test.ty`/`way-out.test.ts` cannot see because the control exists
and is visible; it is only unreachable.

The fix is the reference's own split: `Dialog` for sheets, `AppShell`'s main-content
landmark for destinations. Concretely — add `modal?: boolean` (default `true`)
to `DialogSurface`; when false it renders `<section role="region" tabIndex={-1}>`
with no `aria-modal`, keeps Escape and focus-first and focus-return, and does
**not** trap Tab. Pass `modal={false}` from the four dock destinations.

**(b) `aria-labelledby` wherever a visible title already exists.** Add an
optional `titleId` (or let callers pass `aria-labelledby` through — they
already spread `...props`). Convert the four destinations plus `PrincipleShare`
and `ReadingChanges`, both of which render `<header><h2>…</h2></header>` beside
a duplicate `aria-label`. Delete the duplicated `aria-label` at each.

**(c) `useScrollLock`'s mechanism, for the nine real sheets only.** Pin
`document.body` with `position: fixed`, restore scroll position on release, and
take the reference's second half too — **"Pinning hides the document scrollbar, so
where that scrollbar takes layout space (desktop) the hook holds its gutter
open with `scrollbar-gutter: stable` for the duration of the lock. The page,
including any `position: fixed` chrome, does not shift sideways."** Without
that clause the dock jumps 15px left every time a sheet opens on desktop.
`chat.css` already uses `scrollbar-gutter: stable both-edges`, so the idiom is
in the codebase.

**(d) `purpose="form"` behaviour on the writing sheets.** the reference: *"Use
`purpose="form"` for dialogs with inputs so the user can't accidentally lose
data by clicking the backdrop."* `InspirationComposer` and `PrincipleShare` hold
unsaved words. They should not close on a scrim press. (`InspirationComposer`'s
draft store makes this survivable today, but the ruling is cheap and right.)

**WHAT TO REFUSE.**
- `Dialog`'s `fullscreen` variant and `DialogHeader`'s subtitle/`startContent`/`endContent` slots. R4.
- `BottomSheet`'s **"Handle — Required: Decorative grab affordance and drag region"**. Nothing in this product is dragged; a handle is a control promising a gesture that does not exist (Law 1 — the `cursor: grab` failure `PublicProfile`'s header records by name).
- `Dialog`'s `purpose="required"` ("Cannot be dismissed by Escape or backdrop click"). Every surface here has a way out. Law 2.
- `useFocusTrap` as a dependency; our `focusableWithin` already handles closed `<details>`, `[inert]`, computed `display:none` and disabled ancestors, which the reference's selector-based walk does not document.

**EFFORT.** (a) and (b) moderate. (c) moderate. (d) trivial.

---

### 2.2 `components/SavesOverlay.tsx` — the inspirations archive

**OURS.** 995 lines, the largest component. `DialogSurface.waka-over` holding:
header (`h2` + count + back-to-all), the `newHere` line, the search field
(`.waka-over-find`), the category row, the chapter-grouped list
(`.waka-list-*`), and — at depth — a whole note page via `NotePage` + `NoteTools`.
`claims.css`. 1 call site: `pages/Home.tsx`.

**THE REFERENCE.** `TextInput` (already adopted), `SegmentedControl`, `List` +
`ListItem` + `Item`, `EmptyState`, `useAnnounce`, `useListFocus`,
`useContainerReveal`, `Pagination`, `PowerSearch` (already correctly declined).

**WHAT THEIR ANATOMY HAS THAT WE DO NOT.**
- `TabList` vs `SegmentedControl` → **"Don't: Confuse TabList with SegmentedControl or ToggleButton. TabList is for navigation between views. SegmentedControl and ToggleButton are input controls: SegmentedControl always has exactly one selected option."** Our category row is `role="tablist"` with `role="tab"` children, `aria-selected`, no `aria-controls`, no panel, no roving tabindex and no arrow keys. It is a `SegmentedControl` — one of N, filtering a list in place — announcing itself as a tab strip whose panels do not exist.
- `SegmentedControl` → **"Control — Required: Container for the mutually exclusive segment choices"**, **"Do: Provide a descriptive label for the control."** (We have the label; the roles are wrong.)
- `useListFocus` → **"Enable `hasRovingTabIndex` (and `hasCaretGuard` when the widget can contain text inputs) for toolbar-style composites that should be a single tab stop."** Our category row is N tab stops; with many categories, Tab from the search field walks every one before reaching the list.
- `useAnnounce` → **"Use it for state that is only conveyed visually; search result counts, 'no results'… (WCAG 4.1.3 Status Messages)"** and **"Announce the outcome, not the interaction; '12 results' rather than 'search ran'."** Typing in our search field silently rewrites the list and the `(3/36)` in the title. A screen-reader user gets nothing.
- `Item` → **"Marker — Optional list bullet/counter rendered before start content"**, **"End content — End-aligned content: badges, timestamps, or action buttons"**, **"Do: Set `labelLines` and `descriptionLines` to control truncation when content length varies."**
- `Item` → **"Do: Give a swipe action a second home in the row (a menu or a button in `endContent`): the swipe is a touch accelerator, and a verb reachable only by swipe is unreachable by keyboard and by mouse."**
- `EmptyState` → **"Title — Required: Primary message explaining what is empty: 'No projects yet' not 'No data'"**, **"Actions — One or two buttons guiding the user to a next step"**, **"Don't: Leave an empty state without guidance; always explain what happened and what the user can do next."** Our empty archive is one `<p class="waka-over-status">`.
- `List` → **"Don't: Place interactive elements inside an interactive list item; it creates nested click targets and confusing focus behavior."**

**WHAT TO TAKE.**
1. **Re-role the category row.** Drop `role="tablist"`/`role="tab"`/`aria-selected`; use a `role="group"` with the existing `aria-label` and `aria-pressed` on each `<button>`. Then add roving tabindex + ArrowLeft/ArrowRight + Home/End, one tab stop for the row. This is `useListFocus({orientation:'horizontal', hasRovingTabIndex:true})` reimplemented in ~25 lines. The reference's own distinction is the argument; the a11y gain is a strip that behaves like every native segmented control.
2. **Announce the filtered outcome.** One shared `announce(message)` helper writing into a persistent, empty-on-mount `aria-live="polite"` region — the reference's exact mechanism and its exact reason: *"The polite and assertive regions are created empty on first use and stay mounted, which is what makes announcements reliable: most screen readers ignore a live region that is inserted together with its content."* Debounce it to the same beat the filter settles on. The string is the count the title already prints visibly, so no new copy and no Law 4 problem — the reference library: *"Don't: Announce content that is already visible and correctly labeled in the DOM"* does not bite, because the title is not the field's accessible description.
3. **Give the empty archive a next step.** Today it says what is absent and offers nothing. Law 2's cousin: the dock's `+` is the move, and the empty state should *be* that button, not a sentence about one. One control, zero description — which is the reference's `EmptyState` with the Icon and Description parts refused.
4. `useContainerReveal`'s rule for the row's verbs, if any are ever added: **"Set a `hoverDelay` (100-250ms) on rows in a long list, so a cursor travelling across the list does not light up every row it passes; keyboard and touch still reveal immediately."** And the harder half: **"revealed content is visually hidden at rest with position and opacity (never `display:none`), so it stays mounted, keeps its place in the tab order, and is announced to assistive technology; it reveals on `:focus-within`."**

**WHAT TO REFUSE.**
- `PowerSearch`. The file already declined it correctly, quoting the reference's own "Use PowerSearch for simple keyword searches" Don't.
- `TextInput`'s *Description*, *Spinner* and *Status icon*. Already declined in the file, with reasons that are better than the reference's own (a search query cannot be invalid; filtering runs in memory so a spinner would be inventing latency).
- `Pagination`'s **"Count readout"**, **"Page-size selector"**, **"Page number button"**, **"Ellipsis"**. The archive is chapter-grouped and scrolls; "states render, numerals never".
- `Item`'s *Marker*, *Badge* end-content, and `density` presets. R1/R4.
- `EmptyState`'s **"Icon — A visual cue above the title"** and **"Description"**. R2 and R4.
- `Skeleton` for the loading archive. R3. The existing `role="status"` sentence is the honest answer.

**EFFORT.** (1) and (2) moderate; (3) trivial; (4) only when the need arises.

---

### 2.3 `components/PrinciplesOverlay.tsx` — cards you would hold up

**OURS.** 224 lines. `DialogSurface.waka-over` → `header > h2` → `newHere` line
→ `ul.waka-held` of `.waka-held-card`, each one statement + proof line
("Held since August, drawn from 14 things you kept") + an open control and a
share control. `claims.css`. 1 call site: `pages/Home.tsx`.

**THE REFERENCE.** `Card` + `ClickableCard`, `MetadataList`, `Blockquote`, `EmptyState`,
`List`.

**WHAT THEIR ANATOMY HAS THAT WE DO NOT.**
- `Card` → **"Do: Ask 'could I reorder or remove this independently?' If yes, it's a card. If no, it's just a section of the page."** / **"Don't: Create identical card grids (icon + heading + text, repeated). Vary the layout or question whether cards are needed at all."** A principle *is* a discrete item, so the card is right — record the test so it does not get "simplified" to a list.
- `ClickableCard` → **"Container — Required: Interactive div with hover/focus/active states"**, **"Do: Nest buttons or links freely inside; they handle their own events."** Our card is **not** clickable; the statement sits inside a `.waka-held-open` button and share is a sibling. So the card's whole area is dead except two targets.
- `List` → **"Don't: Place interactive elements inside an interactive list item."** (Which is why `ClickableCard` is the *right* reference answer here and `List` is not.)
- `Blockquote` → **"Do: Pass the source through `cite` rather than typing it into children, so it renders as a semantic `<cite>` element that assistive technology can distinguish from the quotation."** / **"Don't: Wrap the attribution in your own `<footer>`. A `<footer>` inside a `<blockquote>` becomes a contentinfo document landmark, and a page with several quotes then reports several page footers."**
- `EmptyState` → Title + Actions, as above. Ours is one sentence.

**WHAT TO TAKE.**
1. **Make the whole card the open target** (`ClickableCard`), with share nested inside it as its own button. The reference's reason is the one that matters here: a card whose only live region is the sentence makes a 300px-tall object with a 40px target, and the founder's whole argument for this surface is that *the artifact is already on screen*. Pressing the artifact should open it. Keep share as a nested `<button>` — the reference explicitly supports it ("Nested interactive elements work independently"), and the implementation is one `stopPropagation`.
2. **The statement is a quotation; mark it as one.** `<blockquote>` with the attribution in `cite` rather than a styled `<span class="waka-held-who">` inside the foot. This buys the proof line real semantics — it is "the part a stranger cannot fake", per the file's header, and it currently reads to a screen reader as loose text after a sentence.
3. Give the empty principles surface the one next step the founder's own model implies (keep saving) rather than a dead sentence.

**WHAT TO REFUSE.**
- `Card`'s colour variants outright: **"Don't: Use color variants for status; use Banner or Badge for that. Color cards are for categorization."** R1 — no categorization channel exists here.
- `SelectableCard`'s "accent border on selection". R1.
- `MetadataList` for the proof line. It is one sentence, not key/value pairs, and the file's ruling stands: "every number beside a sentence is something to read instead of the sentence."
- Any confidence score, citation list, kind or state on the card. Standing founder ruling, quoted in the file: "a principle shouldn't be overly explained."
- `Carousel` for the cards. The reference: **"Don't: Use a carousel for content every user must see. Not everyone scrolls horizontally."**

**EFFORT.** Moderate.

---

### 2.4 `components/ClaimsOverlay.tsx` — the claim queue's doorway

**OURS.** 220 lines. `DialogSurface.waka-over` → `header > h2` → `newHere` →
`ul.waka-claims` of `.waka-claim`, each a statement button plus
`ul.waka-claim-from` of save previews. Pressing one hands it to the creature;
this room never answers one. `claims.css`. 1 call site: `pages/Home.tsx`.

**THE REFERENCE.** `ClickableCard`, `Item`, `Citation`, `List`, `EmptyState`.

**WHAT THEIR ANATOMY HAS THAT WE DO NOT.**
- `Citation` → **"Container — Required: The root wrapper. Accepted source URLs render an anchor; missing or rejected URLs render an inert span."**, **"Do: Use the label variant when the source title adds meaningful context for the reader."** Our evidence previews are plain `<li>` text with no indication that they are *sources* for the sentence above them.
- `Item` → **"Description — Secondary supporting text below the label"**, **"Do: Set `labelLines` and `descriptionLines` to control truncation when content length varies."**
- `ClickableCard` → as §2.3: the whole claim should be the target, not just its statement.

**WHAT TO TAKE.**
1. The whole claim row as the press target (`ClickableCard` semantics, one element with the handler), so the evidence under the sentence is part of what you press rather than dead text beside it. The file's own argument demands this: "with the saves visible it can be **checked**", and evidence you cannot press is evidence outside the act.
2. `Citation`'s *relationship* markup, not its variants: wrap the evidence list in a container whose accessible name says it is the material under the claim (`aria-label` from an existing `MessageKey`), so a screen reader gets "claim, then its three sources" rather than "sentence, list, three items".
3. `Item`'s `labelLines` idea as a CSS line clamp on long previews, with `SavesOverlay`'s established rule: *"Nothing is truncated into a lie. A long keep clips with a fade rather than an ellipsis mid-word."* Same treatment, same token.

**WHAT TO REFUSE.**
- `Citation`'s **"Number — The citation index displayed as a superscript badge"**. "States render, numerals never."
- `Badge` of any kind on a claim (unanswered/new/pending). R1 and R4; the reference's own rule agrees — **"Don't: Repeat the same badge in every row of a table or list."**
- Rendering an answerable claim here. The file's cross-product research (GitHub, Anki, Linear) is the law: *"a queue has exactly ONE surface where an item is answerable."* No reference component changes that.

**EFFORT.** Moderate.

---

### 2.5 `components/ConversationsOverlay.tsx` — your chats

**OURS.** 302 lines. `DialogSurface.waka-over` → `header > h2` →
`nav.waka-list` grouped by day → `.waka-list-row` buttons (deliberately the
same row as `SavesOverlay`) plus a two-step delete per row
(`.waka-rail-ask` / `.waka-rail-go`). `claims.css`. 1 call site: `pages/Home.tsx`.

**THE REFERENCE.** `List` + `ListItem`, `Item`, `ChatSystemMessage` (divider variant),
`MoreMenu`, `AlertDialog`, `useContainerReveal`, `EmptyState`.

**WHAT THEIR ANATOMY HAS THAT WE DO NOT.**
- `ChatSystemMessage` → **"Divider — A labelled horizontal Divider rendered by the divider variant"** and **"Do: Use the divider variant for temporal or section boundaries."** Our day groups are `<h3 class="waka-list-when">` with no rule, which is fine — but note the reference's framing: a date break is a *labelled separator*, and ours is currently a heading inside a `<nav>`, which means a landmark-navigating user hears "navigation" then a run of headings with no list structure between them.
- `Item` → **"Don't: Don't nest interactive elements (buttons, links) inside an interactive Item; it creates confusing focus and click targets."** Our row *is* a button and the delete control is a sibling inside the same `<li>` — compliant by a hair; worth a comment so it stays that way.
- `useContainerReveal` → **"Use for secondary affordances: reveal-on-hover row actions (edit/copy/remove on list or table rows)"**, with the accessibility clause quoted in §2.2.
- `MoreMenu` → **"Trigger button — Required: Icon-only Button that provides the visible overflow-menu entry point"**, **"Do: Use for overflow or secondary actions; keep primary actions visible outside the menu."**
- `AlertDialog` → the full confirm anatomy.

**WHAT TO TAKE.**
1. The `<nav>` should hold a `<ul>` per chapter — it already does (`ul.waka-list-rows`) — but the chapter `<h3>`s sit *between* lists inside a `nav`. Add `aria-labelledby` from each `ul` to its `h3` so the groups are self-naming. One attribute per chapter; makes the day grouping real rather than visual. The reference's `List`: **"Do: Provide a header to label the list and give context to screen readers."**
2. `useContainerReveal`'s rules for the delete control, *if* it is hover-gated today: it must stay mounted (opacity/position, never `display:none`), reveal on `:focus-within`, and stay visible on coarse pointers. Verify; fix if not.
3. Keep delete here rather than inside a conversation — `ConversationPanel`'s header already reasoned this and the reference's `MoreMenu` rule agrees from the other side.

**WHAT TO REFUSE.**
- Swipe-to-delete. The reference's `Item` rule allows it only with "a second home in the row", and we would be adding a touch-only gesture to a product with no other swipe. R4.
- `MoreMenu` itself, for now: one verb per row does not need a three-dot menu, and the reference says so — "keep primary actions visible outside the menu."
- `ChatSystemMessage`'s divider *rendering* (a rule through the label). R4 — the date word is enough; a rule either side of it is furniture.

**EFFORT.** Trivial.

---

### 2.6 `components/InspirationSearch.tsx` — find a save by words

**OURS.** 74 lines. `DialogSurface.jar-seek.jar-inspiration-search` →
a `<p>` label + Close button → bare `<input class="jar-roomform-box">` →
status lines → `ul.jar-search-results` → "More results". `home.css`/`chrome.css`.
1 call site: `pages/Home.tsx`.

**THE REFERENCE.** `CommandPalette`, `Typeahead`, `TextInput`, `Pagination`,
`useAnnounce`, `useHotkeys`, `Kbd`.

**WHAT THEIR ANATOMY HAS THAT WE DO NOT.**
- `CommandPalette` → **"Search glyph — Required: Search symbol rendered by Icon in the default Input."** Required, and absent here. `SavesOverlay` already drew this glyph in pure CSS (`.waka-over-find-glyph`, "a circle and a stem drawn in CSS out of the ink already on this surface") — so the material exists and this surface does not use it.
- `CommandPalette` → **"List — Required: Scrollable listbox containing the current results or Empty state"**, **"Item — Selectable command result rendered inside the List"**, **"Empty — Message shown when the current result set is empty"**.
- `Typeahead` → **"Clear button — Shared clear action that removes the selected item when `hasClear` is enabled"**, **"Result row — Stable option wrapper that owns highlight, selection, pointer, and keyboard behavior"**, **"Selected result state — Selected styling and trailing check presented on the current result row."** Our results are plain buttons in an `<li>`: no arrow-key traversal, no highlighted row, no Enter-to-open-the-highlighted-one.
- `TextInput` → the clear-button rule `SavesOverlay` already quotes and implements: **"a trailing × button that resets the value and returns focus to the input."**

**WHAT TO TAKE.** This is the clearest "we already solved this one screen over"
case in the product.
1. Make this field `SavesOverlay`'s field: the painted `.waka-over-find` surface, the CSS glyph, the clear-with-focus-return. One class swap plus the clear button; Law 3 ("a change to the system lands on every surface") makes it mandatory rather than nice.
2. Arrow-key traversal of the results with a highlighted row and Enter to open — `useListFocus({orientation:'vertical'})`, with focus staying in the input and `aria-activedescendant` naming the highlighted row. `Home.tsx`'s own `.jar-reach` already implements exactly this pattern over the field's orbs (`role="listbox"` + `aria-activedescendant` + a roving cursor), so the idiom is in-house and proven.
3. Announce the outcome: *"12 results"* / *"nothing says that"* through the shared polite region.

**WHAT TO REFUSE.**
- `CommandPalette`'s **"Footer — Footer region for default keyboard guidance"** and **"Keyboard shortcut — Painted key badges rendered by Kbd"**. That footer is "↑↓ Navigate / ↵ Select / Esc Close" — three labels restating three behaviours. R4, and `Kbd` would want a mono face (R2).
- `CommandPalette`'s **"Loading spinner"**. R3.
- `useHotkeys` to bind `mod+k`. This surface is reached from the archive and the world, not from a global shortcut, and a hidden keyboard-only door is the reference's own "Don't: Use Kbd as the only way to discover an action".
- `Typeahead`'s *Selected token*, *Result group heading* and *Field* shell. R4.

**EFFORT.** Moderate.

---

### 2.7 `components/ReadingChanges.tsx` — what changed in your reading

**OURS.** 77 lines. A trigger button, then a portalled backdrop + `DialogSurface`
with `<header><h2>…</h2><button>Close</button></header>` and a before/after
comparison. `chrome.css` (`.jar-reading-comparison`, `.jar-drift-*`).
1 call site: `pages/Home.tsx`.

**THE REFERENCE.** `Dialog` + `DialogHeader`, `Overlay`, `Blockquote`, `Timestamp`.

**WHAT THEIR ANATOMY HAS THAT WE DO NOT.**
- `Dialog` → `aria-labelledby` from the `<h2>` (we pass a duplicate `aria-label`).
- `Overlay` → **"Don't: Do not use Overlay for floating content anchored outside the surface. Use Popover, Tooltip, or Dialog for those patterns."** (We use `Dialog` — correct.)
- `Timestamp` → **"Do: Use the `auto` format in feeds and lists so recent items show '2 hours ago' and older items show the full date automatically"**, **"Do: Keep formatting consistent within the same list or table."**

**WHAT TO TAKE.**
1. `aria-labelledby` (part of the §2.1(b) sweep).
2. The before/after readings are quotations of the model's own earlier words. `<blockquote>` with the version/date in `cite` makes the comparison legible to a screen reader as two quotations rather than two paragraphs. Same change as §2.3(2), same reason.
3. `Timestamp`'s consistency rule as an audit item: this product formats dates in at least four places (`dateWords`, `momentStamp`, `timeOf`, `toLocaleTimeString` inline in `AttachmentPreview` and `AttachmentTranscript`). The reference ships one component because mixing relative and absolute in one view "confuses scanning". Consolidating onto the existing `lib` helpers is a small, high-leverage tidy.

**WHAT TO REFUSE.**
- `Timestamp`'s **"Hover card"**, **"Hover card row"**, **"Copy button — Required: Per-row copy-to-clipboard button"** and `isTimezoneShown`. R4 — this is an enterprise audit-log feature.
- `Timestamp`'s `isLive` ticking. R3.

**EFFORT.** Trivial.

---

### 2.8 `components/PrincipleShare.tsx` — the export sheet  ⚠️ **the ugliest surface left**

**OURS.** 199 lines and the densest form in the product. Inside one
`DialogSurface`: **ten `<select>` elements** (choose principle ×2, type,
drafts, earlier statement, add principle, size, style), **two nested
`<details>`** (`jar-share-word-editor`, `jar-share-customize`), a `<textarea>`
per entry with per-entry "use original" and "remove" buttons, history retry,
a `window.confirm` for discard, and `navigator.share` / download. `chrome.css`
(`.jar-share-*`, `.jar-review-*`). 1 call site: `pages/Home.tsx`.

**THE REFERENCE.** `Field` + `FieldStatus`, `Selector` / `ComplexSelector`,
`SegmentedControl`, `Collapsible` + `CollapsibleGroup`, `FormLayout`,
`AlertDialog`, `Toolbar`, `TextArea`, `Thumbnail`/`Lightbox` (the preview).

**WHAT THEIR ANATOMY HAS THAT WE DO NOT.**
- `Field` → **"Label — Required: Text identifying the field. Always rendered for accessibility, optionally hidden visually"**, **"Control slot — Required: A custom, native, or third-party control that does not already render a field shell"**, **"Status message"**. Our labels are bare text nodes inside `<label>` with no structure, so nothing distinguishes a field's name from a field's status from a field's help.
- `Field` → **"Don't: Set both `isOptional` and `isRequired` on the same field."** / **"Don't: Nest Field around styled inputs."**
- `SegmentedControl` → **"Do: Use for switching between 2–5 mutually exclusive views or modes where all options should be visible."** Three of our `<select>`s have exactly two or three options (`square|portrait`, `dark|light`, `card|change`) — a dropdown to pick one of two is a press to reveal a choice that could have been on screen.
- `Collapsible` → **"Don't: Nest collapsibles more than two levels deep"**; **"Don't: Hide critical or required content behind a collapsible; users may not discover it"**; **"Do: Start sections open (`defaultIsOpen`) when the content is likely needed on first view."** The words editor — the one thing a person came here to change — is behind a `<details>`.
- `CollapsibleGroup` → `type="single"`.
- `AlertDialog` → the whole thing; we use `window.confirm`.
- `Toolbar` → **"Do: Put secondary actions like 'Back' on the left, and primary actions like 'Save' on the right."**

**WHAT TO TAKE.**
1. **Collapse ten selects to the three decisions that exist.** the reference's `Field`/`SegmentedControl` split makes the shape obvious: *which principle(s)*, *what it says*, *how it looks*. Size and style are 2-of-2 choices → two segmented pairs (which this product already draws: `.jar-ask--row`'s `aria-pressed` pairs on Home, and `jar-char-form`'s two faces). Type (`card`/`change`) is another. That removes three `<select>`s and three presses, and puts the choices on screen where the founder's rule wants them.
2. **Open the words editor by default.** It is the content of the sheet. The reference's `defaultIsOpen` rule and its "don't hide critical content" Don't both say so, and the founder's version is sharper: a surface whose purpose is behind a disclosure is a surface that looks empty.
3. **One disclosure, not two nested ones**, holding only the genuinely rare controls (draft picker, earlier-statement comparison). `CollapsibleGroup type="single"`.
4. **Replace `window.confirm`** with the product's own confirmation on `AlertDialog`'s anatomy (§2.9). `window.confirm` is the one piece of chrome in this product that is not this product: system font, system blue, system geometry, Law 5 ("the product is one material, and every surface wears it") broken in the most literal way available.
5. `aria-labelledby` from the existing `<h2>` (§2.1(b)).
6. `Toolbar`'s placement rule for the footer: Close/Cancel left, Share/Download right. Check the current order.

**WHAT TO REFUSE.**
- `FieldStatus`'s error/warning/success *colours* and icons. R1/R2. Hueless `--error` and plain words only.
- `Field`'s **"Optional/Required indicator"** badge and **"Label tooltip"** info icon. R4/R2.
- `TextArea`'s **"Character counter"**. R4 — we already carry `maxLength={2000}` and the founder has removed counts repeatedly.
- `FormLayout` and `Grid`. This is a sheet in a product with no form system; adding one is R5-adjacent scope.
- `ComplexSelector` / `MultiSelector` / `Tokenizer` for the up-to-three principle picker. Three items is the reference's own "Use for short, static option lists; use Selector for better discoverability" case, and `Tokenizer` is "for building sets of two or more items" with chips, a search input and a dropdown — a search box for three rows.
- `Lightbox` for the generated image. The reference: **"Required: Full-viewport dialog overlay"** plus prev/next/counter — a gallery for one artifact, and "Nest dialogs inside other dialogs" is its own Don't.

**EFFORT.** Real work. This is the one entry that is a redesign rather than a
refit, and it is worth it: it is the product's shareable artifact's only door.

---

### 2.9 `space/settings/SpaceSettings.tsx` — the space, and everything you can do to it

**OURS.** 473 lines. `DialogSurface role="dialog" aria-label` with a `.jar-settings-x`
close; per-kind bodies; **four two-step destructive confirmations**
(leave / rename / remove member / close group) plus key revoke, each one a
`<button>` then an inline `<button>Yes</button> · <button>Cancel</button>`
pair, armed by a single `useState` so a destructive word is never beside its
own yes. `home.css`/`chrome.css`. 1 call site: `pages/Home.tsx`.

**THE REFERENCE.** `AlertDialog` + `useImperativeAlertDialog`, `Dialog`, `List`,
`Avatar`, `useClipboard`, `Field`.

**WHAT THEIR ANATOMY HAS THAT WE DO NOT.** This is the richest single anatomy
in the audit, and we are missing most of it:
- `AlertDialog` → **"Title — Required: The question being asked. Renders as a level-2 heading and labels the dialog via `aria-labelledby`."**
- **"Description — Required: What will happen if the user confirms. Linked to the dialog via `aria-describedby`."**
- **"Cancel button — Required: Ghost button that dismisses without acting. Takes initial focus, and Escape does the same thing."**
- **"Action button — Required: The confirming action."**
- **"Backdrop — Required: Overlay behind the dialog that blocks page interaction. Clicking it does not dismiss."**
- It implements **"the WAI-ARIA APG Alert Dialog pattern: `role="alertdialog"`, a title linked by `aria-labelledby`, a consequence description linked by `aria-describedby`, focus moved into the dialog on open and returned to the trigger on close, and no dismissal by clicking outside. Escape cancels."**
- **"at 640px and below, the destructive action appears above Cancel and both buttons fill the footer width"**, and **"Do: Keep the cancel button as the least-destructive focus target. On narrow screens the destructive action is visually and structurally above Cancel, but Cancel still receives initial focus."**
- **"Don't: Close the dialog from `onAction` before the work finishes; hold it open with `isActionLoading` and call `onOpenChange(false)` when the action settles."**
- `useClipboard` → **"Pass a localized announce message so the copy is spoken by screen readers; swapping the button `aria-label` alone is not reliably announced."**

**WHAT TO TAKE.**
1. **One confirmation primitive, built on `AlertDialog`'s anatomy, for the whole product.** There are currently **seven** destructive confirmations in three different shapes: four inline two-step pairs here, one more for key revoke, and two `window.confirm`s (`PrincipleShare`, `AuthoredSaveNotice`). The inline pattern's reasoning in this file's header is good — "a destructive word is never beside its own yes" — and `AlertDialog` gives it three things the inline pair cannot: a **description of the consequence**, linked by `aria-describedby`; **initial focus on Cancel**; and **no outside-press dismissal**, so a stray tap cannot resolve the question either way. Keep our two-step *arming* as the trigger and let the armed state render a real `role="alertdialog"`.
2. **`isActionLoading` rather than closing optimistically.** the reference's Don't is a bug report about half of these handlers: the panel dismisses the confirmation and then the request fails, so the failure arrives on a surface with no question on it. `.jar-settings-warn[role=status]` exists for this and is doing the job from the wrong side.
3. **Cancel takes initial focus** in every one. Today focus stays on the destructive trigger, which has just been replaced by a Yes in roughly the same place.
4. **`aria-labelledby`** on the panel itself, from a real heading — the panel currently has `aria-label` and (per the grep) no `<h1>`/`<h2>` at all, so there is no visible name for the surface.
5. **`useClipboard`'s contract for `copyInvite`.** There are three hand-rolled clipboard writes in the product (`Home.tsx:12952` invite with a 2600ms timer, `Home.tsx:13524` inspiration link via `setCharSay`, both silent on rejection) with three different confirmation mechanisms and zero announcements. The reference's hook is one function: `copy(text) → Promise<boolean>`, an `isCopied` window that "resets itself", a polite announcement, and a documented rejection path ("A clipboard rejection is a silent no-op… resolves false"). Write one `lib/use-clipboard.ts` with that exact contract and the 2000ms default; `copyInvite`'s hand-rolled timer and `setCharSay` both go.

**WHAT TO REFUSE.**
- `AlertDialog`'s **"Destructive by default"** colour. R1 — hueless `--error` and the label itself. The reference's own rule covers us: **"Don't: Rely on color alone to signal danger; the action label itself should say what will happen."**
- `Avatar`'s **"Status dot — Each variant pairs colour with a distinct shape"** on the member roll. R1/R3.
- `AvatarGroup` overflow counters. "States render, numerals never."
- `Dialog`'s `fullscreen`. R4.
- The key/grant tables a reference `Table` would invite. `SettingsPanel`'s header already records that these were deliberately removed as "a developer surface on a consumer product".

**EFFORT.** Real work for (1) — but it pays out across seven call sites.
(2)–(5) moderate.

---

## 3. Chat

### 3.1 `components/ConversationPanel.tsx` — a transcript, a box, and one way to stop

**OURS.** 495 lines, already the most reference-informed file in the tree. It
quotes `ChatComposer`'s five named parts, `ChatMessageList`'s
`role="log" aria-live="polite"`, `ChatMessageMetadata`'s
last-bubble-of-a-run rule, `ChatDictationButton`'s placement rule and
`ChatSendButton`'s send/stop toggle, and takes `elevation="none"` against
the reference's default with a stated reason. `chat.css`. 1 call site: `pages/Home.tsx`.

**THE REFERENCE.** `ChatLayout`, `ChatLayoutScrollButton`, `ChatMessageList`,
`ChatMessage`, `ChatMessageBubble`, `ChatMessageMetadata`, `ChatSystemMessage`,
`ChatComposer`, `ChatComposerInput`, `ChatComposerDrawer`, `ChatSendButton`,
`ChatDictationButton`, `ChatToolCalls`, `Pagination`, `useStreamingText`.

**WHAT THEIR ANATOMY HAS THAT WE DO NOT.**
- `ChatLayout` → **"Scroll-to-bottom button — Appears when the user scrolls up or new messages arrive. Defaults to ChatLayoutScrollButton; pass `null` to hide."** And `ChatLayoutScrollButton` → **"It fades in as a compact icon button and expands to show a label when new messages arrive."** We have none. In a long transcript, scrolling up to read and then wanting to return to the live end requires a manual scroll to the bottom.
- `ChatLayout` → **"Empty state — Centered placeholder shown when no messages exist."** We have one, and it is the creature — better than the reference's and recorded as such.
- `ChatLayout` → **"Frosted glass dock — Required: Sticky or fixed container at the bottom with a backdrop-blur layer. Houses the scroll button and composer."**
- `ChatComposer` → **"Drawer — Content before the body for attachments or other expandable context, typically ChatComposerDrawer."** Nothing can be attached to a chat message today.
- `ChatComposerDrawer` → **"Disclosure toggle — The keyboard- and pointer-operable collapse control rendered when `count` is provided"**, **"Content area — Required: … collapsed descendants are unavailable to keyboard and assistive technology."**
- `ChatSystemMessage` → **"Do: Use the divider variant for temporal or section boundaries and the default variant for factual status notices"**; **"System message — Required: The noninteractive status row… The component exposes status semantics."** Our `chat-thinking` line is a `<span role="status">` next to three animated `<i/>`s.
- `Pagination` → **"Previous/next buttons — Required."** Our "Load earlier messages" is the honest minimum and should stay.
- `ChatComposerInput` → **"Do: Use `onFiles` for files pasted or dropped onto the editor, and keep file validation and upload progress in the product layer."**
- `useListFocus` → **`hasCaretGuard`: "arrow keys are not stolen from a nested text input/textarea whose caret is not at the boundary… Preserves inline text editing within the list."**

**WHAT TO TAKE.**
1. **A return-to-latest control.** This is the one genuinely missing *function* in the panel. The reference's framing is the one that makes it pass the founder's bar: it is not decoration, it is the way back from a reading position to the live end — Law 2 applied inside a scroller. Take the behaviour (appears only when scrolled away from the bottom; one press) and refuse the "expands to show a label when new messages arrive" half, which is a notification. Draw it with the existing `send` arrow rotated, or a plain chevron, in `--waka-r-control` on `--jar-panel`.
2. **Kill the animated thinking dots.** `chat.css:685` runs `animation: chat-thinking-pulse 1.2s ease-in-out infinite` beside a `role="status"` span that already says "WAKA is thinking". That is (a) decorative motion, which R3 forbids; (b) an infinite loop, which `test/motion.test.ts` forbids in as many words — *"runs once on appearance (never loops)"* — and which that gate cannot see because **it only reads `home.css`**; and (c) Law 4, a second channel saying what the sentence says. The reference's `ChatSystemMessage` is the correct shape: a noninteractive status row whose "visible message must carry the same information". Delete the dots; keep the sentence. Then widen `motion.test.ts` to read `chat.css` and `claims.css` too — the gate's own header says a ratchet that only watches the past only watches the past.
3. **`aria-busy` on the transcript while a reply is in flight**, so the `role="log"` region tells assistive tech that more is coming rather than only announcing it on arrival.
4. **`hasCaretGuard`'s rule**, recorded: when the scroll-to-latest control and the composer coexist, no arrow-key handler may be added at the panel level that could steal ArrowUp/ArrowDown from the textarea's caret.
5. **`onFiles` on paste**, if attachments ever reach a chat: `InspirationComposer` already implements `onPaste` with `clipboardData.files`, so the idiom exists.

**WHAT TO REFUSE.**
- `ChatDictationButton`'s **"Frequency bars — Animated equalizer bars that replace the icon during listening. React to real microphone volume."** R3, named explicitly. Our `aria-pressed` + `.chat-dictate--on` light is the whole state, in the one channel this product has.
- `useChatDictation`'s `hasSounds`. A second sensory channel nobody asked for.
- `useStreamingText`. R3 — a character-by-character reveal is motion that decorates arrival, and our replies do not stream.
- `ChatToolCalls` entirely: **"Status icon — Required: A themed semantic success/error icon, or a spinner"** (R1/R3), **"Tool name displayed in monospace"** (R2), **"Node badge"**, **"Diff stats — Green additions and red deletions"** (R1), **"Duration"**, **"Group header — A wrench icon with a call count"** (R2, numerals). And more fundamentally: `ConversationPanel`'s header already deleted `ConversationMemory` on the grounds that it was "the model's context window with a label on it". Tool calls are the same object.
- `ChatMessageMetadata`'s **"Status — Localized delivery icon and text"** (Read / Delivered / Failed). R2 and R4; our one `role="status"` line on the pending draft is the only delivery fact that matters.
- `ChatComposer`'s default `elevation="low"`. Already refused with a recorded reason ("this product has exactly one floating object per screen and it is the dock").
- `ChatLayout`'s **"frosted glass"** blur as a new material. The dock already owns the bottom; a second blurred bar above it is the "double layer is so weird" the founder reported.
- `Markdown`. The reference's own Don't settles it: **"Use Markdown for hand-authored layouts; use Text and Heading directly when you control the content."** `ConversationText` is 18 lines, renders prose/lists/bold/inline-code, and — the load-bearing part — never executes model HTML, URLs or scripts. The reference's `Markdown` has an image renderer, a table renderer, a plugin system and a raw-HTML policy. Enormous surface for a safe-formatting problem already solved.

**EFFORT.** (1) moderate; (2) trivial and overdue; (3)–(5) trivial.

---

### 3.2 `components/ConversationText.tsx` — the safe formatting surface

**OURS.** 18 lines. Splits on `**bold**` and `` `code` ``, builds `<p>`/`<ul>`/`<ol>`,
never executes model output. `chat.css` (`.chat-message-text`). 3 call sites,
all in `ConversationPanel`.

**THE REFERENCE.** `Markdown`, `Text`, `Code`.

**WHAT THEIR ANATOMY HAS THAT WE DO NOT.** `Markdown` → *Document, Heading,
Paragraph, List, Code block, Blockquote, Table, Divider, Image*.

**WHAT TO TAKE.** Nothing structural. One rule worth copying into the file as a
comment, because it is the strongest argument for keeping this file small:
The reference's `Markdown` **"never executes raw HTML"** and routes images through a
**"block image or unsafe-URL fallback"**. Our file's one-line claim ("model
HTML, URLs and scripts are never executed") is the same promise; writing down
that the reference library makes the same promise is what stops someone
"upgrading" to a markdown library that does not.

**WHAT TO REFUSE.** All of `Markdown`. See §3.1. Also `Code`/`CodeBlock`
(R2 — mono face), and `Text`'s `type="code"`.

**EFFORT.** Trivial.

---

## 4. The notepad, capture, and attachments

### 4.1 `components/InspirationComposer.tsx` — the notepad

**OURS.** 348 lines. `DialogSurface.jar-seek.jar-inspiration-composer` rendering
`NotePage`'s chrome around a `<textarea class="jar-mouth-field">`, plus the
attachment shelf (`ul.jar-shelf` of `li.jar-tile`: a face button, a `↻` retry,
a `×` remove, a clock, an inline `<audio>`), a link row, a recording-choice
section, and error lines. `chrome.css` (`.jar-tile*`, `.jar-shelf`,
`.jar-composer-*`). 1 call site: `pages/Home.tsx`.

**THE REFERENCE.** `Thumbnail`, `FileInput`, `ChatComposerDrawer`, `TextArea`,
`Token`, `Item`, `Lightbox`, `useContainerReveal`.

**WHAT THEIR ANATOMY HAS THAT WE DO NOT.**
- `Thumbnail` → **"Remove button — An overlaid close button in the top-right corner. Appears when `onRemove` is set. Sits on a fixed `--color-overlay` scrim with an `--color-on-dark` icon to stay visible on any image."** Ours is a `×` **text character** at 28px with no scrim, so over a light photo it can vanish. The retry is a `↻` text character in the opposite corner.
- `Thumbnail` → **"Do: Always provide a `label` prop with the file name so the thumbnail and its remove button are accessible to screen readers and show a tooltip on hover."** We set `aria-label` on the face and the remove; no `title`.
- `Thumbnail` → **"Don't: Don't omit alt text when a `src` is provided; screen readers need a description of the image content, not just the file name from `label`."**
- `FileInput` → **"Drop zone — Required: The clickable area for file selection. In dropzone mode, also accepts dragged files"**, **"Do: Always specify an `accept` prop"** (we do, generously), **"Do: Use `maxSize` and `maxFiles`"**, **"Don't: Don't avoid dropzone mode unless space is constrained; drag-and-drop is the expected interaction for file uploads."** We support paste but there is no drop target.
- `TextArea` → **"Input container — Required: Painted boundary containing the text area and its overlays."**

**WHAT TO TAKE.**
1. **Draw the two tile corner controls instead of typing them.** `×` and `↻` are the last two typographic glyphs standing in for marks in this product; everything else in the dock and the chrome is a drawn path. Add `remove` and `retry` to `HomeActionIcon` and give each a scrim from `--waka-scrim` behind it, which is the reference's exact reason: the control must survive any image under it. Costs no new colour literal.
2. **`title` on both corner controls**, from the `MessageKey`s already passed in as `removeLabel` / `retryLabel`. The reference's rule and `IconButton`'s both apply.
3. **Real `alt` on the photo tile preview.** It currently gets the file name; the reference is explicit that a name is not a description. The honest minimum is `alt=""` (decorative, since the tile's button is already named) rather than a filename masquerading as a description — that is a one-word fix and strictly more correct.
4. **Drop-to-attach on the note body.** the reference's Don't is right and the cost is low: the same `props.onFiles` the paste handler and the `<input type=file>` already call, plus a `--jar-live-edge` hairline on the words' container while a file is over it. This is motion-free, label-free, and it is the gesture everyone tries first on a blank note.

**WHAT TO REFUSE.**
- `Thumbnail`'s **"Skeleton — A shimmer animation shown when `isLoading` is true and no `src` is set"** and **"Upload overlay — A semi-transparent overlay with a spinner"**. R3. `.jar-tile--busy` already carries the state in light.
- `FileInput`'s **"Label"**, **"Description"** ("Helper text… explaining accepted formats or size limits"), **"Placeholder"**, **"File name display"**, **"Spinner"**, **"Status message"**. R4 and the founder's own ruling on this surface, quoted in the header: of the five controls that used to sit under the field, *"remove all."*
- `FileInput`'s visible drop zone box. The note body **is** the drop zone; a dashed rectangle on a blank page is the furniture this screen exists not to have.
- `TextArea`'s **"Character counter"** and status icons. R4/R1.
- `Lightbox` for the photo tile. One image, no gallery, and `Dialog`-in-`Dialog`.
- `ChatComposerDrawer`'s **"Collapsed summary — The default count Badge and label"**. R1, and numerals.

**EFFORT.** (1)–(3) trivial; (4) moderate.

---

### 4.2 `components/NotePage.tsx` and `components/NoteTools.tsx` — one note, whichever note

**OURS.** `NotePage` (111 lines) owns the chrome: the chevron back, the moment
(`.jar-note-when`), one trailing verb slot, the words column. `NoteTools`
(110 lines) portals the record/photo pair into the dock's `#waka-note-tools`
slot. `claims.css` / `chrome.css`. `NotePage`: 2 call sites
(`SavesOverlay`, `InspirationComposer`). `NoteTools`: 1 (`SavesOverlay`).
Held to one geometry by `test/one-note.test.tsx`.

**THE REFERENCE.** `Toolbar`, `Layout` + `LayoutHeader`, `Timestamp`, `MoreMenu`.

**WHAT THEIR ANATOMY HAS THAT WE DO NOT.**
- `Toolbar` → **"Do: Put secondary actions like 'Back' on the left, and primary actions like 'Save' on the right."** (We do, exactly.) **"Don't: Put too many actions in one toolbar; move less common items into a MoreMenu."** (One slot, by design.) **"Don't: Set `size` on individual child buttons; set it once on the toolbar and it cascades automatically."**
- `Toolbar` → **"Do: Use Toolbar as a card header when the header has interactive actions… If the header is just a title with no actions, a LayoutHeader or Section is enough."**
- `Timestamp` → **"Do: Keep formatting consistent within the same list or table."**

**WHAT TO TAKE.** The size-cascade rule, as the thing it protects against: the
note's top row and the dock's middle slot are *one bar in two places*, and they
each set their own control size (`.jar-note-*` in `chrome.css`,
`.waka-dock-tool` at `--waka-corner`). `one-note.test.tsx` holds the two note
tops to one geometry; nothing holds the note's trailing verb to the dock tool's
size. Add that assertion. It is the exact class of drift `NoteTools`' own header
describes ("two copies of one layout always eventually produce" a duplicate).

**WHAT TO REFUSE.**
- `Layout`/`LayoutHeader`/`Section` as a shell. R5 — the one-note-page rule and the portal arrangement are settled, and `NoteTools`' header explains why props would be worse than a portal.
- `MoreMenu` in the trailing slot. The file's ruling is explicit: "The trailing slot is for a verb about the note, not a second way out… It is deliberately one slot."
- `Toolbar`'s **"Make temporary toolbars like bulk selection visually distinct… for example with a background color"**. R1.

**EFFORT.** Trivial.

---

### 4.3 `components/InspirationAttachments.tsx`, `AttachmentPreview.tsx`, `AttachmentTranscript.tsx`

**OURS.** `InspirationAttachments` (29 lines) fans out to the other two.
`AttachmentPreview` (67 lines) polls analysis status and renders a link
thumbnail, title, site name, description, a `<details>` of page text, retry
and check buttons. `AttachmentTranscript` (91 lines) polls transcription,
renders the transcript, an edit `<textarea>` with conflict reconciliation, and
a `<details>` of the original. `InspirationAttachments` renders a bare
**`<audio controls>`** for audio and a bare `<img>` for photos.
`chrome.css` (`.jar-attachment-*`, `.jar-link-*`, `.jar-transcript-*`,
`.jar-saved-attachment*`). Call sites: 1 / 2 / 1.

**THE REFERENCE.** `Thumbnail`, `Item`, `Card`, `Collapsible`, `Citation`,
`FieldStatus`, `TextArea`, `Timestamp`, `EmptyState`.

**WHAT THEIR ANATOMY HAS THAT WE DO NOT.**
- `Citation` → **"Container — Required: Accepted source URLs render an anchor; missing or rejected URLs render an inert span"**, **"Icon — Accepts a favicon/logo image URL (via `source.src`)"**, **"Label text — The source title, truncated with ellipsis when it exceeds the max width."** Our link preview is an `<h3><a>` plus site name plus description, which is three lines where the reference gives one.
- `Collapsible` → **"Don't: Use a collapsible for a single short paragraph; just show the text directly instead."**
- `Thumbnail` → the remove-button scrim rule and the alt-text rule (as §4.1).
- `TextArea` → **"Input container — Required: Painted boundary"**, **"Field status message — Attached or detached error, warning, or success message associated with the field."**
- `Timestamp` → consistency. Both files call `toLocaleTimeString` inline with their own options.

**WHAT TO TAKE.**
1. **The founder has already ruled on the audio player and the ruling only landed on one of two surfaces.** `HomeActionIcon`'s header records it: *"of the browser's own audio player standing on a blank note: 'I think it's a little ugly how files are added today.' A `<audio controls>` is a white pill with a play triangle, a scrubber and a volume icon — the brightest object on the page, and three controls for a thing that needs one. The tile IS the control now."* `InspirationComposer` got the tile. `InspirationAttachments` — the opened-saved-note path — **still renders `<audio controls>`**. That is Law 3 ("a change to the system lands on every surface, not the one being looked at") with the founder's own words attached. Give the saved note the same tile: the `play`/`pause` glyphs already exist, `.jar-tile-*` already exists.
2. **The link preview is three lines of prose where the reference gives one row.** the reference's `Citation` label variant — favicon, title, truncated — is exactly what a saved link needs, and our `link.description` paragraph is the reference's own "Description" part by another name. R4 says drop the description; `Citation`'s shape says the title and host are one object, not a heading plus a sub-line.
3. **Drop the `<details>` around the page text and the original transcript**, or keep them only when the content is long. The reference's rule is the one `HowItWorksPanel` already quotes, and a one-paragraph page excerpt behind a `<summary>` is exactly its case.
4. **Consolidate the four date formatters.** `AttachmentPreview` and `AttachmentTranscript` each hand-roll `toLocaleTimeString([], {hour:'numeric', minute:'2-digit'})`; `lib` already has `dateWords`, `momentStamp` and `timeOf`. One helper, the reference's consistency rule as the reason.
5. **`FieldStatus`'s attached/detached split**, as a rule rather than a component: the transcript editor's conflict message currently renders as a sibling `<div>` with no association to the `<textarea>`. `aria-describedby` from the textarea to the conflict block. The reference: *"Use attached status below bordered inputs when the message belongs to that input."*

**WHAT TO REFUSE.**
- `FieldStatus`'s colours and **"Detached icon — Leading status glyph"**. R1/R2.
- `Citation`'s number variant. Numerals.
- `Thumbnail`'s skeleton/spinner overlays. R3.
- `EmptyState` for "no readable preview". The existing sentence plus the retry button is already Title + Action with no Icon and no Description — which is the refined version.
- `Spinner` on the 3-second poll. R3; `role="status"` text already says it.

**EFFORT.** (1) moderate — it is a real port, and it is the highest-value single
item in this section. (2) moderate. (3)–(5) trivial.

---

### 4.4 `components/InspirationProcessingNotice.tsx` and `components/AuthoredSaveNotice.tsx`

**OURS.** `InspirationProcessingNotice` (38 lines): a
`div.jar-source-status[role=status]` with a mark SVG, a line, an optional hint,
and one of four trailing controls (View / dismiss `×` / a `<details>` holding
Check / retry). `AuthoredSaveNotice` (21 lines): the same `.jar-source-status`
shell with a phase message and one of Start-again (behind `window.confirm`) /
Edit draft / Retry / dismiss `×`. `chrome.css`. Call sites: 2 and 2.

**THE REFERENCE.** `Banner`, `Toast` + `useToast`, `ChatSystemMessage`.

**WHAT THEIR ANATOMY HAS THAT WE DO NOT.**
- `Banner` → **"Title — Required: The main message. Always required"**, **"Action button"**, **"Dismiss button — Lets the user close the banner. Enabled by setting `isDismissable`"**, **"Content surface — Secondary surface for extra detail… Sits behind an expand/collapse toggle by default."**
- `Banner` → **"Do: Error and warning banners render as `role="alert"`; info and success render as `role="status"`. Mount an alert banner in response to an event rather than on first paint, so assistive tech has a change to report."** Our notices are `role="status"` even in the failed phase; `AuthoredSaveNotice` has `storage_error`, `unsupported` and `rejected` phases all announced politely.
- `Banner` → **"Don't: Rely on the status color or icon alone to carry meaning; say which status it is in the title text, because the icon is decorative to a screen reader."** (We comply — the sentence carries it.)
- `Toast` → **"Dismiss button — Required"**, **"Do: Use `uniqueID` to deduplicate toasts that fire from repeated actions."**
- `useToast` → **"Don't: Use for critical errors that require acknowledgment; use AlertDialog instead."**

**WHAT TO TAKE.**
1. **Promote the failure phases to `role="alert"`.** the reference's split is the right one and ours is uniform: a save whose storage failed is not polite status. One conditional on the role, two files. (`Banner`'s second clause — mount the alert on the event rather than on first paint — is already how these work, since the phase changes.)
2. **Draw the dismiss `×`.** Same as §4.1(1): the last text-character controls in the product. Both files use `×`.
3. **Replace `AuthoredSaveNotice`'s `window.confirm`** with the shared confirmation from §2.9(1). It is the second of two.
4. `Toast`'s `uniqueID` deduplication rule, as a check: `InspirationProcessingNotice` renders twice in `Home.tsx` — confirm the two instances cannot both be announcing the same phase change into the same live region.

**WHAT TO REFUSE.**
- `Banner`'s **"Icon — Required: Automatically set based on the status (info, warning, error, success)"** and its four status colours. R1/R2.
- `Banner`'s **"Content surface"** / collapsible detail. R4; `InspirationProcessingNotice`'s `<details>` already holds the one rare control and nothing else should join it.
- `useToast`'s viewport, stacking, swipe-dismiss and auto-hide. These notices are anchored to the thing they are about and dismissed by the person; a floating stack of self-disappearing cards is a different product's furniture. The founder's own ruling supersedes anyway: *"states should show and disappear in the bottom bar only"* — which is what `.waka-dock-state` is.
- `Toast`'s **"End content — A trailing action like an Undo button"** as a new pattern. The one trailing control these already have is the right number.

**EFFORT.** Trivial, except (3) which depends on §2.9.

---

## 5. Reading surfaces

### 5.1 `components/PrincipleRead.tsx` + `PrincipleEvidence.tsx` + `ReviewEvidence.tsx`

**OURS.** `PrincipleRead` (162 lines): `ul.jar-principles-list[role=list]` of
`.jar-principle-group`, each a statement, optional sub-lines
("Marked as disputed", "Support changed"), and a `<details>` of evidence.
Plus a group-empty block carrying a **`role="progressbar"` with
`aria-valuenow={groupSignalCount}` and a printed `.jar-principles-empty-count`**.
`PrincipleEvidence` (44 lines) and `ReviewEvidence` (34 lines) render
`.jar-principle-reference` and `<blockquote class="jar-review-evidence">`.
`home.css`. Call sites: 1 / 2 / 2.

**THE REFERENCE.** `ProgressBar`, `Blockquote`, `Collapsible`, `Citation`, `List`,
`MetadataList`, `Badge`.

**WHAT THEIR ANATOMY HAS THAT WE DO NOT.**
- `ProgressBar` → **"Label — Required: Text naming the operation, optionally hidden visually"** (we have `aria-label` — compliant), **"Value text — Formatted determinate value shown beside the label when requested"**, **"Mark — Labeled target tick positioned on a determinate track"**, **"Don't: Place icons or labels inside the bar; compose them alongside it using layout components."**
- `Blockquote` → **"Rule — Required: The border on the inline-start edge"**, **"Attribution — The source, passed as `cite`"**, **"Do: Pass the source through `cite` rather than typing it into children"**, **"Don't: Wrap the attribution in your own `<footer>`."**
- `Collapsible` → the single-short-paragraph Don't.

**WHAT TO TAKE.**
1. **`Blockquote`'s `cite` rule for both evidence components.** `ReviewEvidence` already uses `<blockquote>`; the saved words it quotes have a source (which inspiration, when) and it is currently rendered as sibling text. `<cite>` is the element, and the reference's footer warning is worth obeying pre-emptively — several quotes each wrapping attribution in a `<footer>` would report several page footers.
2. **`ProgressBar`'s "no labels inside the bar" rule**, and then the harder question it raises: `.jar-principles-empty-count` prints a count *beside* a progressbar that already encodes it, in a product whose law is "states render, numerals never". The `role="progressbar"` + `aria-valuenow` is the right way to say "you are two of three saves from a reading" to a screen reader; the printed numeral is the thing the law forbids. Delete the printed count, keep the ARIA.
3. `Collapsible`'s rule on the `<details>` of evidence: if the evidence is one short quote, show it. If it is several, the disclosure is right.

**WHAT TO REFUSE.**
- `ProgressBar`'s **"Fill — Required: Painted segment showing completed progress or indeterminate movement"** as *animation*, its colour variants, and its **"Mark"**. R1/R3.
- `Badge` for `contested` / `unsupported` / `supportChanged`. R1, plus the reference's own **"Don't: Repeat the same badge in every row"** and **"Don't: Use badges for metadata."** Our sub-sentences are the correct form.
- `MetadataList` for the sub-lines. They are sentences, not key/value pairs.

**EFFORT.** Trivial.

---

### 5.2 `pages/PublicProfile.tsx` — somebody's top of mind, read by somebody else

**OURS.** 224 lines. `main.waka-public` → `header` with `h1` → `ol.waka-public-reading`
of `.waka-public-said` with a single ink ramp (brightest at top) → a corner
control that is "Open WAKA" for a stranger and "back to your world" for a
signed-in reader. `claims.css`. The header records a full craft pass that
removed five pastel post-its, random tilts, `filter: saturate()` and
`cursor: grab`.

**THE REFERENCE.** `Blockquote`, `List`, `Link`, `EmptyState`, `Avatar`, `Section`.

**WHAT THEIR ANATOMY HAS THAT WE DO NOT.**
- `Link` → **"Do: Set `isStandalone` when the link appears outside of inline text, so it receives proper base font sizing"**, **"Do: Only set `label` when the link content is not descriptive text… adding `label` overrides it for screen readers, which is harmful"**, **"Don't: Set `label` on text links; `aria-label` prevents assistive technology from reading the actual link content."**
- `Blockquote` → `cite` for attribution; the `<footer>` warning.
- `EmptyState` → Title + Actions. Our `publicProfileEmpty` is a bare sentence on a page a stranger may have arrived at from a link, with no next step.
- `List` → **"Do: Provide a header to label the list."**

**WHAT TO TAKE.**
1. **The empty public page should offer the one thing it can**: the corner's "Open WAKA" already exists but on an empty page it is the only move and it is up in a corner rather than where the answer should be. The reference's rule — "always explain what happened and what the user can do next" — with the Description part refused.
2. **`Link`'s harmful-`aria-label` rule as a sweep.** Grep found several controls carrying `aria-label` over descriptive visible text. Each one *overrides* what a screen reader would otherwise read. Audit every `aria-label` in the tree against the rule: keep it on icon-only controls (`waka-corner`, `waka-dock-tool`, `chat-send`, `jar-tile-x`), remove it wherever the visible text already says the same thing.
3. The still-open question this file's header records — the owner reaching their own public page from the settings card and landing with "Open WAKA" as their exit — is Law 2 and the fix belongs on the link. The reference's `Link`: **"Don't: Use Link for actions that do not navigate; use a Button instead."** The settings card's public URL should be a button that opens it in a new tab, not an in-app link that unmounts the card.

**WHAT TO REFUSE.**
- `Avatar` on the public page. R1 (status dots), R2 (default-icon silhouette), and the page's own argument: nothing here belongs to the reader.
- `Section`/`Card` wrappers. The reference's own rule: "Don't wrap page sections in cards."
- `Blockquote`'s inline-start **"Rule"** border as a new material, if it would add a colour. `--w-edge` / `--moon-edge` only.

**EFFORT.** Trivial, except (2) which is a sweep.

---

### 5.3 `pages/Days.tsx` — a dot per date  ⚠️ **worst accessibility surface in the product**

**OURS.** 203 lines. `main.waka-page` → `Menu` → `ol.waka-days` of
`li > button.waka-day`, each a **14×14px circle** with a `--waka-day-glow`
custom property and an `sr-only` sentence, laid out
`grid-template-rows: repeat(7, 1fr); grid-auto-flow: column; gap: var(--sp-6)`.
`claims.css`.

**THE REFERENCE.** `Calendar`, `useGridFocus`, `List`.

**WHAT THEIR ANATOMY HAS THAT WE DO NOT.** Three of the four named parts, and
`Calendar` marks two of them Required:
- **"Month header — Required: The month name and year with navigation arrows to move between months. The arrows mirror automatically under `dir="rtl"`."**
- **"Day grid — Required: A 7-column grid of days with column headers for the day names."** We have a 7-**row** grid (transposed, so a column is a week) and **no headers at all** — nothing says which row is Monday.
- **"Today marker — A subtle indicator on the current date for orientation."** Absent.
- `useGridFocus` → 2D arrow navigation, the hook the reference names for exactly this: **"Don't: Use for 2D grid navigation; prefer `useGridFocus` for grids and calendars."** (from `useListFocus`).

And two measured failures that the reference does not state but this codebase already
knows the standard for — `chrome.css` on `.jar-tile-x` reads: *"28 clears WCAG
2.5.8's 24x24 floor, which is the number that actually applies to a control
inside a small item."*
- **`.waka-day` is 14×14.** Below the 24×24 floor the codebase already cites.
- **The gap is `--sp-6` (6px), so the pitch is 20px.** 2.5.8's spacing exception requires a 24px circle centred on the target not to intersect another target's circle. 20px pitch fails that too. So the dots fail the floor *and* the exception.
- **~119 buttons = ~119 tab stops** on a page whose only other controls are the three rungs and two corners. Tabbing off this page is a seventeen-week journey.

**WHAT TO TAKE.** All four, in this order:
1. **One tab stop + 2D arrow navigation.** `useGridFocus`'s model: the grid is one tab stop, ArrowUp/Down move within a week, ArrowLeft/Right move between weeks, Home/End to the ends, `aria-activedescendant` naming the focused day. `Home.tsx`'s `.jar-reach` is this exact pattern (`role="listbox"`, roving cursor, `aria-activedescendant`) and already works, so this is porting an in-house solution, not inventing one.
2. **Weekday row headers.** Seven `jar-label`-tier abbreviations down the left edge. This is not R4 — it is not restating a visible fact, it is the only thing that makes the grid a calendar rather than a texture. The reference marks it Required for the same reason.
3. **A today marker.** A `--jar-live-edge` hairline ring on today's dot, no fill change, so brightness stays the only meaning channel and the ring is identity rather than quantity. The reference's word is "subtle".
4. **Raise the target to 24×24 with the dot drawn at 14.** The button is 24×24 with `place-items: center` and a 14px `::before` circle carrying the glow. Nothing on screen changes; the press target doubles and 2.5.8 passes with the spacing it already has. Then raise `--sp-6` to `--sp-8` so the 24px circles do not intersect.

**WHAT TO REFUSE.**
- `Calendar`'s month navigation arrows and `min`/`max` window. This is a continuous ribbon of your own history, scrolled, not a month picker — and `grid-auto-flow: column` with `overflow-x: auto` is the right shape for that. Take the *header* idea (a month name floating over its columns) only if it can be done without a control; refuse the arrows.
- `Calendar`'s **"Selected day — The currently selected date, highlighted"** and range mode. Nothing is selected here; pressing navigates to `/?at=`.
- `dateConstraints` / disabled days. A silent day is still drawn at the floor, by ruling.
- Hue for busy days. The file's header is the law: *"IT IS BRIGHTNESS, NOT HUE… A calendar that went green at four keeps and amber at one would be inventing a second channel."*
- A printed count or tooltip per day. The file already removed the `title` for exactly this reason and recorded it.

**EFFORT.** Real work — but it is the single highest ratio of a11y gain to risk
in the audit, because the page has no other behaviour to break.

---

## 6. Entry, system and the companion

### 6.1 `pages/Login.tsx` + `components/GoogleSignIn.tsx`

**OURS.** `Login` (833 lines): `main.login-shell` → `section.login-card` → `h1`
→ a two-tab toggle with `role="tab"` + `aria-selected` + `aria-controls` and a
`role="tabpanel"` → two `<form>`s (`.field`, `.field-label`, `.field-input`,
`.form-error[role=alert]`) → `GoogleSignIn`. `GoogleSignIn` (175 lines): one
`.btn-google` with an inline SVG and a `role="alert"` error. `chrome.css` /
`system.css` (`.login-*`, `.field-*`, `.btn-*`).

**THE REFERENCE.** `TabList`, `Field` + `TextInput`, `FieldStatus`, `Banner`, `Button`,
`AlertDialog`, `useAnnounce`.

**WHAT THEIR ANATOMY HAS THAT WE DO NOT.**
- `TabList` → **"Do: Reach for `role="tablist"` when the strip switches panels in place, and give each tab a `panelId` pointing at the panel it opens: that link is how a screen reader gets from a tab to its content."** `/login` is the **one** place in the product where `role="tab"` is correct, and it is wired correctly (`aria-controls` → `#login-tabpanel`). Record that, because §2.2 removes the roles elsewhere and the two must not be confused.
- `TabList` → roving tabindex and `useKeyboardHint`: **"Keep the group a single Tab stop. Arrow keys move between members along the orientation, Home/End jump to the ends… This is the WAI-ARIA APG roving tabindex technique."** Our two tabs are two tab stops with no arrow keys. For a `role="tablist"`, ARIA requires the roving pattern.
- `TextInput` → **"Clear button"**, **"Status icon"**, **"Spinner"** (all refusals), and **"Do: Always provide a visible label"** (we do).
- `Button` → **"Spinner — Replaces the icon during loading"**, **"Do: Show a loading state for actions that take time."** Our submit swaps its label (`submitting`), which is the reference's intent without the spinner. Good.
- `Button` → **"Don't: Place more than one primary button in the same view."** `/login` has `.btn-primary` (submit) and `.btn-google` side by side; worth one look at whether both read as primary.
- `useAnnounce` → **"reserve 'assertive' for errors and time-sensitive alerts."** `.form-error` is `role="alert"`, which is already assertive. Compliant.

**WHAT TO TAKE.**
1. **Roving tabindex + ArrowLeft/ArrowRight on the login tab pair.** Two tabs, ~15 lines, and it is the one `role="tablist"` in the product so it should be the correct one.
2. **One primary.** If `.btn-google` and `.btn-primary` carry the same visual weight, demote one. The reference's reason — "this dilutes the visual hierarchy" — and the founder's: the first screen anybody sees.
3. The password-floor asymmetry comment the header protects: no change, but if the forms are ever split, that comment travels. Record it here too.

**WHAT TO REFUSE.**
- `Field`'s description/required-indicator/tooltip parts. R4.
- `FieldStatus` colours. R1 — the hueless `--error` and the sentence.
- `Banner` for the `?error=` strip. Same as §4.4: no status colour, no required icon.
- `GoogleSignIn`'s button being restyled at all. The colour ratchet note records that its `#fff` / `#1f1f1f` / `rgba(0,0,0,.12)` surface was already replaced with "Google's own published dark variant built from palette tokens", draining five literals. Google's brand requirements govern that button, not the reference.
- `AppShell`'s skip link on `/login`. Three controls; nothing to skip.

**EFFORT.** Trivial.

---

### 6.2 `pages/Onboarding.tsx`

**OURS.** 184 lines. `main.login-shell` → `section[aria-labelledby]` → eyebrow,
`h1`, subtitle → `form.login-form` with a name `<input>` and a language
`<select>` → submit → a footer that is the Law-2 exit, different for someone
already set up ("the world") and someone not ("leave the account").

**THE REFERENCE.** `Field`, `Selector`, `Button`, `Stepper`, `AppShell`.

**WHAT THEIR ANATOMY HAS THAT WE DO NOT.** `Field` → *Description*,
*Optional/Required indicator*, *Label tooltip* (all refusals).
`Stepper` → *Frame*, *Compact summary*, *Indicator*, *Progress bar* (refusals).

**WHAT TO TAKE.** Nothing beyond the global `aria-labelledby` and `Link`-label
sweeps. This page has been through a craft pass against the six laws and its
header shows the work. Record the one reference rule it already satisfies better
than the reference: `Button`'s "Write labels that describe the action" — the
exit says two different true things depending on who is standing there, which
is Law 1 done properly.

**WHAT TO REFUSE.** `Stepper` explicitly — **"Don't: Use a stepper for fewer
than 3 steps"** and this is one field. Also R3 (its 4px progress bar grows),
R1 (status colours) and numerals.

**EFFORT.** Trivial.

---

### 6.3 `components/RequireAuth.tsx`, `components/SurfaceBoundary.tsx`

**OURS.** `RequireAuth` (77 lines): three states; renders `LoadingHome` while
the cookie round-trip is in flight, never redirects on `isLoading`.
6 call sites. `SurfaceBoundary` (230 lines, the one class in `packages/web`):
catches lazy-chunk rejections, reloads the document **once** behind a
`sessionStorage` guard, then shows `main.login-shell` → `section[aria-labelledby]`
→ `h1` → `p[role=alert]` → a retry `.btn-primary`. 4 call sites. `chrome.css`.

**THE REFERENCE.** `Banner`, `EmptyState`, `Spinner`, `Skeleton`, `AlertDialog`.

**WHAT THEIR ANATOMY HAS THAT WE DO NOT.**
- `EmptyState` → **"Don't: Use an EmptyState for error messages that require immediate action; use a Banner instead."**
- `Banner` → **"Do: Make info and success banners dismissable. Keep error banners visible until the user fixes the issue."** (Our error screen is not dismissable — correct.)
- `Banner` → **"Do: Error and warning banners render as `role="alert"`."** (Already.)

**WHAT TO TAKE.** Nothing. Both files are correct against the reference already, and
`SurfaceBoundary` is better than the reference offers: the reference library has no component
for "the lazy chunk 404'd because the deploy moved", and this file's
reload-once-with-a-sessionStorage-guard is a genuinely good answer to it.
Record that `Skeleton` and `Spinner` are refused here (R3) and that
`fallback={null}` is deliberate — the file's header explains that a spinner
before the layout's first frame "would be the half-appearance the page forbids
everywhere inside itself".

**WHAT TO REFUSE.** All of `Spinner`, `Skeleton`, `ProgressBar`. R3, stated.

**EFFORT.** None.

---

### 6.4 `components/LoadingHome.tsx`, `components/Companion.tsx`

**OURS.** `LoadingHome` (144 lines): the world's ground, the real `Companion`
at rest pose, one line, `role="status" aria-live="polite" aria-label="Loading"`,
all inline because it renders before `.jar` exists so `var()` would resolve to
nothing. `Companion` (118 lines): `restPose` from `character/raster.ts` with a
CSS radial aura; **it does not move**, by ruling. Call sites: 2 and 4.

**THE REFERENCE.** `Spinner`, `Skeleton`, `Avatar`, `useAnnounce`.

**WHAT THEIR ANATOMY HAS THAT WE DO NOT.**
- `Spinner` → **"Do: Provide a meaningful label to describe what is loading for screen reader users"**, **"Don't: Stack multiple spinners in the same view; use one to represent the overall loading state."**
- `Skeleton` → **"Don't: Show skeletons indefinitely; if loading takes too long, show an error or empty state instead."**

**WHAT TO TAKE.** One thing, and it is `Skeleton`'s Don't applied to a screen
that has no skeleton: **what happens if the world never loads?** `LoadingHome`
has no timeout and no failure state of its own — it says "LOADING" forever, and
`SurfaceBoundary` only catches a *rejected* import, not a slow one. The reference's
rule names the gap: after some bound, say something else. The honest version
here is a second line (not a spinner, not a bar) after ~15s offering the
reload `SurfaceBoundary` already knows how to do.

Also: `aria-label="Loading"` is a hardcoded English string on the one screen
every non-English speaker sees first. It should come from `t(locale, …)`.

**WHAT TO REFUSE.**
- `Spinner` and `Skeleton` entirely, named: R3, and `LoadingHome`'s header is the argument — the loading screen *is* the world, early, and "the way in looks like arriving".
- Any motion on `Companion`. The file's closing line is the ruling: *"There is no loop here and inventing one would be motion nobody asked for. The founder's law stands: nothing moves unless the user moved it."* the reference has no component that changes this.
- `Avatar` for the creature. R2/R1, and the creature is not a person.

**EFFORT.** Trivial.

---

### 6.5 `components/MobileShell.tsx`, `pages/MobileChecks.tsx`

**OURS.** `MobileShell` (84 lines): a fixed `div[role=status]` with **inline
styles carrying raw hex** — `background:'#171c26'`, `color:'#e9e5db'`,
`border:'1px solid #596273'` — and a retry button at `minHeight: 44`. 1 call
site: `main.tsx`. `MobileChecks` (71 lines): a dev page, also fully inline
(`color:'#eee'`, `fontFamily:'Pretendard, sans-serif'`).

**THE REFERENCE.** `Banner`, `Toast`, `Button`.

**WHAT THEIR ANATOMY HAS THAT WE DO NOT.** `Banner` → **"Banner frame — Required: Outer frame"**, **"Status surface — Required"**, **"Title — Required"**, **"Action button"**, and **"Do: Use the `section` container for full-width messages that span the entire page."**

**WHAT TO TAKE.**
1. **Four raw colour literals in a `.tsx` file**, which is precisely where the `COLOUR_CEILING` ratchet cannot see them — it reads `src/styles/*.css` only. `#171c26`, `#e9e5db`, `#596273`, `#eee`. Move them onto tokens (`--moon-ground`, `--moon-ink`, `--moon-edge`) or, better, onto a class in `chrome.css` where the ratchet counts them. This is the ratchet's own blind spot and the companion test it asks for; a `.tsx` colour sweep belongs in the same gate.
2. **`MobileChecks` sets `font-family: Pretendard` inline** — a second typeface, on a page nobody is governing. R2. It is a dev page, so the cheap answer is to make it wear `--waka-face` and let it look like the product.
3. `Banner`'s section-container rule: the native-bridge notice spans the viewport, which is the `section` case. It already does.

**WHAT TO REFUSE.** `Banner`'s required status icon and its four colours (R1/R2);
`Toast` (the notice must persist until the bridge recovers).

**EFFORT.** Trivial.

---

## 7. `pages/Home.tsx` — the world, by surface

17,776 lines; one page with many named surfaces. `home.css` (418 rules),
`claims.css` (317), `chat.css` (70). Treating it as one component is useless, so
here are its distinct surfaces.

### 7.1 The dock (`nav.waka-dock`, four destinations + the plus)

**OURS.** `nav[aria-label]` → four `.waka-dock-item` buttons with
`aria-current="page"`, plus a `+` slot whose sheet is
`div.waka-new[role=menu]` of two `button[role=menuitem]`, a
`button.waka-new-away[tabIndex=-1]` full-screen dismiss target, and a
transforming middle slot (`.waka-dock-making`) that becomes the note's tools.
`claims.css`.

**THE REFERENCE.** `DropdownMenu`, `MoreMenu`, `BottomSheet`, `useListFocus`,
`Toolbar`, `AppShell`.

**WHAT THEIR ANATOMY HAS THAT WE DO NOT.**
- `DropdownMenu` → **"Trigger button — Required: Button that opens and closes the selected menu presentation"** with, per ARIA, `aria-haspopup`. We have `aria-expanded` and no `aria-haspopup`.
- `DropdownMenu` → **"Like the menus of macOS and iOS, the row under the pointer when it is released is the row that acts, the highlight follows a held mouse or finger, a mouse opens it on press and can drag straight into it, and a finger held on the trigger opens it with the finger down."**
- `useListFocus` → **"Do: Set `orientation` to … 'vertical' for dropdown menus"**, **"Do: Provide an `onEscape` callback for menus/dropdowns to return focus to the trigger."** Our sheet closes on Escape and leaves focus wherever it was; no arrow keys; no focus moved into the menu on open. A `role="menu"` with `role="menuitem"` children and no arrow navigation is an ARIA contract we declare and do not honour.
- `BottomSheet` → the touch presentation (refused, R5).

**WHAT TO TAKE.**
1. **`aria-haspopup="menu"` on the plus.** One attribute.
2. **Focus into the sheet on open, arrow keys between its two rows, focus back to the plus on Escape and on select.** `Menu.tsx` already wrote the focus-return argument out in full ("Focus moves BEFORE the state change, because after it the element holding focus has unmounted and the browser has already dropped the selection to `<body>`") and implements it for the two corner cards. The dock's sheet is the third card and did not get it. Law 3.
3. Either honour the `role="menu"` contract or drop to `role="group"` with plain buttons. Two rows is small enough that either is defensible; declaring `menu` and not navigating it is not.

**WHAT TO REFUSE.**
- The dock's composition, order, count and transforming slot. R5, and the file carries ~80 lines of founder quotes defending each.
- `DropdownMenu`'s **"Touch sheet frame"** / `presentation="bottom-sheet"`. The sheet already hangs off the plus by the box model (and the file explains why that beats measuring); a scrim-backed modal sheet for two rows is the modal weight the product spends its time removing.
- `MoreMenu`'s three-dot trigger. The plus is a verb, not an overflow.
- `AppShell`/`TopNav`/`SideNav`. R5.
- The reference's press-and-drag-into-the-menu model. It is a mouse idiom; the dock is thumb-first and the file's own hover/press reasoning (on `.jar-when`) shows the product has a considered answer already.

**EFFORT.** Trivial for (1); moderate for (2)–(3).

---

### 7.2 The time dial (`.jar-when` trigger → `.jar-dial-list`)

**OURS.** A `.jar-when` button with `aria-expanded` that opens on mouse hover
*and* press, revealing `div.jar-dial-list[role=group]` of `.jar-dial-stop`
buttons with `aria-current`. `home.css`.

**THE REFERENCE.** `Popover` + `usePopover`, `HoverCard` + `useHoverCard`,
`DropdownMenu`, `Selector`, `useListFocus`.

**WHAT THEIR ANATOMY HAS THAT WE DO NOT.**
- `HoverCard` → **"Do: Leave `touchTrigger` on `auto` so a tap opens the card on triggers that do nothing else, and stays out of the way on triggers that perform an action."** Our hand-rolled `timeHovered` ref implements a version of this and the comments show the reasoning; the reference's framing is cleaner and worth citing.
- `Popover` → **"Fallback close control — Keyboard-reachable close affordance"**; **"Trigger element — Required: … control that anchors and toggles the popover."**
- `useListFocus` → arrow keys, Home/End, `onEscape` returning focus to the trigger. The stop list has none.
- `Popover` → **"Don't: Assume scrolling alone means Popover is the wrong component; a bounded Popover may scroll while a focused anchored interaction remains appropriate."** (Useful: the stop list can be long and that is fine.)

**WHAT TO TAKE.**
1. `aria-haspopup="listbox"` (or `"menu"`) on `.jar-when`, alongside `aria-expanded`.
2. ArrowUp/ArrowDown + Home/End through the stops, Escape returning focus to `.jar-when`. Same ~25-line helper as §2.2(1) and §7.1(2) — at this point three surfaces want it, which is the argument for writing `lib/use-list-focus.ts` once with the reference's documented option set (`orientation`, `wrap`, `hasHomeEnd`, `hasRovingTabIndex`, `onEscape`) rather than three times.
3. `HoverCard`'s `touchTrigger: auto` wording as the comment on the existing hover logic, so the next reader finds the reference rather than re-deriving it.

**WHAT TO REFUSE.**
- `Selector` / `ComplexSelector`. The stops are a history, not a value being set, and the file's own note records that the draggable `.jar-dial-track` was deliberately removed.
- A visible close in the list. R4; the scrim-and-Escape pair is the product's standing answer.
- `HoverCard`'s **"Do: Provide a dashed underline on text triggers so users know the element is hoverable."** R2/R4 — the word is already a `jar-label`-tier control and a dashed rule is a second channel.

**EFFORT.** Moderate.

---

### 7.3 The creature's claim question (`.jar-ask`), the poster (`h1.jar-poster`), the reach (`.jar-reach`)

**OURS.** The `.jar-ask` rows are the three answers to a claim, as
`aria-pressed` button groups. The poster is an `<h1>` that is itself the press
target (guarded by `test/hq-pointer.test.ts`). `.jar-reach` is a single
`sr-only` tab stop with `role="listbox"`, `aria-activedescendant` and
`role="option"` children giving keyboard access to the canvas orbs.

**THE REFERENCE.** `ToggleButtonGroup`, `SegmentedControl`, `ClickableCard`,
`useGridFocus`, `useListFocus`, `Heading`.

**WHAT THEIR ANATOMY HAS THAT WE DO NOT.**
- `ButtonGroup` → **"Do: Keep the group a single Tab stop. Arrow keys move between members along the orientation, Home/End jump to the ends, and disabled members are skipped. This is the WAI-ARIA APG roving tabindex technique."** Each `.jar-ask` row and the `jar-char-form` face pair are N separate tab stops.
- `ButtonGroup` → **"Don't: Don't disable the group to show that an action is in flight. A disabled member drops focus, so a keyboard user loses their place; leave the group enabled and show progress on the button that started the work."** Worth checking every `disabled={pending}` on these rows — `GroupSignalFeedback.tsx:69` does `aria-disabled={pending !== null || undefined}`, which is the correct form (keeps focus); confirm the `.jar-ask` rows do the same rather than `disabled`.
- `ButtonGroup` → **"Do: Name the group for what its buttons act on. The label is the group's accessible name and a screen reader reads it before each member."**
- `Heading` → **"Do: Set `accessibilityLevel` on Heading when the visual level differs from the document outline."** There are three `<h1>`s in `Home.tsx`; only one page can have one.

**WHAT TO TAKE.**
1. **Roving tabindex on every `aria-pressed` group in the world** — the claim answers, `jar-char-form`'s two faces, the audience pair, the provenance picker. The reference's `aria-disabled`-not-`disabled` rule comes with it, and its reason is a real bug: answering a claim disables the row, focus drops to `<body>`, and the next Tab restarts the page.
2. **Group names.** Each `.jar-ask` row should carry `role="group"` + `aria-label` naming what the three answers act on, so a screen reader hears the claim before each answer rather than three bare verbs.
3. **One `<h1>` per rendered page.** Audit the three in `Home.tsx` and demote two to `<h2>`/`<p>` with `aria-level` where the visual weight must stay. The reference: **"Don't: Skip heading levels in the document outline."**
4. **`.jar-reach` is the model to copy, not change.** It is already `useListFocus`/`useGridFocus` done right and it is the proof that §5.3 and §7.2 are in-house work rather than new invention. Point the new `lib/use-list-focus.ts` at it.

**WHAT TO REFUSE.**
- `SegmentedControl`/`ToggleButtonGroup` painting. R1 — the selected answer is lit, and `claims.css` already records why lighting "yes" both broke.
- `ClickableCard` for the poster. The `<h1>`-is-the-control arrangement is deliberate and gated; a card around it would be the container the reference library itself says to question.
- `Text`/`Heading` as components. R2 — one face, and `type-scale.test.ts` already governs size.

**EFFORT.** (1) moderate across ~6 groups; (2)–(3) trivial.

---

## 8. Cross-product items with no single owner

These are not per-component; they are the same finding in many places and
should be done once.

**8a. One `aria-live` region for the whole product (`useAnnounce`).**
The reference's reason is mechanical and we have the bug it describes: *"The polite and
assertive regions are created empty on first use and stay mounted, which is
what makes announcements reliable: most screen readers ignore a live region that
is inserted together with its content."* We have **54 `role="status"`** and
**36 `role="alert"`** elements, almost all of which are *conditionally rendered
with their content* — which is exactly the pattern the reference says usually does not
announce at all. Keep the inline `role="status"` text (it is visible and
correct), and add one always-mounted polite region plus one assertive region
that `announce()` writes into, for the states that are only conveyed visually:
search result counts, filter outcomes, copy confirmations, save settled.

**8b. One `lib/use-list-focus.ts`.** Wanted by §2.2 (categories), §2.6 (search
results), §7.1 (the plus sheet), §7.2 (the dial stops), §6.1 (login tabs), and
§7.3 (six `aria-pressed` groups). The reference's documented option surface is the
right API: `orientation`, `wrap`, `hasHomeEnd`, `hasRovingTabIndex`,
`hasCaretGuard`, `onEscape`, plus `focusFirst`/`focusLast`/`getItems`. Build it
by generalising `.jar-reach`.

**8c. One `lib/use-clipboard.ts`.** Three hand-rolled writes with three
confirmation mechanisms and zero announcements (§2.9(5)).

**8d. One confirmation primitive on `AlertDialog`'s anatomy.** Seven
destructive confirmations in three shapes, two of them `window.confirm`
(§2.9(1)).

**8e. `aria-labelledby` instead of a duplicated `aria-label`** on every
`DialogSurface` that already renders a visible title. Six known sites
(§2.1(b)).

**8f. Widen `test/motion.test.ts` to `chat.css` and `claims.css`.** It reads
`home.css` only, and the one infinite animation in the product lives in
`chat.css` (§3.1(2)). The gate's sibling `type-scale.test.ts` already learned
this lesson in its own header: *"A gate with a hand-written list of what it
watches only watches the past."*

**8g. Extend the colour-literal ratchet to `.tsx` inline styles.**
`MobileShell` and `MobileChecks` carry four raw hex values the gate cannot see
(§6.5).

**8h. Sweep `aria-label` against the reference library's `Link` harmful-override rule.**
Keep on icon-only controls; remove wherever visible descriptive text already
says it (§5.2(2)).

**8i. One date/time formatter.** Four implementations across
`AttachmentPreview`, `AttachmentTranscript`, `ConversationPanel` and the `lib`
helpers; the reference ships one `Timestamp` because "mixing relative and absolute
timestamps in the same column confuses scanning" (§4.3(4)).

**8j. Scrub the reference library's name out of the repository.** Founder,
2026-10-11, and it is a hard requirement rather than a preference:

> "also dont mention [the reference library] at all in any of our codebase. readme, codebase,
> nowhere. we're just referencing it to build our own thing. this is a MUST DO.
> NEVER MENTION IT ANYWHERE"

We are referencing the library to build our own thing; we do not name it.

**State as of 2026-10-11: the repository is clean.** A repo-wide
case-insensitive grep returns nothing, in `src/`, `docs/`, tests and the
READMEs. This document complies — it says "the reference library" throughout,
and the one place the founder's own words carried the name it is bracketed as
`[the reference library]`. The five source files whose header comments used to
attribute their reasoning by name have already been rewritten to the same
substitution, keeping every quotation and every argument intact:
`components/Menu.tsx` (the popover no-nesting rule, the focus-return
reasoning), `components/ConversationPanel.tsx` (the composer anatomy, the
message-list role, the metadata rule, the dictation placement),
`components/HomeActionIcon.tsx` (why `send` and `stop` were drawn),
`components/SavesOverlay.tsx` (the text-input anatomy, the clear-button rule,
the result-count rule), `components/HowItWorksPanel.tsx` (the
single-short-paragraph collapsible rule). The reasoning is the asset; the name
is not.

**What is still missing is the gate.** A prohibition held only by everyone
remembering it is the exact failure mode `test/type-scale.test.ts`' own header
describes — "a gate with a hand-written list of what it watches only watches
the past". Add a test alongside it that reads `src/**`, `docs/**`, `test/**`
and the repo root, and fails on the name case-insensitively, with a failure
message that says what to write instead. It costs one file, it can never
false-positive on product vocabulary, and it has to land **before** anything
else in §9 — every item below adds header comments citing reference guidance,
and each one is otherwise a fresh chance to reintroduce the name.

---

## 9. Ranked — the highest-value changes across the whole product

Ordered by **(harm prevented × people affected) ÷ risk of breaking a ruling**.
Everything above the line in each tier is a prerequisite for nothing; they can
be dispatched in parallel.

| # | Change | Where | Why it ranks here | Effort |
|---|---|---|---|---|
| **0** | **Gate the reference library's name out of the repository.** The scrub is already done; the test that keeps it done is not. | §8j | Not a craft call — a founder directive, stated as "this is a MUST DO. NEVER MENTION IT ANYWHERE". The tree is clean today and nothing holds it clean tomorrow, which is the failure mode this codebase has a name for. It is also a prerequisite: every item below adds header comments citing reference guidance, and without the gate each one is a fresh chance to reintroduce the name. One file, no behaviour change, so it costs nothing to do first. | Trivial |
| **1** | **Stop declaring the four dock destinations modal, and stop trapping Tab inside them.** `modal={false}` on `DialogSurface` for Saves / Principles / Claims / Conversations. | §2.1(a) | A keyboard user standing in any of the product's four main destinations **cannot reach the dock**, and `claims.css` states that the dock "is how you leave one". That is Law 2 — the founder's single most-repeated complaint — failing on the four most-visited surfaces, invisibly, because the exit is on screen and merely unreachable. `aria-modal` also tells a screen reader the dock does not exist. One prop, four call sites. | Moderate |
| **2** | **Fix `pages/Days.tsx`: 24×24 targets, one tab stop with 2D arrows, weekday headers, a today marker.** | §5.3 | The worst surface in the product by every measure the reference states: three of `Calendar`'s four anatomy parts missing (two marked Required), 14px targets at a 20px pitch against a WCAG 2.5.8 floor **this codebase already cites by name in `chrome.css`**, and ~119 tab stops on a page with five other controls. It is also the lowest-risk real work in the audit: the page has almost no behaviour, nothing changes visually, and `.jar-reach` is a working in-house model for the focus work. | Real work |
| **3** | **One confirmation primitive on `AlertDialog`'s anatomy; delete both `window.confirm`s.** | §2.9(1), §8d | Seven destructive confirmations in three different shapes, two of which open a **system dialog in a system font** — Law 5 ("the product is one material, and every surface wears it") broken in the most literal way available, on irreversible actions. The reference's anatomy also supplies the three things the inline pair cannot: a consequence linked by `aria-describedby`, initial focus on Cancel, and no outside-press resolution. Pays out across seven sites. | Real work |
| **4** | **Body scroll lock on the nine real sheets, with the scrollbar-gutter clause.** | §2.1(c) | the reference's `useScrollLock` doc names our exact bug: *"necessary for iOS Safari where `overscroll-behavior: contain` does not work."* We use `overscroll-behavior: contain` in eleven places and lock the body in zero, in a **mobile-first** product. Ranked below 1–3 only because it degrades rather than blocks. The gutter clause is non-optional or the dock jumps sideways on desktop. | Moderate |
| **5** | **One `lib/use-list-focus.ts`, then roving tabindex + arrows + focus-return on the plus sheet, the dial stops, the category row, the login tabs and the six `aria-pressed` groups.** | §8b, §7.1, §7.2, §2.2, §6.1, §7.3 | Eleven surfaces, one helper. Two of them declare ARIA contracts they do not honour (`role="menu"` with no arrow keys; `role="tablist"` with no roving tabindex and no panel). One of them has a real focus bug the reference names outright — **"A disabled member drops focus, so a keyboard user loses their place"** — which is what answering a claim does today. And `Menu.tsx` already wrote the focus-return argument in full for two of three cards; the dock's sheet is the one that did not get it (Law 3). | Moderate |
| **6** | **Rebuild `PrincipleShare`: ten `<select>`s → three decisions, two segmented pairs, the words editor open by default, one disclosure not two nested.** | §2.8 | The ugliest surface left, and the door to the one artifact the product asks people to share — the founder's whole brief for the principles work was "people have the urge and motivation to want to share this publicly", and this is where that urge goes to fill in a form. The reference's `SegmentedControl` rule ("2–5 mutually exclusive options where all options should be visible") and `Collapsible`'s "don't hide critical content" are both decisive. Ranked 6 because it is a redesign and should follow the cheap structural wins. | Real work |
| **7** | **Port the attachment tile to `InspirationAttachments`; kill the last `<audio controls>`.** | §4.3(1) | The founder ruled on this and the ruling landed on one of two surfaces: *"I think it's a little ugly how files are added today"* → the notepad got the tile, the opened saved note still renders the browser's white pill with three controls. Law 3 with the founder's own words attached, `one-note.test.tsx`'s same-component principle, and the glyphs and CSS already exist. | Moderate |
| **8** | **One always-mounted `aria-live` pair + `announce()`, wired to the search/filter outcomes and the copy confirmations.** | §8a, §2.2(2), §2.6(3) | 54 `role="status"` and 36 `role="alert"` nodes, nearly all conditionally rendered **with** their content — the reference library: *"most screen readers ignore a live region that is inserted together with its content."* So a large part of the status language in this product may be announcing nothing. Filtering the archive is the sharpest case: the list and the title's count both change silently. WCAG 4.1.3, and the reference's own "announce the outcome, not the interaction". | Moderate |
| **9** | **Delete the animated thinking dots; widen `motion.test.ts` to `chat.css` and `claims.css`.** | §3.1(2), §8f | The only infinite animation in the product, sitting beside a `role="status"` sentence that already says the same thing. It breaks R3, it breaks `test/motion.test.ts`' stated envelope ("runs once on appearance (never loops)"), and the gate cannot see it because it reads one stylesheet — the same blind spot `type-scale.test.ts` had before `claims.css` and `chat.css` were admitted. Trivial to fix and it closes the gate behind itself. | Trivial |
| **10** | **The attribute sweep: `aria-labelledby` over duplicated `aria-label` (6 sites); `aria-haspopup` on the four popover triggers; `aria-controls` on the three settings disclosures; `title` on the icon-only corners; `aria-label` removed where visible text already says it.** | §8e, §8h, §1.1, §1.2, §1.5 | The cheapest real gains in the document, and they are gains in the two things the reference documents better than anything else: how a surface names itself and how a trigger declares what it opens. `HowItWorksPanel` already made the `aria-labelledby` fix one level up with the reason written down — *"a second copy of the same words in an attribute is a [duplication]"* — so this is Law 3 on an argument the codebase has already won. No visual change, no copy, no new tokens, no risk. | Trivial |

**Just below the line, and worth naming so they are not lost:** the
return-to-latest control in the chat transcript (§3.1(1) — the one genuinely
missing *function* in the panel); drop-to-attach on the note body (§4.1(4));
drawing the last text-character controls `×` and `↻` (§4.1(1), §4.4(2)); the
`.tsx` colour-literal sweep and ratchet extension (§6.5, §8g); `LoadingHome`'s
missing timeout and its hardcoded English `aria-label` (§6.4); and one date
formatter (§8i).

**What is deliberately not on any list:** the reference's visual system. Not one
recommendation above changes a colour, adds a typeface, adds an icon set, adds
a status semantic, or adds a looping animation. The founder's sentence was
"make it so that our look and feel is not gone" — the look and feel is the one
thing this audit does not touch. What it takes is the reference's *vocabulary* (named
parts, so a reviewer can ask "where is the clear button?"), its *accessibility
rules* (which are the best-documented part of that system and the weakest part
of ours), and its *distinctions* (Dialog vs page, TabList vs SegmentedControl,
Card vs Section, Banner vs Toast vs AlertDialog) — each of which resolves a
place where this product is currently saying one thing in markup and a
different thing on screen.
