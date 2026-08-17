/**
 * What a caller may put into layer 1, and what the server refuses.
 *
 * Every schema the inspiration routes check a request against lives here. One
 * file rather than one-per-handler because the question a reviewer actually
 * asks is "what can a client write into a capture row" — and answering it by
 * searching eight handlers is how a field gets accepted somewhere nobody
 * looked. Kept together, the whole accepted surface is one screen.
 *
 * These schemas decide only whether a payload is well-formed. They never
 * decide *whose* memory it lands in, or whether this session may write there —
 * that is `inspirations-tenancy.ts`, deliberately a separate question, because
 * a perfectly valid payload can still be one this session is not allowed to
 * send. Anything that reads as an authorization rule does not belong in this
 * file.
 */

import { z } from "zod";

import {
  inspirationKindValues,
  inspirationSourceValues,
  inspirationVisibilityValues,
} from "../db/index.js";

const MAX_TEXT_CHARS = 8192;
const MAX_REFLECTIONS_PER_CAPTURE = 3;

export const reflectionInputSchema = z.object({
  question: z
    .string()
    .trim()
    .min(1, "Reflection question is required")
    .max(4096, "Reflection question is too long"),
  answer: z
    .string()
    .trim()
    .max(MAX_TEXT_CHARS, "Reflection answer is too long")
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  /** A question offered and declined, which differs from never being asked. */
  skipped: z.boolean().optional(),
});

/**
 * Capture payload.
 *
 * Absent by design: `profileId` (the server decides the owner), `id` and the
 * timestamps (generated), and anything belonging to layer 2 — a client cannot
 * hand itself a signal.
 */
export const createInspirationSchema = z.object({
  text: z
    .string()
    .trim()
    .min(1, "Inspiration text is required")
    .max(MAX_TEXT_CHARS, "Inspiration text is too long"),
  kind: z.preprocess(
    (v) => (typeof v === "string" ? v.trim() || undefined : v),
    z
      .enum(inspirationKindValues, {
        errorMap: () => ({ message: "kind must be note, link, image, or mixed" }),
      })
      .optional(),
  ),
  /** Honored only for an agent session — see the provenance note in `inspirations.ts`. */
  source: z
    .enum(inspirationSourceValues, {
      errorMap: () => ({ message: "source must be app or agent" }),
    })
    .optional(),
  /**
   * Whether this capture may appear in the fields of rooms this account is in.
   * Optional, and its absence means `private` — the column default does the
   * work, so a client that has not been updated cannot accidentally publish
   * anything by omission.
   *
   * Accepting the field here is not the same as honoring it. Whether a
   * *requested* visibility is applied depends on who the capture is being
   * written for, which is `visibilityForCapture` in `inspirations-capture.ts`.
   */
  visibility: z
    .enum(inspirationVisibilityValues, {
      errorMap: () => ({ message: "visibility must be private or public" }),
    })
    .optional(),
  reflections: z
    .array(reflectionInputSchema)
    .max(MAX_REFLECTIONS_PER_CAPTURE, "Too many reflections for one capture")
    .optional(),
});

export type CreateInspirationInput = z.infer<typeof createInspirationSchema>;

export const updateInspirationSchema = z
  .object({
    text: z
      .string()
      .trim()
      .min(1, "Inspiration text is required")
      .max(MAX_TEXT_CHARS, "Inspiration text is too long")
      .optional(),
    // Nullable so a caller can clear a value it previously set; omitting the
    // key leaves it alone.
    kind: z
      .union([
        z.preprocess(
          (v) => (typeof v === "string" ? v.trim() || null : v),
          z.enum(inspirationKindValues, {
            errorMap: () => ({ message: "kind must be note, link, image, or mixed" }),
          }),
        ),
        z.null(),
      ])
      .optional(),
    /* CHANGING YOUR MIND IS THE POINT. A decision made in the second after
       writing something down is the worst moment to make it permanently, so
       visibility is editable in both directions for as long as the capture
       exists. Closing one again removes it from every room field at once —
       there is no copy anywhere else to chase. */
    visibility: z
      .enum(inspirationVisibilityValues, {
        errorMap: () => ({ message: "visibility must be private or public" }),
      })
      .optional(),
  })
  // A payload naming no editable field would silently bump `updated_at` for a
  // no-op, which misleads anything sorting by it.
  .refine(
    (v) => v.text !== undefined || v.kind !== undefined || v.visibility !== undefined,
    {
      message: "At least one of text, kind or visibility must be provided",
      path: ["text"],
    },
  );

export const DEFAULT_LIST_LIMIT = 80;
const MAX_LIST_LIMIT = 200;

/**
 * Strict on purpose: a mistyped parameter is a silently wrong answer. A caller
 * that asks for `?search=` and receives the unfiltered archive has been told
 * something false about its own memory.
 */
export const listQuerySchema = z
  .object({
    q: z.string().trim().max(200, "q is too long").optional(),
    limit: z
      .string()
      .regex(/^\d+$/, "limit must be a whole number")
      .transform((v) => Number.parseInt(v, 10))
      .refine(
        (v) => v >= 1 && v <= MAX_LIST_LIMIT,
        `limit must be between 1 and ${MAX_LIST_LIMIT}`,
      )
      .optional(),
    cursor: z.string().min(1).max(200, "cursor is too long").optional(),
    profile: z.string().uuid("profile must be a uuid").optional(),
  })
  .strict();

export const profileQuerySchema = z
  .object({ profile: z.string().uuid("profile must be a uuid").optional() })
  .strict();

export const uuidSchema = z.string().uuid();
