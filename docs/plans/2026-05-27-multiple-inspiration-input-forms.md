# Multiple Inspiration Input Forms MVP Spec

Plan status: HISTORICAL. The current input scope and implementation task list are in [WAKA personal experience tasks](2026-10-02-personal-experience-tasks.md). The file paths and pre-rebuild data model below are retained as historical context, not current implementation instructions.

Goal:
- Support a bounded set of inspiration input forms beyond plain text while preserving the two existing user journeys: Quick Capture for fastest save, and Process for richer guided context.
- MVP input types: text/note, URL/link, image upload, and image URL. Treat combinations as one inspiration with optional attachments when already supported by the existing capture architecture.

Non-goals:
- No classifier/WOW/meaning-graph redesign and no user-facing debug/classifier terminology.
- No public discovery/WOW claims based only on unfetched URL/image metadata; downstream insight surfaces must remain source-grounded and conservative.
- No generic file expansion beyond existing attachment support; this MVP should intentionally emphasize image/link/note.
- No OCR, image captioning, URL scraping, bookmark enrichment, or multi-step import pipeline in this slice.
- No destructive DB operations or tenant-scope relaxation.

Assumptions from repo inspection:
- The current capture UI already has two visible actions in `packages/web/src/components/capture/CaptureCell.tsx`: `Process this inspiration` and `Quick save`.
- `CaptureForm` currently persists a required `text` field first, then saves pending link/image/file attachments through `packages/web/src/lib/api.ts` and `packages/api/src/routes/attachments.ts`.
- Attachment-only saves currently send the text sentinel `(attachment-only inspiration)` from `CaptureForm.tsx`; this is the main user-visible/product text-only assumption to remove or hide.
- The API create route in `packages/api/src/routes/inspirations.ts` requires non-empty `text` and exposes only `text`, optional `kind`, `category`, selected spark fields, and sparks. The DB `inspirations.text` column is `NOT NULL` in `packages/api/src/db/schema.ts`.
- Attachments already support `link`, `image`, and `file` rows in `packages/api/src/db/schema-attachments.ts`; S3 uploads are presigned and user-namespaced in `packages/api/src/routes/attachments.ts`.

Implementation handoff for dev-a:
- Scope:
  1. Introduce an explicit capture input summary layer so non-text inspirations do not leak the sentinel `(attachment-only inspiration)` into list/detail/UI copy.
  2. Keep the existing two journeys, but make the trigger behavior type-aware:
     - Quick Capture: one click or Cmd/Ctrl+Enter save. Accept note text, pasted URL, image file upload, image URL, or combinations. Do not force reflection, labels, prompts, enrichment, or processing steps.
     - Process: enter the existing reflection view, with copy that can vary by detected primary input type. It may ask one follow-up/context question before saving.
  3. Reuse existing attachment infrastructure for URL/link and image upload. For image URL, save it as a `link` attachment for this MVP unless an existing image-URL rendering path is trivial and covered by tests.
  4. Add typed client request metadata only if needed for rendering and validation: prefer a small union such as `inputType: "note" | "link" | "image" | "mixed"` or reuse `kind` with those bounded values. Do not create broad free-form media semantics.
  5. Preserve `inspirations.text` as the canonical searchable/processable text column for now. For attachment-only captures, store a short non-debug fallback such as `Image inspiration` or `Link inspiration`, but render the richer attachment chip/preview wherever available.

- Suggested files/areas to inspect and modify:
  - `packages/web/src/components/capture/CaptureForm.tsx`: primary save flow, pending attachment model, URL extraction, attachment-only fallback text, Process vs Quick behavior.
  - `packages/web/src/components/capture/CaptureCell.tsx`: user-facing labels, placeholder, file input accept behavior, accessibility labels for both journeys.
  - `packages/web/src/components/capture/index.ts`: exported types if new capture input types are introduced.
  - `packages/web/src/lib/api.ts`: `CreateInspirationRequest`, `ApiInspiration`, and attachment API types.
  - `packages/api/src/routes/inspirations.ts`: create schema, response type, persistence of optional bounded `kind`/`inputType`, tenant-scoped create/list behavior.
  - `packages/api/src/db/schema.ts` and Drizzle migrations: only if adding a durable bounded column. Prefer using existing `kind` first to minimize DB risk.
  - `packages/api/src/db/schema-attachments.ts` and `packages/api/src/routes/attachments.ts`: verify existing link/image validation and user ownership are sufficient; avoid broadening upload policy unless tests require it.
  - `packages/web/src/components/InspirationCard.tsx`, `packages/web/src/components/history/InspirationDetail.tsx`, and `packages/web/src/components/InspirationsBoard.tsx`: preview/display of non-text captures in cards, history, and detail surfaces.
  - `packages/web/src/lib/locales.ts`: user-facing copy for placeholder, quick save, process prompt, validation, errors.
  - Tests: `packages/web/test/Home.test.ts`, `packages/web/test/api.test.ts`, add capture-focused tests if none exist; `packages/api/test/inspirations.test.ts`, `packages/api/test/attachments-presign.test.ts`.

