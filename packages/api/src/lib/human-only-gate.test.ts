/**
 * THE HUMAN-ONLY PREDICATE IS WRITTEN IN ONE PLACE, AND THIS IS WHAT MAKES
 * THAT TRUE.
 *
 * `humanSessionsOnly` exists and is correct, and nine handlers across five
 * route files still hand-rolled it — `session.profile.type !== "human"`, every
 * one of them missing `|| session.keyScoped`. The omission is not carelessness;
 * it is what the predicate looks like when you write it from the sentence in
 * your head. "This is for people, not agents" is a statement about profile
 * type, so profile type is what gets compared, and the keeper key — a standing
 * credential bound to the HUMAN profile, marked `keyScoped` — walks straight
 * through it. Nine for nine. A helper nobody is required to call is a helper
 * that documents the rule rather than enforcing it.
 *
 * So the rule is enforced from outside the call sites: no source but
 * `lib/middleware.ts` may compare a session's profile type to "human" unless
 * the same expression also reads `keyScoped`. That carve-out is not a
 * loophole, it is the point — a handler whose refusal is CONDITIONAL rather
 * than the whole door cannot use a middleware, and
 * `routes/inspirations-capture.ts` is the live example: only
 * conversation-sourced saves are refused, and it names both halves. Naming
 * both halves is the behaviour this gate is trying to make unavoidable.
 *
 * WHAT IT DELIBERATELY DOES NOT BAN, for the reason prompt-fence.test.ts had
 * to stop banning `>>>`: the bare token `session.profile.type`. Classifying a
 * caller is a legitimate, non-authorizing use of it — `inspirations-capture.ts`
 * stamps an inspiration's `origin` from it — and a gate that flagged that
 * would be a gate someone turns off. "human", the gate word, is what is
 * narrowed to.
 *
 * WHAT THIS MOCKS, AND WHY: nothing. It reads the real source files off disk,
 * which is the only way a rule about where a comparison may be written can be
 * checked — a fixture would be asserting the rule against a copy of itself.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");
/** The module that owns the predicate, and the only file allowed to write it. */
const OWNER = join(SRC, "lib", "middleware.ts");

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sources(path, out);
    else if (path.endsWith(".ts") && !path.endsWith(".test.ts")) out.push(path);
  }
  return out;
}

/**
 * Comments may name the predicate — several of them explain at length why it
 * must not be hand-rolled. Blanking a comment keeps its newlines so the line
 * numbering below still belongs to the file, and so a `keyScoped` mentioned in
 * prose can never vouch for a comparison in code.
 */
const withoutComments = (code: string): string =>
  code
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
    .replace(/\/\/[^\n]*/g, " ");

/**
 * A session's profile type weighed against "human". Spacing is tolerated
 * because this file is read by a regex and written by hand; `!==` and `===`
 * both count, since "refuse unless human" and "allow if human" are the same
 * gate with the branches swapped.
 */
const HUMAN_GATE = /session\s*\??\s*\.\s*profile\s*\.\s*type\s*[!=]==\s*['"]human['"]/;

/**
 * Same LINE, not same file: a guard's condition is written on one line here,
 * and asking for `keyScoped` within the whole file would let any unrelated
 * mention of it vouch for a gate a hundred lines away. A condition broken
 * across lines will trip this, and the fix for that is the same as the fix for
 * everything else it catches — call the middleware.
 */
function handRolledLines(source: string): number[] {
  return withoutComments(source)
    .split("\n")
    .flatMap((line, index) =>
      HUMAN_GATE.test(line) && !line.includes("keyScoped") ? [index + 1] : [],
    );
}

describe("where a human-only gate may be written", () => {
  it("appears in no source but the module that owns it", () => {
    const offenders = sources(SRC)
      .filter((path) => path !== OWNER)
      .flatMap((path) =>
        handRolledLines(readFileSync(path, "utf8")).map(
          (line) => `${path.slice(SRC.length + 1)}:${line}`,
        ),
      );

    expect(
      offenders,
      "a human-only gate was hand-rolled outside lib/middleware.ts. Use the " +
        "`humanSessionsOnly` middleware: a keeper key's session IS the human " +
        "profile and passes a profile-type comparison, so the inline form hands " +
        "a credential sitting in an MCP config file the account decisions the " +
        "2026-08-29 ruling put behind the person at a browser. If the refusal is " +
        "conditional rather than the whole door, name `session.keyScoped` in the " +
        "same expression.",
    ).toEqual([]);
  });

  /* The gate is only as good as what it recognises, so the shapes it must
     catch are asserted directly rather than trusted. Each of these is a
     spelling that appeared in, or one character away from, the nine. */
  it.each([
    'if (session.profile.type !== "human") return deny();',
    "if (session.profile.type !== 'human') return deny();",
    'if (session.profile.type === "human") { allow(); }',
    'if (session.profile.type!=="human")return deny();',
    "const ok = session?.profile.type === 'human';",
  ])("recognises %s", (line) => {
    expect(handRolledLines(line)).toEqual([1]);
  });

  it.each([
    /* The conditional-refusal carve-out, as inspirations-capture.ts writes it. */
    "if(fromConversation&&(session.keyScoped||session.profile.type!=='human'))return deny();",
    /* Classification, not authorization. */
    'const origin = session.profile.type === "agent" ? "agent" : "app";',
    /* A profiles ROW, not a session — mobile-handoff.ts checks what it loaded. */
    "if (profile?.type !== 'human') throw new Error('needs a human profile');",
    /* Prose may say it as often as it likes. */
    '/* session.profile.type !== "human" is not written by hand */',
    '// session.profile.type !== "human"',
  ])("leaves alone %s", (line) => {
    expect(handRolledLines(line)).toEqual([]);
  });
});
