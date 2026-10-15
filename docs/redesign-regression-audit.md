# Redesign regression audit — what went missing that nobody decided to remove

Asked for by the founder, 2026-10-11, in these words:

> "https://dev.waka.im/ — Audit this version one last time to ensure we didn't
> accidentally remove a critical feature or workflow in our new redesign."

This is a findings document. **Nothing here has been fixed.** Each item names
what it is, the evidence, a rank, and what restoring it would cost.

The ranks:

- **LOST** — a capability a person had and now cannot reach by any path.
- **STRANDED** — the server or the data layer still supports it, nothing in
  the UI reaches it, and no commit says that was intended.
- **MOVED** — still reachable, somewhere a person who knew the old place
  would not look. Listed so nobody re-reports it as a bug.
- **DELIBERATE** — removed with a stated reason. Listed in one place so the
  founder can disagree with any of them at once.

---

## 0. Read this first: dev.waka.im is not the redesign

**The deployed site is roughly three days stale.** It does not contain the
redesign at all, so "audit this version" and "audit the redesign" are two
different requests, and this document answers the second.

How I know, without needing to sign in:

- `https://dev.waka.im/` serves `/assets/index-R9hV3Ca4.js` and
  `/assets/index-c-ZK8zbo.css`. I downloaded both.
- The message catalogue is inlined in that JS bundle. Its key set matches
  `packages/web/src/lib/i18n/messages/en-US.json` **as it stood at commit
  `cb86d91e` (2026-10-08 15:43)** — 819 product keys, with exactly one
  (`worldReviewResume`) unaccounted for. At HEAD the same prefix set is 582
  keys. I scanned 220 commits; nothing newer comes close.
