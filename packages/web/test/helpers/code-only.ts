/**
 * READING SOURCE AS CODE, NOT AS PROSE — one home for a trick three gates
 * need.
 *
 * "A gate that reads its own documentation as evidence reports work that was
 * never done" (`phone-breakpoints.test.ts:82-85`, which learned it the hard
 * way, as did `type-scale.test.ts` and `check-seams.mjs`). Those three blank
 * comments in CSS. This is the same move for TypeScript, and it is a helper
 * rather than a fourth copy because the two gates that need it — the
 * reachability ratchet and the dismissal ledger — ask the same question of
 * the same tree and would otherwise drift into two answers.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): nothing. Its callers read the source
 * tree off disk and hand it here as strings.
 */
/** Blanked CHARACTER FOR CHARACTER, newlines kept, so every offset in the
    file stays where it was and nothing silently joins two identifiers into
    one. The same trick `phone-breakpoints.test.ts:86` uses on CSS. */
export const blanked = (run: string): string => run.replace(/[^\n]/g, " ");

/**
 * THE FILE WITH ITS PROSE REMOVED — because a sentence is not a caller.
 *
 * `reachable.test.ts` had the defect in its sharpest possible form: its
 * question is literally "does any other file say this name", it asked it of
 * the raw bytes, and in this codebase other files say every name, in prose,
 * constantly. Its `PRIVATE_ENOUGH` note lists the five exports that were
 * being held alive by a sentence and by a filename.
 *
 * WHY A CHARACTER SCANNER AND NOT `replace(/\/\/.*$/gm, "")`. A line-comment
 * regex cannot tell `// why this is here` from the `//` inside
 * `"https://example.test"`, and blanking the rest of THAT line would delete
 * real code — a reference could vanish and this gate would then report a
 * live export as dead, which is the one failure mode worse than the one
 * being fixed here. So the walk below tracks whether it is inside a string
 * and only treats `//` and `/*` as comment openers when it is not. Strings
 * are left standing, because `foo["bar"]` and `` `${baz}` `` are references.
 */
export function withoutComments(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const here = text[i]!;
    const next = text[i + 1];
    if (here === "/" && next === "*") {
      /* Unterminated runs to end of file: that file does not compile, but
         this gate must not throw while telling you so. */
      const close = text.indexOf("*/", i + 2);
      const end = close === -1 ? text.length : close + 2;
      out += blanked(text.slice(i, end));
      i = end;
    } else if (here === "/" && next === "/") {
      const newline = text.indexOf("\n", i);
      const end = newline === -1 ? text.length : newline;
      out += blanked(text.slice(i, end));
      i = end;
    } else if (here === '"' || here === "'" || here === "`") {
      /* Kept verbatim, only skipped over, so that a `//` or a `/*` inside a
         string cannot open a comment. A backtick spans newlines; the other
         two do not, and an unterminated one ends at the line break rather
         than eating the file. */
      let j = i + 1;
      while (j < text.length) {
        if (text[j] === "\\") { j += 2; continue; }
        if (text[j] === here) { j += 1; break; }
        if (here !== "`" && text[j] === "\n") break;
        j += 1;
      }
      out += text.slice(i, j);
      i = j;
    } else {
      out += here;
      i += 1;
    }
  }
  return out;
}

/**
 * AND THE MODULE PATHS, because a filename is not a caller either.
 *
 * `space/inspiration/field.ts` imports from `"../../lib/aliveness"`, and that
 * string contains the word `aliveness`, which is also the name of a function
 * exported by `lib/data.ts` — a different file, a different formula, nothing
 * importing it. The word match could not tell the two apart, so a dead
 * duplicate of the product's central formula sat inside the budget with this
 * gate reporting green over it.
 *
 * Only the SPECIFIER is blanked, not every string: the quoted thing after
 * `from`, after a bare `import`, after `require(`, and after the `mock` /
 * `importActual` calls the tests use, each of which names a module and
 * nothing else. Every other string keeps its contents, for the reason given
 * above `withoutComments`.
 */
export const withoutModulePaths = (text: string): string =>
  text.replace(
    /(\bfrom|\bimport|\brequire|\bmock|\bimportActual)(\s*\(?\s*)("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')/g,
    (_all, keyword: string, gap: string, specifier: string) => keyword + gap + blanked(specifier),
  );

/** What this gate will accept as somebody naming a symbol: code, and only
    code. Comments and module paths out; strings and JSX in. */
export const evidence = (text: string): string => withoutModulePaths(withoutComments(text));
