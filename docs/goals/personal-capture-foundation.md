# Personal capture foundation

Status: in progress (2026-10-02), explicitly started by the owner.
Branch: `codex/personal-capture-foundation`, based on `59aab90` and the navigation/search work in PR #334.

## Objective

Complete the first bundle agreed in [the personal experience task list](../plans/2026-10-02-personal-experience-tasks.md): A01, A02, C01, C02 and A03. The exact acceptance criteria in that document remain authoritative. The older all-app backlog remains outside this goal.

## Gates

1. A01: document the ownership and mutation rules for raw capture, audio, transcription, reflection, review, conversation and exported cards. Work through a concrete example and amend the canon/glossary before adding identifiers.
2. A02: inspect desktop/mobile screen proposals for home, capture, inspiration detail, review, principle detail/sharing and avatar. Cover empty/loading/saving/error/return states and navigation. Design proposals for later features are not claims that those features work.
3. C01/C02: one composer accepts text, links, images and a recording, including attachment-only inputs. Save and continue-thinking use one durable save identity. The server confirms the inspiration and its requested attachments together. Failed upload/save retains the owned draft; response loss, retry and account change do not duplicate or disclose it. Verify meaningful API, persistence, component and browser cases.
4. A03: measure recording, playback, upload, permission denial and interruption on actual iPhone Safari and Android Chrome; evaluate Korean, English and mixed speech and record latency/cost/provider/format choices. Record a bounded Capacitor probe for recording, photo selection, sharing and login. Device emulation or a simulator does not satisfy the actual-device requirement.

The goal is complete only with evidence for every gate. Missing devices or provider access are explicit verification gaps, not grounds to reduce a gate. Continue independent work while gathering the missing evidence.

## Verification and cost

Use targeted API/web typechecks and tests, migration checks for schema changes, and real browser inspection. SQL mutations use explicitly selected disposable loopback Postgres; the current `.env.local` is remote Neon and must not drive tests or migrations. State a bounded call count and estimated cost before paid speech evaluation; stop if cost exceeds twice the estimate.

## Log

### 2026 10 02 baseline

- Active thread objective confirmed: complete the first bundle, with no token budget.
- Existing local app listens on port 3010; it uses the configured remote database, so synthetic verification needs a separate local fixture.
- Existing inspiration create requires nonempty text. Links are finalized after capture through a best-effort call; the two writes do not share the existing authored-save identity.
- Attachment types are link/image/file; audio MIME types and transcription are absent.
- `adb devices -l`: no connected devices. Xcode device inventory: the physical iPhone is offline. Available iPhone simulators are supplemental evidence only.
- Pre-change authored-save/reflection baseline: 30/30 tests passed across three suites.

### A01 contract

The data and action contract is in [capture foundation contract](../plans/2026-10-02-capture-foundation-contract.md), including one worked photo/link/audio/reflection/review/export example. Canon and glossary explicitly separate currently implemented memory from approved future review/conversation/export records. The same immutable save identity covers the attachment manifest, with a scoped durable draft and atomic row commit. A02 still needs inspected screen proposals; A03 still needs real-device evidence.

A01 verdict: pass. The required contracts, concrete example, canon amendment and vocabulary entries are present. This says nothing about implementation of later review/chat/sharing features.

### C02 server foundation in progress

Added an optional attachment manifest to inspiration create and audio enum values in migration 0049. Empty authored text is allowed only with an attachment. Uploaded-byte ownership, exact length and MIME metadata are verified before the transaction commits; unverified objects fail rather than claiming a saved attachment. The existing request hash includes the manifest only when supplied, preserving old text-only request hashes. Replays bypass object HEAD and load current owned rows.

Verified: 18/18 targeted unit tests (six new attachment cases); 23/23 disposable-loopback SQL tests (five new bundle cases and eighteen existing save/recovery cases). New SQL cases prove atomic rollback, response replay, manifest conflict, owner isolation and deletion tombstones. API/web typechecks and migration consistency check pass. No remote migration or real account mutation performed. C01/C02 remain incomplete until the composer, durable media draft and browser checks are connected.