- The deployed stylesheet is the *previous* design system: `--accent`,
  `--font-serif: Instrument Serif`, `--error:#b3261e` (a red, which the
  current `chrome.css` explicitly drains with the note *"there is no red in
  Waka"*), and the `.jar-composer-*` class family.
- Not one class introduced in the last three days appears in either deployed
  asset: `waka-companion`, `jar-char-bubble`, `waka-rungs`, `waka-dock`,
  `waka-settings`, `waka-corner`, `chat-composer`, `jar-tile`,
  `waka-about-loop`, `waka-over-count` — all zero occurrences.
- Rendered signed-out in Chromium, `https://dev.waka.im/login` shows the old
  door: no companion, lowercase `sign in`, the pre-craft-pass layout.

So the comparison in this document is **local HEAD against git history**, not
deployed against local. Git is the better baseline anyway — but if the founder
has been forming impressions by using dev.waka.im today, those impressions are
of the 2026-10-08 product.

**Audit basis.** HEAD = `5eee072f` (2026-10-11 20:54). The working tree was
*live* while I worked: two parallel sessions were editing it. Where the
working tree differs from HEAD in a way that matters to a finding, I say so.
The two in-flight changes I observed are (a) the three machinery doors being
restored behind the "i" — `AntechamberPanel.tsx`, `DuplicatesPanel.tsx`,
`ReadingPanel.tsx`, `lib/api/reading.ts`, `lib/api/signal-duplicates.ts`,
`restoreSignal` — and (b) a `DialogSurface` + overlays pass on keyboard
reachability.

---

## 1. LOST

### L1. On a phone, the dock loses destinations entirely — and there is no scroll to reach them

**Rank: LOST.** This is the most serious finding in the document.

`.waka-dock` (`packages/web/src/styles/claims.css:271`) is `position: fixed`,
centred, `max-width: calc(100vw - var(--sp-32))`, `display: flex`, with **no
wrap, no `overflow-x`**, and `.waka-dock-item` is `white-space: nowrap` with
`min-width: auto`, so it cannot shrink. Content overflows the clamped box and
`document.documentElement.scrollWidth === window.innerWidth`, so the overflow
is unreachable — not even by swiping.

Measured **in the live app**, signed in, Chromium, `hasTouch`, DPR 3:

| width | state | what is off screen |
|---|---|---|
| 320 | at rest | **Principles** (287..369) |
| 360 | at rest | **Principles** (287..369) |
| 390 | at rest | — fits |
| 320 | a saved note open | **Chats** (320..380), **Principles** (384..466) |
| 360 | a saved note open | **Chats**, **Principles** |
| 390 | a saved note open | **Principles** (384..466) |

The note-open case is the one the redesign created: `97159189` put the
record / photo / Save row into the dock's middle slot via the
`waka-note-tools` portal (`packages/web/src/components/NoteTools.tsx:42`), so
the bar grew by three controls on a surface where the dock is documented as
*"how you leave"* (`claims.css:273-277`). The at-rest case predates it by a
few hours — `d4e230ee` created the five-item dock — and was never measured on
a phone.

**Why no gate caught it.** `packages/web/test/phone-breakpoints.test.ts:419`
holds an `ACTS` list that was not extended by any of the six in-range commits
that touched the file, including the one that created the dock. The gate asks
only about `min-height` under a coarse pointer. Nothing anywhere asks whether
a fixed, centred, non-wrapping, non-scrolling bar **fits the narrowest phone**.
The file's own fixture comment (`claims.css:5396`) still names `OpenCorner`
and `MenuRows` as what was measured; both were deleted later the same day.

**To restore:** let `.waka-dock` wrap or scroll horizontally, or drop the
labels to glyphs below ~390px. Plus one gate: at 320/360/390, every dock child's
`right` must be `<= innerWidth`.

### L2. A new inspiration cannot take an audio recording in any browser that can dictate

**Rank: LOST at the moment of capture.** There is a workaround, named below.

`8aa2ef95` ("the microphone writes words, not a file") made the notepad's bare
microphone dictate. The recorder now renders **only** in the `else` branch:

```
packages/web/src/pages/Home.tsx:17327
  {dictationAvailable() ? ( …dictate… ) : supportedRecordingType() ? ( …record… ) : null}
```

So in Chrome, Safari and Edge there is no control that starts a recording
while writing a new inspiration. The commit's own stated fallback is not
true:

> "the recorder is still the right tool when the SOUND is the point (a melody,
> somebody else talking) and **it is one press away behind the camera's own
> menu**"

There is no menu. The camera is a bare file input, and its `accept` list is
images only — `Home.tsx:17371`, `NoteTools.tsx:99` and
`InspirationComposer.tsx:309` all read
`accept="image/jpeg,image/png,image/webp,image/gif,image/avif,image/heic,image/heif,.heic,.heif"`.
There is no `audio/` accept anywhere in the client. A picker restricted to
images cannot produce a recording.

**The workaround that does exist**, and that nothing tells anybody about:
save the note, reopen it from the archive, and the saved-note dock *does*
offer Record — `NoteTools.tsx:76-92`, unconditional on
`supportedRecordingType()` and never routed through dictation. I confirmed
this in the browser: the open-note bar reads `Record · Photo · Save
inspiration · Delete`, while the notepad reads `Speak · Photo · Save
inspiration`.

That asymmetry is itself a problem — the same glyph does two different things
on two pages that `test/one-note.test.tsx` exists to keep identical.

**To restore:** give the notepad's slot both acts (the composer already
handles an arriving recording — `recordingCandidate`, `onChooseRecording`,
the audio tile with play/pause — all of it is live and unreachable), or add
`audio/*` to the photo input's accept list.

### L3. Two native deep-link claims now open the app onto nothing

**Rank: LOST**, mobile only.

