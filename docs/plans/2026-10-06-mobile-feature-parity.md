# Mobile consumer feature parity

Status: M1 inventory complete; platform journeys remain to be verified.
Source baseline: dev `315328e` and the current shared React consumer app.

The matrix below defines acceptance cases. Sharing the UI alone does not mark
a native feature accepted. The separate admin application is outside scope.

| ID | Consumer feature | Acceptance on web iOS and Android | Native milestone |
| --- | --- | --- | --- |
| A01 | Signup and onboarding | Human account, language, onboarding and requested return route. | M2 |
| A02 | Password and Google sign-in | Success, rejection, cancellation, throttling and preserved destination. | M2 |
| A03 | Session and sign-out | Relaunch, expiry, revocation, identity switch and removal of scoped private state. | M2 |
| A04 | Profile and locale | Name/avatar/language edits persist; English and Korean render correctly. | M2/M5 |
| A05 | Public profile settings | Handle validation, opt-in switches, preview and public/private boundaries. | M2/M5 |
| A06 | Export and deletion | Export contents/download destination; confirmed deletion, cancellation and signed-out state. | M4/M6 |
| A07 | Sessions/connections | Inspect and revoke the intended connection while retaining others. | M2/M5 |
| C01 | Quick text and link capture | Original words/URL, selected profile, enrichment state and one saved original. | M2/M3 |
| C02 | Photos and camera | Single/multiple selection, capture/cancel, preview/orientation, format/size checks and denial recovery. | M3 |
| C03 | Recording and replacement | Start/stop/listen; five-minute limit; preserve prior clip until replacement is chosen. | M3 |
| C04 | Transcription and correction | Pending/ready/error, correction/retry and separate recording/transcription limits. | M3 |
| C05 | Mixed media and audience | Supported combinations and current server-controlled visibility/sharing rules. | M3/M5 |
| C06 | Drafts and uncertain saves | Relaunch/profile isolation, partial upload failure, expired ticket, duplicate tap and lost save response. | M3 |
| I01 | Field search/filter/detail | Current originals, dates, attachments, processing state and conversation origin. | M5 |
| I02 | Edit/remove original | Exact authored words, stale-version conflicts, confirmation/cancel and no resurrection. | M5 |
| I03 | Reflection conversation | Contextual questions, continued answers, scrolling, resumed drafts and reopened saved reflection. | M3/M5 |
| R01 | One-at-a-time Review | Start/resume selection, reflect, keep/skip, atomic Next, remove and finish/empty state. | M5 |
| R02 | Review evidence/results | Current source references, changed-source handling and processing outcomes. | M5 |
| T01 | Top of Mind and history | Current/versioned reading, why-this-read, evidence and loading/empty/queued/failed states. | M5 |
| T02 | Reading controls | Edit/lock/pin/dismiss/restore and explicit refresh with cadence/budget waits respected. | M5 |
| S01 | Patterns and evidence | Statements, original roots, feedback/restore and existing relation/duplicate controls. | M5 |
| P01 | Principles and feedback | List/status, wording edit, independent up/down order, contested state and restore. | M5 |
| P02 | Principle evidence and artifacts | Useful current examples, customized card/collection, preview, export/share and cancellation. | M4/M5 |
| Q01 | Chat history and lifecycle | Start/open/resume/delete, earlier messages, send/stop/retry and retained drafts/scroll. | M5 |
| Q02 | Chat context/citations | Clickable readings/principles, current/historical sources and changed/deleted memory. | M5 |
| Q03 | Corrections and capture from chat | Explicit correction, separately confirmed principle edit and owned saved thought/insight. | M5 |
| G01 | Existing rooms | Create/join/open/leave, membership/read errors and member/wall navigation. | M5 |
| G02 | Shared room memory | Share/unshare permitted signal statements; other members' raw evidence stays private. | M5 |
| G03 | Shared direction | Versioned direction, contributions/participation threshold, refinement/proposals and history. | M5 |
| M01 | Agent profiles | Create/rename/remove their own memory stacks and preserve human/profile boundaries. | M5 |
| M02 | Keys/grants/read record | Issue/reissue/copy/revoke agent/keeper keys, give/revoke sibling grants and inspect consultation record. | M2/M5 |
| U01 | Public profiles/deep links | Public opted-in content, unavailable states and owned destinations retained through login/Back. | M2/M5 |
| U02 | Copy/external destinations | Canonical web URLs, draft-word copying, safe external browser and touch equivalents for shortcuts. | M2/M4/M5 |
| U03 | Mobile layout/lifecycle | Keyboard-safe inputs, long-content scroll, safe areas, Back/rotation, resume/refetch and offline draft retention. | M3/M5 |
| U04 | Accessibility/preferences | Larger text, reduced motion, VoiceOver/TalkBack, focus and current locale. | M5 |
| U05 | Product explanations and pattern waiting states | Open the existing reading/how-it-works content, weather/antechamber information and global duplicate suggestions; preserve their current scope. | M5 |
| N01 | Share into WAKA | Supported incoming text/link/image becomes a durable unassigned or confirmed-profile draft. | M4 enhancement |

Source map: routes in `packages/web/src/main.tsx`; account, agent-key, keeper-key,
sibling-grant and read-record controls in `Profile.tsx` and Home's settings;
capture, reflection, Review, Principles and chat in their named components;
rooms, signals, timelines, search and wall navigation in `Home.tsx`; public
content in `PublicProfile.tsx`; current contracts in `src/lib/api/`.

Both native platforms currently have pending feature acceptance for these
cases. The existing web implementation/regressions are the comparison point;
each native integration must record platform/device/build evidence before its
status becomes accepted. Update this inventory as shared web functionality changes.
