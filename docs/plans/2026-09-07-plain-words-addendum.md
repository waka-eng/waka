# Plain words — addendum, verified against `dev` at 2026-09-07

The proposal in [`2026-08-28-plain-words.md`](2026-08-28-plain-words.md) was
audited against the tree at `9bf82f6`. **52 commits have landed on `dev`
since.** This addendum re-verifies every load-bearing claim, mechanically,
against `origin/dev` at `b9c4cd9`.

**Verdict: the proposal stands, and four of the ten days' changes strengthen
it. Two premises moved and need folding in before tier 1 is applied.**

## Still true (re-verified, not assumed)

- **22 of the 23 audited UI strings are still on screen, verbatim.** The one
  exception moved rather than died: "Making it private takes it off your
  rooms' ground" now lives in the i18n catalog with a typographic apostrophe.
- **`GLOSSARY.md` is untouched** — still the 2026-08-22 three-dialect version,
  still carrying the ban list that forces the coinage, still listing
  `campfire` (a word that appears nowhere in the repo) and `dormant_at` (a
  state the schema does not have).
- **Both gates are unchanged.** `check-vocabulary.mjs` still forbids
  `capture` and `pattern` in identifiers; `test/copy.test.ts` still holds the
  `CANON_IN_COPY` table the transition would extend.
- **The canon is unchanged**: `inspirations` and `signals` are still the
  layer-1 and layer-2 nouns in the schema, routes, and `docs/data-model.md`.
- **Both pre-existing inconsistencies are still live**: the UI still says
  "this pattern in your own words" and "Failed to save this capture" while
  the gate forbids both words in identifiers.

## Already done by someone else

- **`index.html` is deleted** (−4,283 lines). The proposal's out-of-scope
  recommendation is satisfied; drop that paragraph when applying.

## What changed, and what it costs the plan

**1. Korean shipped, and it calques every metaphor.** Founder ruling
2026-08-31 reversed the English-only ruling of 2026-08-22 that the glossary
is built on; `ko-KR.json` is now at full key parity with `en-US.json`, and
the locale drives what the *memory itself* is written in, not just chrome.
The metaphors were translated literally:

| English | Korean | reads in Korean as |
|---|---|---|
| your own ground | 내 땅 | "my land" — territory, real estate |
| Whose inspirations are on the ground | 이 땅의 영감은 누구의 것인가 | "whose are this land's inspirations" |
| signal | 신호 | a traffic signal / an electronic signal |
| the weather | 날씨 | the weather forecast |

This is the single strongest new argument for the proposal: **plain words
translate; coined metaphors calque into nonsense.** The team already fought
this exact battle once — commit `0c885a9`, "Korean that sounds like a person:
the 당신-calque goes, and the copy breathes" — and won it for pronouns while
`ground → 땅` survived untouched.

*Cost to the plan:* tier 1 doubles — every renamed string needs its Korean
counterpart, and the new GLOSSARY needs a Korean column back (not as a
*dialect*, but as the same word translated). This is not a reason to delay:
every day of Korean copy written against the old vocabulary is a string that
gets rewritten twice.

**2. Copy moved out of `Home.tsx` into the i18n catalog.** The proposal's
`Home.tsx:NNNN` line references are stale — the strings now live under keys
(`worldPrivateTooltip`, `worldWhoseGround`, `worldDeleteWarn`,
`worldUnpublishWarn`, `worldValuesSubSelf`, …). This makes tier 1 **easier**:
the renames are now mostly a two-catalog edit rather than a JSX hunt. Twelve
catalog strings carry a metaphor word.

**3. A coined word reached the schema — the drift the proposal predicts.**
`keeper_keys` is now a **database table** (`schema-keeper-keys.ts`, "the
human's own standing credential"). "Keeper" is a product metaphor for the
human, and the current glossary's own principle 3 forbids exactly this: the
data layer is supposed to be boring infrastructure English, no metaphors. It
is not user-visible, so it costs nothing today — but it is proof that the
dialect boundary does not hold on its own, which is the proposal's thesis.

**4. Layer 4 gained a second user-facing name.** The sky now labels itself
**"philosophies & values"** (`worldPhilosophiesValues`) while the profile
surface, the aria labels, and the API still say **"principles"**. Commit
`94d9fa3` retired "how you choose" — the plain line the glossary gave
principles, and the one the proposal's draft table keeps. One concept, two
user-facing names, three words where one worked. This is a new decision the
founder made deliberately, so it is a **fifth fork**, not a defect to fix
silently.

## Consequent changes to the proposal

1. The rewritten `GLOSSARY.md` regains a Korean column — the same word,
   translated, not a separate dialect. Principle 1 becomes: *one word per
   concept per language; the explanation line translates with it.*
2. Add a sixth principle: **a name must survive translation.** A metaphor
   that calques into nonsense fails the mom test in the other language, which
   is the same test.
3. The string table is re-keyed to i18n keys (done above for the twelve that
   moved); each row gains a Korean cell.
4. Tier 1's scope note: strings + both catalogs + `GLOSSARY.md` + the copy
   tests. Still roughly a day, now two catalogs wide.
5. Drop the `index.html` paragraph.
6. **Fork 5 for the founder:** layer 4 is called **principles** everywhere,
   or **philosophies & values** everywhere. Recommended: *principles* — it is
   the canon word, the API word, one word instead of three, and it already
   translates cleanly (원칙). "Philosophies & values" is a good *subtitle*
   and a poor *name*.

*Verification method: `git archive origin/dev` into a scratch tree, then
literal-string greps for each audited string and a JSON pass over both
catalogs. No claim in this addendum is carried over from the 08-28 audit
without being re-checked.*