- **`/profile`.** The route was deleted in `5df201f6`; `main.tsx:182-197` is
  its tombstone. React-router ranks `/:handle` (`main.tsx:173`) above the
  splat, so `/profile` matches `PublicProfile` with `handle="profile"`,
  `PublicProfile.tsx:99` finds no leading `@`, and `PublicProfile.tsx:122`
  silently redirects to `/`. Still claimed as an owned destination in
  `packages/web/src/lib/platform/navigation.ts:22`, in
  `packages/mobile/android/app/src/main/AndroidManifest.xml:43`, and in the
  published Apple applinks components (`packages/mobile/lib/link-associations.mjs:11`).
  `test/native-navigation.test.ts:13` still *asserts* `/profile` is preserved
  and passes, because it tests the mapping function and never that a route
  answers.
- **`/review/*`.** `AndroidManifest.xml:40` (`pathPrefix="/review/"`) and the
  same applinks file still hand `/review/...` to the app. `readViewLocation`
  stopped parsing it on 2026-10-10 (`lib/view-location.ts:66-71`), so
  `nativeLinkDestination` returns null, the `https://` branch throws "Foreign
  app link" inside `parseAppLink`, and `MobileShell.tsx:65-67` swallows it.
  The app opens on whatever screen it was on and nothing happens. The test was
  updated to assert the refusal; the manifests were not.

**To restore:** drop both path claims from the manifest and the applinks file,
and make `navigation.ts:22` stop naming `/profile`.

### L4. Korean readers get English on every attachment

**Rank: LOST for the Korean locale. Pre-existing (2026-10-02), not caused by
the redesign — but the redesign made attachments a first-class shelf, so it is
now on screen far more often.**

`packages/web/src/components/AttachmentPreview.tsx` and
`packages/web/src/components/AttachmentTranscript.tsx` import nothing from
`lib/i18n` or `lib/locales` and take no `locale` prop. They are English by
construction, and `InspirationAttachments.tsx:16,20,22` renders them
unconditionally for every saved link, image and audio attachment. A Korean
reader sees `"The transcript isn't ready. Your recording is kept."` and
`"This page needs access WAKA doesn't have. You can open the original."`