- User-visible copy/flow:
  - Placeholder: keep broad but simple, e.g. `A note, link, or image — whatever is inspiring you right now…`.
  - Buttons stay distinct:
    - `Quick save`: saves immediately.
    - `Process this inspiration`: opens guided context/reflection.
  - Quick Capture behavior:
    - Text only: save trimmed note.
    - URL only: save a link inspiration with link chip; no extra prompt.
    - Image upload only: show thumbnail chip, save image inspiration; no extra prompt.
    - Image URL: treat as URL/link chip and label as link/image URL only if confidently derived from URL extension or content type already available without fetching.
    - Mixed text + link/image: save note text plus attachments.
  - Process behavior:
    - Text: current reflection question can remain, e.g. `What made this worth saving?`.
    - Link/image/image URL: ask for optional context, e.g. `What caught your attention here?`.
    - Mixed: ask one general context question; do not add multiple mandatory steps.
  - Error copy:
    - Empty save: no-op or gentle `Add a note, link, or image to save.`
    - URL validation: `That link does not look valid. Check it and try again.`
    - Upload validation: `This image is too large or not supported.`
    - Partial attachment failure: preserve current pattern, e.g. `Saved — 1 attachment failed`; the inspiration must remain visible.

- Acceptance criteria:
  1. Quick Capture saves text-only, URL-only, image-upload-only, image-URL-only, and mixed text+attachment inspirations without requiring reflection/context.
  2. Process remains a separate guided path and asks at most one follow-up/context question before saving; Quick Capture never enters that flow.
  3. Non-text saves do not show `(attachment-only inspiration)` anywhere in user-facing list/detail/history/card UI.
  4. API validation accepts the bounded MVP input metadata if introduced, rejects unsupported input kinds with 400, and continues to derive `userId` only from auth context.
  5. Existing attachment ownership/security remains intact: link/image rows are tied to the caller-owned inspiration; S3 keys stay server-generated and user-namespaced.
  6. Text limits and upload limits remain enforced: inspiration text max 8 KB; upload max remains 25 MiB unless a separate product decision changes it.
  7. Attachment finalization failure does not delete or hide the saved inspiration; the UI indicates which attachment failed and allows a future retry path without retyping the note.
  8. Existing text-only create/list flows, reflections, sparks, score display, and WOW/meaning graph processing still work.
  9. Korean/English locale strings remain available for any changed capture/validation copy.

- Verification:
  - Web unit/component tests:
    - Add/extend tests proving `Quick save` calls `createInspiration` immediately for URL-only and image-only pending states.
    - Add a regression test that user-facing rendered text never contains `(attachment-only inspiration)` after image-only save.
    - Add a Process test proving `Process this inspiration` opens reflection/context and `Quick save` does not.
    - Add URL extraction/dedup tests for typed/pasted URLs and image URL strings.
  - API tests:
    - Extend `packages/api/test/inspirations.test.ts` for bounded `kind`/input metadata, invalid kinds, tenant-scoped persistence, and backwards-compatible text-only create.
    - Keep/extend attachment presign/finalize tests for image upload constraints and ownership.
  - Manual smoke:
    - Run local app and save: note, URL, image upload, image URL, mixed note+URL.
    - Confirm history/detail cards display useful previews/chips, not debug placeholders.
    - Confirm Process asks context, Quick Capture does not.
  - Commands:
    - `pnpm --filter @waka/web test`
    - `pnpm --filter @waka/web typecheck`
    - `pnpm --filter @waka/api test`
    - `pnpm --filter @waka/api typecheck`

Risk/review notes:
- Risk tier: standard, with DB/API and upload/security touchpoints.
- API/DB risk: `inspirations.text` is currently required and classifier/embedding code may assume meaningful text. Prefer minimal fallback text plus attachment previews in this slice; only add schema if existing `kind` is insufficient.
- Auth/tenant risk: all inspiration and attachment reads/writes must stay scoped to `c.get("user").id`; clients must not pass `userId`.
- Upload/security risk: do not broaden accepted MIME types or file size limits casually. Existing presigned PUT flow should remain API-byte-proxy-free.
- Persistence risk: if `kind` is used for bounded input type, document/validate allowed values so future free-form usage does not leak into product logic.
- UX risk: Quick Capture must not become slower or more reflective; Process must not become a hidden required step.
- Classifier/insight risk: do not claim image/link meaning unless supplied by user text/reflection or future source-grounded extraction.
- Reviewer focus for review-a:
  - Verify the two journeys remain distinct in code and UI.
  - Check no debug placeholder/sentinel leaks to users.
  - Check bounded validation and tenant ownership in API/attachments.
  - Check no upload policy broadening or destructive migration.
- QA focus for qa-a:
  - Exercise all MVP input forms in both journeys.
  - Confirm graceful errors and partial attachment failure messaging.
  - Confirm locale copy and accessibility labels for buttons/file input.

Open questions/blockers:
- None for MVP. If dev-a finds existing `kind` is overloaded in a way that makes bounded input metadata unsafe, escalate with a small schema proposal before adding a migration.