Same class, same cause: `lib/use-audio-recording.ts:25-87` (every microphone
failure), `lib/use-inspiration-draft.ts`, `lib/inspiration-draft-store.ts:97`,
`lib/inspiration-media-upload.ts:26`, `lib/inspiration-photo.ts:5,6,22`, and
the recording-choice block in `InspirationComposer.tsx:195,199,386-390`
("Choose a recording", "New recording", "Use new recording", "Keep previous
recording", "Discard recording", "Your earlier recording stays until you
choose."). All dated 2026-10-02; the composer was rewritten around them today
and they were left behind.

### L5. `whyFailed` never receives the locale

**Rank: LOST for the Korean locale. Pre-existing (2026-08-30).**

`packages/web/src/lib/why-failed.ts:32,56` take `locale: SupportedLocale =
"en-US"`. **All 15 `whyFailed` call sites pass two arguments** —
`pages/Home.tsx:12406, 12448, 12460, 12477, 12498, 12538, 12553, 12689, 12710,
12842, 12882, 12901, 12927, 12998, 13388`. The fallback is correctly `say(…)`,
so a Korean reader gets a Korean sentence with an English clause welded to it:

> `저장되지 않았어요 — The server could not be reached.`

while `worldWhyUnreachable` sits translated (`'서버에 닿지 못했어요.'`) and
unreachable from 15 of 16 sites. One dropped argument. Same shape at
`pages/Home.tsx:4514` (`monthTag(T)` with no locale, while its three siblings
at 4418/4446/4458 all pass `localeRef.current`), which renders the poster's
"as of" month in spoken English on a Korean wall.

---

## 2. STRANDED

### S1. The "paste the link" field has no door

**Rank: STRANDED.** The capability survives by another path; the control does
not.

`d4e230ee` (2026-10-11 11:45) deleted the composer's footer row. The founder's
words in that commit are *"The Photo/Link/Record row and the audience pair are
gone: 'remove all'."* **Photo and Record came back in the dock. Link did
not.** The removed line was:

```
- <button type="button" disabled={blocked}
-   onClick={() => {setAddingLink(true);linkInput.current?.focus();}}>{say('worldComposerLink')}</button>
```

What is still there, reaching nothing:

- `InspirationComposer.tsx:223` `const [addingLink, setAddingLink] = useState(…)`
  — **`setAddingLink(true)` now has no caller.** The state can only become true
  if a *restored draft* already held a link.
- `InspirationComposer.tsx:313-318` — the whole `<div className="jar-composer-link">`:
  a `type="url"` input, Enter-to-submit, and a "Remove link" button.
- Three catalogue strings with live readers and no reachable surface:
  `worldPasteTheLink`, `worldComposerCancelLink`, `worldComposerLinkReady`.
  The trigger's own label, `worldComposerLink`, was swept out of both
  catalogues.
- `lib/use-inspiration-draft.ts:69` `setLinkText` — the only two call sites in
  the product are the orphaned input and `Home.tsx:11629`, which *clears* it.
- `inspirationWithPendingLink` in `lib/inspiration-input.ts` — a whole helper
  for merging a separately-entered URL into the text, now unreachable.

**The capability itself is not lost**, and this is why I rank it STRANDED
rather than LOST: `Home.tsx:11628` runs `inspirationLinks(text)` on save and
turns any URL *typed or pasted into the note body* into a link attachment.
A link still saves. What is gone is the only control that said so.

Meanwhile the product keeps promising the field. The notepad's placeholder is
`"A thought, link, photo or recording…"`; the archive's own line says
`"A thought, a link, or something you noticed."` Nothing on the page offers a
link.

**To restore:** one button in the dock's middle slot, or a line in the `+`
menu, calling `setAddingLink(true)`. Everything below it is intact. The label
string needs re-adding to both catalogues.

### S2. A room's principles lost their door, and the stated substitute does not exist

**Rank: STRANDED.** Removed in `6dd3c6e8` (2026-10-08 23:45) — inside the
deployed-to-local gap, outside the final day.

The on-screen door to the sky — the `.jar-values` "philosophies & values"
button, gated `atWall.kind !== "self"` — was at
`cb86d91e:packages/web/src/pages/Home.tsx:14444-14464` and is gone. Wheel and
keyboard vertical travel were removed deliberately
(`pages/Home.tsx:9297-9308`, `9316-9322`) on the reasoning that panels in
those bands "are reached" programmatically — true for your own wall, not for
a room's: every in-product write of `section:'sky'` spreads `EMPTY_VIEW`, and
`EMPTY_VIEW.wallId` is `null`, which `lib/view-location.ts:108` resolves to
the **self** wall.

The commit does state a reason, and the reason is wrong:

> "'Principles' was drawn over the view switcher, which has a Principles row."

The switcher's Principles row opens `PrinciplesOverlay` with
`profileId = atWall.kind === 'agent' ? atWall.id : storageScope.profileId`
(`pages/Home.tsx:17726`) — **your own** profile, even while you are standing
in a room. It never calls `GET /groups/:id/principles`.

Server routes live, nothing reaching them: `/groups/:id/principles`,
`/status`, `/refresh` (`lib/api/principles.ts:65,68,74`). `PrincipleRead` is
still mounted with `active={here}` rather than `inSky`, so the room read
**runs, holds its TTL lease, and renders off-screen** — along with the room's
contested / unsupported notices (`PrincipleRead.tsx:129-131`), the room
evidence `<details>` (`:132-135`), the 0/3-patterns meter (`:141-151`) and the
retry button (`:157-159`). Reachable only by deep link `/w/<group>?view=sky`,
which is exactly how `test/home-navigation.test.tsx:270` reaches it.

**To restore:** one control on a non-self wall that writes
`{section:'sky', wallId: atWall.id}`, or gate `PrincipleRead`'s polling on
`inSky` so it stops paying for a surface nobody can see.

### S3. `/profile` is still linked from inside the product

**Rank: STRANDED**, with a low-reachability caveat.

`packages/web/src/space/settings/SpaceSettings.tsx:465` renders a live
`<Link className="jar-settings-verb" to="/profile">{say("worldOpenYourAccount")}</Link>`,
rendered from `pages/Home.tsx:17987`. `/profile` has no route; the link lands
the person on the world with no message. In practice `SpaceSettings` only
renders when `settingsFor === spaceKey(atWall)` and `atWall` is a group, and
the product has no people-to-people surface since rooms were removed — so
this is a dead control most people cannot reach. It is still a dead control.

Residue in the same family: `lib/api/index.ts:11,19,20,21` still documents
`sessions.ts`, `keeper-keys.ts`, `agent-grants.ts` and `consultations.ts` as
live modules; all four were deleted in `5df201f6`.

### S4. Three catalogue keys that only a test keeps alive

**Rank: STRANDED, minor.**

`copy.test.ts`'s "no message nothing renders" check scans `src` **and**
`test`, so a key named only in a test counts as live. Three keys pass that way
and render nowhere:

| key | en / ko | only reference | dropped from `src` |
|---|---|---|---|
| `tagline` | "Saved inspirations" | `test/i18n.test.ts:117-120` | — |
| `worldBack` | "Back" / "뒤로" | `test/way-out.test.ts:68` | `cdbaeba0` (today) |
| `worldCardClose` | "Close" / "닫기" | `test/way-out.test.ts:64` | `a8d12b8f` (today, "the X goes") |

Worth one note: `test/i18n.test.ts:120` is **the only assertion in the entire
suite that a Korean value contains Hangul**, and it is pinned to `tagline` —
the one key nothing renders.

---

## 3. MOVED

None of these is a bug. They are listed so they are not re-reported as one,
and because each is a place a person who knew the old product would look and
find nothing.

- **All of settings**: `/profile` → the gear's card in the top-right corner
  (`5df201f6`). An old bookmark to `/profile` now lands silently on the world.
- **The three machinery doors** (how it reads you / the antechamber / the
  gardener's asks): the gear → the "i" beside it. Out at HEAD; **restored in
  the working tree** by a parallel session, and I confirmed all three render
  in the running dev server.
- **Save**: a pale pill in the note's corner → the dock's one filled control
  (`ffee792a`), then a check glyph rather than the word (`a09e2626`).
- **Stop** (a reply in flight): halfway up the scrolling transcript → the
  composer's send seat, one control toggling between send and stop
  (`57eb0915`).
- **Dictation**: a separate control → the bare microphone, on the notepad and
  in the chat composer (`8aa2ef95`, `57eb0915`). The same glyph on a *saved*
  note still records audio. One mark, two acts, two pages.
- **Attachments**: full-width rows with a browser `<audio controls>` → a tile
  shelf pinned under the words (`1fe2d5f7`). The file size, the "In this draft
  — not saved yet" line and the upload counter went with the rows.
- **The archive's search field** now appears only past about a dozen rows
  (`SavesOverlay.tsx:681`), and the **category tabs** only once there are two
  categories (`:796`). Both thresholds are reasoned in place. Someone who saw
  the field on day one will not find it on an archive of three.
- **A claim's evidence**: three evidence lines under the claim → one line that
  opens the archive filtered to exactly those saves (`52d3c6b7`).
- **Making something**: the capture bar on home is now a closed slot
  (`.jar-mouth-slot--closed`, `inert`, `opacity: 0` —
  `pages/Home.tsx:15048`). The doors are the creature's "Add an inspiration"
  line and the dock's `+` → "New inspiration" / "New chat".

---

## 4. DELIBERATE — the register, so you can disagree with all of it at once

Each of these was removed with a stated reason, in a commit message or a file
header. I have not re-argued them; I have only gathered them.

| what went | where | the stated reason |
|---|---|---|
| The `/profile` page | `5df201f6`, `main.tsx:182`, `SettingsPanel.tsx` header | "a settings page is not a destination in a product whose destinations are what you kept, what it is thinking, and what has endured" |
| **Keys** and **Agent keys** (mint / copy / revoke) | `5df201f6` | "a developer surface on a consumer product's settings screen". `createAgentKey` stayed and still fired when an agent is made — **no longer true as of 2026-10-12**, minting removed |
| **What agents may read** (grants) | `5df201f6` | "with no key listing there is nothing to grant against" |
| **Connections** and **The read record** | `5df201f6` | "the product has no people-to-people surface since rooms were removed" |
| **How WAKA works** — the three machinery doors | `5df201f6` | *the commit's own words: "the one removal worth arguing with"*. Restored in the working tree today |
| Four explainer paragraphs on `/profile` | `a5bd6279` | "nobody goes looking for a description of a data model" |
| The whole Review / reflection flow — 5 components, 628 lines, 46 buttons, 111 keys, 5 draft namespaces | `3a146b7e` | "Review was never a smaller version of confirming — it was a different mental model" |
| The claim **correction field** itself | `20328aca` | "not quite" and "not me" open a conversation instead. The commit names the loss explicitly: nothing writes `correctionText` any more |
| `Read your thought ↗` under a quoted correction | `3a146b7e`, `ReviewEvidence.tsx:17-23` | the `/review/:session?thought=` route went in the same commit; the link was about to become a dead press |
| The chat's **side drawer** and pinned-keep picker | `c474ed13` | founder: "it's too complicated right now". **The server survives on purpose**: `conversations.initialInspirationId`, migration 0070, `readConversationContext` pinning, with db tests. No client reaches it, and three removal sites say so and point at each other |
| **"Save as draft"** as a button | `a09e2626` | the behaviour stays — `saveAsDraft` is what every exit calls — "a decision between two things that both sound like saving". Verified in the browser: a half-written note survives pressing Now |
| The notepad's and the chat's **back chevron** | `a09e2626`, `1f7b2c81` | "a glyph pointing at a room the dock names in a word" |
| The per-inspiration **audience pair** (only me / share with rooms) | `d4e230ee` | "we got rid of the concept for room" |
| `bulbGlow`, `ordWords` | `3a0fea2a` | both called by nothing; brightness now comes from the field |
| The no-model notice above the chat field | `ffee792a` | the guarded case rewritten as the negative it always was |
| `/days` off the menu (the page keeps its address) | `4e3813cc` | set aside by ruling. Note: on native it is unreachable by *any* path — not in the link allowlist, not in either manifest |
| The reference library's name, from nine source files and two commit messages | `a063bd1b` | founder: "dont mention it at all in any of our codebase… this is a MUST DO". Gated by `unnamed-reference.test.ts` |

---

## 5. Checked and healthy — so the founder knows what I did reach

I walked the signed-in local product in Chromium on a fresh account and
confirmed each of these works:

- **The core loop.** Type a note → Save → it appears in the archive under its
  chapter with `#1` and a date → open it → the page is the notepad's page with
  the same chevron, date and first-word coordinates → edit → Save re-enables
  on the first keystroke → **Delete** is present. Photos attach from the dock
  on both pages.
- **Drafts.** A half-written note survived leaving by the dock and came back
  intact — textarea value `"Half-written draft that should survive leaving."`
- **The offline path** is wired: `offlineHome()`, `offlineRef`, the
  `worldOffline` banner at `Home.tsx:16701`, and `keepIt`'s offline branch
  that births a local inspiration rather than failing.
- **Chat.** `+` → New chat → `/chat/new`, a message field, dictation, Send
  enabling on input, `role="log"` on the transcript.
- **Claims.** The three answers (confirm / not quite / not me) all render and
  write; "not quite" and "not me" open a seeded conversation; the
  came-from-these-saves line opens the archive filtered to those ids.
  `test/claim-correction.test.tsx` presses every surviving button.
- **Principles.** Share (the card **and** the history/"what changed"),
  personal evidence, reorder, dispute, undo-dispute, edit, delete, and
  request-a-read are all reachable with named controls. Nothing was taken off
  `PrincipleShare` in the range — it only gained.
- **The ME / MY AGENT switcher** is not missing. `Home.tsx:17594` renders it
  as `left={agentWall ? … : null}`, so it is absent on an account with no
  agent. I made an agent in the settings card and both faces appeared.
- **Korean catalogue parity is clean.** 626 keys each, **0 missing, 0
  orphan**, re-verified twice during a live tree. Only two of 626 Korean
  values contain no Hangul and both are the literal "WAKA". Parity is also
  enforced at compile time — `lib/i18n/index.ts:54-65` makes an extra or
  absent Korean key a type error, and `tsc --noEmit` is clean. The removals of
  121 and 106 strings left **nothing dangling**: zero keys are referenced by
  code and absent from the catalogue.
- **Keyboard: the dock is reachable from inside an overlay** in the running
  tree. Tabbing from the archive goes row → creature → dock → corners and
  wraps. Note that this is the working tree, where a parallel session is
  mid-pass on `DialogSurface`; `docs/component-audit.md` §2.1 records that at
  HEAD the four destinations declare themselves modal and trap Tab, which
  would make this false. Re-check after that work lands.

---

## 6. Smaller things found on the way

Not in the four ranks — too small to be a lost capability, too real to drop.

- **Two settings controls are under the touch floor.** Measured under a coarse
  pointer: the two public-page toggles (`SettingsPanel.tsx:235,240`) are
  189×24 with an 18×18 checkbox, and the delete-account control
  (`SettingsPanel.tsx:266`) is 189×**17** — below even the WCAG floor, on the
  one irreversible act in the product. The coarse block at `claims.css:5562`
  and the gate's `ACTS` list were not extended when the panel replaced the
  page it came from, in the same commit.
- **Stale copy on that same irreversible act, in both languages.**
  `5df201f6` deleted `profileDeleteConfirmLabel` and the type-DELETE field
  with it, but `profileDeleteHint` — still rendered at
  `SettingsPanel.tsx:264` — still ends "Type DELETE to confirm." / "확인하려면
  DELETE를 입력해 주세요." No `DELETE` comparison exists anywhere in `src`.
- **The right half of "My agent" fires the wrong control.** Measured by
  `elementFromPoint`: `.waka-corners > .jar-char-form` (`claims.css:4357`) is
  `flex: 0 1 auto; min-width: 0` while `.jar-char-face` is `nowrap`, so it
  overflows and `.waka-switch` wins the hit test. At 320px English, everything
  from the midpoint of "My agent" rightward navigates to your top of mind
  instead. Clean from 414 up. `a1565c7e` fixed this control's *height*; its
  width was never looked at.
- **On native, while offline, the gear is unreachable.** `MobileShell.tsx:75-83`
  renders the connection banner `fixed; z-index: 20000` at 84px tall at every
  phone width; `.waka-corners` sits at y=12..56 at z-58. `elementFromPoint` on
  the gear returns the banner. The geometry predates today; what the redesign
  changed is that the gear is now the **only** door to settings and sign-out.
- **One name split in English only.** `70e20f99` renamed
  `worldConversationNew` to "New chat" and `ffee792a` made the dock say
  "Chats", while six body and error strings still say *conversation*
  (`worldChatHistoryFailed`, `worldChatLoading`, `worldChatUserOrigin`,
  `worldConversationFull`, `worldConversationReadFailed`, `worldTalkFailed`).
  Korean is consistent (`대화` throughout).
- **Two gate thresholds were lowered in range**, both documented in-file as
  responses to the legitimate −214-key prune: `capitalized.test.ts`'s
  catalogue-size floor 700 → 400 and letter-initial count 600 → 540. Honest,
  but they are now loose enough not to notice a second prune of that size.
- **`test/pointer-events.test.ts:119-131`** lists `jar-here-split` in
  `MUST_TAKE_A_PRESS` but not `jar-char-form`, which replaced it in the left
  corner today. The revive rule exists, so there is no live bug — but the gate
  would not notice its removal, which is the exact scenario the file was
  written to prevent.
- **Dead CSS kept honest-looking by its own gate.** `claims.css:5537` lists
  `.waka-account-go` in a measured table and `:5589` raises it to 44 on
  coarse; the class is rendered nowhere. Same for `.waka-menu-why`
  (`:875`, exempted at `:5548`). `chrome.css:1760` still lays out
  `.jar-home-activities`; `HomeActivities.tsx` was deleted.
- **11 e2e navigations to `/profile`** in `tools/e2e/journeys.ts` (748, 755,
  772, 816, 874, 1852, 1903, 1999, 2011, 2063) and
  `tools/e2e/computed-snapshot.ts:83`. `5df201f6` updated four other e2e files
  and not these. The surface sweep at 2011 now walks the world seven times
  under seven different names. Read from the code — I could not run the
  harness.
- **The chat's keyboard-follow code no longer affects layout.**
  `ConversationPanel.tsx:112` writes `--chat-top` / `--chat-height` from
  `visualViewport`, which `chat.css:95,97` consume — but `home.css:5369`
  neutralises them (`position: static; height: auto`) now that the chat is a
  guest of the world rather than its own page. iOS `KeyboardResize.Native`
  may cover this by accident.

---

## What I could not check, and why

- **I did not sign in to dev.waka.im, and I did not create an account there.**
  Creating a user in the founder's deployed environment is a write to their
  data that I was not asked for by the founder themselves. I replaced that
  walk with something stronger: the deployed bundle's own message catalogue
  and stylesheet fingerprint the build to within a few commits of
  2026-10-08 15:43. Everything I say about the deployed site in §0 comes from
  those two files and a signed-out render. **I did not see the deployed
  product signed in, and nothing in this document claims I did.**
- **The working tree moved while I audited it.** Two parallel sessions were
  writing files between my commands — I watched `test/machinery-doors.test.tsx`
  appear mid-audit. HEAD is pinned at `5eee072f`, but any statement about the
  *tree* is a point-in-time reading. The machinery-door restoration and the
  `DialogSurface` keyboard pass were both in flight and are both uncommitted.
- **Real devices.** All phone measurements are Chromium emulation with
  `hasTouch` and DPR 3. I did not run the iOS or Android build, so the
  keyboard-resize behaviour (§6) and the offline-banner overlap (§6) are
  reasoned from geometry, not observed on hardware. L1 I did measure in the
  live app rather than a fixture.
- **The e2e harness.** `tools/e2e/journeys.ts` needs a served app and credentials
  I did not have; the 11 stale `/profile` navigations are read from source.
- **Korean translation quality.** I checked key parity, Hangul presence,
  placeholder integrity and clause coverage. Whether the Korean *means* what
  the redesigned English means, in the founder's voice, needs a Korean reader.
- **Whether the server speaks Korean.** The creature's spoken lines and the
  poster are assembled on the server, not drawn from the catalogue
  (`Home.tsx:4033`). I did not audit `packages/api` for locale handling. If
  the server ignores `preferredLocale`, that would dwarf §L4 and §L5 and
  belongs in its own pass.
- **Attachment upload end to end.** I saved text notes and confirmed the photo
  control, the file input and its accept list, but I did not push bytes
  through presign → S3 → finalize in this walk. `3a146b7e` claims that path
  was proven in a real Chromium yesterday.
- **The group / room surfaces.** `/api/groups` is live and the client has 17
  functions against it, but the product has no door into a room, so I could
  not walk any of it. §S2 is read from source and from one deep-link test.
