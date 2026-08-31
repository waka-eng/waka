/**
 * THE JUDGE ON TRIAL — a fixed bench of pairs with known verdicts, so any
 * model swap is one command instead of a live-probe exercise:
 *
 *     WAKA_MODEL_JUDGE=<candidate> pnpm --filter @waka/api eval:judge
 *
 * The judge's one question is whether two statements name the same durable
 * pattern (docs/generation.md, the 0.70–0.86 band): its failure modes are
 * exactly two, and the bar below prices them the way the prompt does. A
 * missed merge leaves a visible duplicate a person can still merge; a
 * phantom OPPOSITION manufactures a dispute the person never had. So the
 * gate is: overall accuracy ≥ 80%, and ZERO invented oppositions — a model
 * that is right often but fabricates disputes loses outright.
 *
 * Half the bench is Korean, deliberately: the archive this product actually
 * holds is majority Korean, and English-only fixtures would certify models
 * on the easy half. The held-tension pairs come from the prompt's own
 * doctrine ("loves rich food" / "keeps weekday meals plain" — a tension a
 * person can HOLD is not an opposition).
 *
 * WHAT THIS MOCKS, AND WHY: nothing. The whole point is the live model
 * behind the default provider — whichever road the environment selects.
 * Excluded from the hermetic suite; run by CI's credentialed job and by
 * hand for candidate evals. Skips (visibly) when no model key is present.
 */
import { describe, expect, it } from "vitest";

import { getDefaultModelProvider } from "../src/lib/model-provider.js";

const HAS_KEY = Boolean(
  process.env.OPENROUTER_API_KEY?.trim() || process.env.GEMINI_API_KEY?.trim(),
);

interface Pair {
  a: string;
  b: string;
  expected: "same" | "independent" | "opposed";
  note: string;
}

const BENCH: Pair[] = [
  /* ---- same: rewording, narrowing, broadening ---- */
  { a: "Small, sharp tools beat grand systems.", b: "I keep choosing the smallest tool that works over big platforms.", expected: "same", note: "rewording (en)" },
  { a: "Deep work needs protected, unbroken blocks of time.", b: "My best output comes from long stretches without interruption.", expected: "same", note: "rewording (en)" },
  { a: "작은 도구가 큰 시스템을 이긴다.", b: "결국 항상 제일 단순한 도구로 돌아가게 된다.", expected: "same", note: "rewording (ko)" },
  { a: "기록은 그날 바로 남겨야 의미가 있다.", b: "하루가 지나기 전에 적어두지 않으면 기록의 가치가 사라진다.", expected: "same", note: "rewording (ko)" },
  { a: "Morning hours are my most creative time.", b: "Creative work goes best before noon.", expected: "same", note: "narrowing (en)" },
  { a: "나는 마감이 있어야 움직인다.", b: "Deadlines are what actually get me moving.", expected: "same", note: "same pattern across languages" },
  { a: "Walking helps me untangle hard problems.", b: "산책을 하면 막힌 문제가 풀리곤 한다.", expected: "same", note: "same pattern across languages" },
  { a: "I trust plain text files over apps.", b: "Everything important ends up in a plain text file eventually.", expected: "same", note: "broadening (en)" },

  /* ---- independent: shared vocabulary, different patterns ---- */
  { a: "Small, sharp tools beat grand systems.", b: "Deep work needs protected, unbroken blocks of time.", expected: "independent", note: "different objects (en)" },
  { a: "I love rich, heavy food.", b: "I keep weekday meals plain and simple.", expected: "independent", note: "held tension, the prompt's own example" },
  { a: "아침에 집중이 가장 잘 된다.", b: "저녁 산책이 하루를 정리해 준다.", expected: "independent", note: "different objects (ko)" },
  { a: "회의는 짧을수록 좋다.", b: "짧은 글이 긴 글보다 쓰기 어렵다.", expected: "independent", note: "shared vocabulary (short), different patterns (ko)" },
  { a: "I take notes to think, not to remember.", b: "I remember faces far better than names.", expected: "independent", note: "both about memory, different patterns" },
  { a: "혼자 일할 때 속도가 난다.", b: "피드백은 빠를수록 좋다.", expected: "independent", note: "work style vs feedback loop (ko)" },
  { a: "Coffee after 3pm ruins my sleep.", b: "Sleep quality decides the next day's mood.", expected: "independent", note: "adjacent, causal chain, not one pattern" },
  { a: "새로운 도구를 배우는 것 자체가 즐겁다.", b: "Small tools beat big platforms.", expected: "independent", note: "tools as joy vs tools as choice, cross-language" },
  { a: "I prefer written plans to spoken ones.", b: "Plans rarely survive first contact anyway.", expected: "independent", note: "preference vs skepticism — could gain separate evidence" },
  { a: "저는 결정을 미루는 편이다.", b: "결정을 내리면 뒤돌아보지 않는다.", expected: "independent", note: "before vs after a decision — both can be true (ko)" },

  /* ---- opposed: cannot both hold ---- */
  { a: "Mornings are my most productive hours.", b: "I am useless before noon; everything good happens at night.", expected: "opposed", note: "direct contradiction (en)" },
  { a: "혼자 일할 때 가장 성과가 좋다.", b: "혼자 일하면 성과가 잘 나지 않는다.", expected: "opposed", note: "direct contradiction (ko)" },
  { a: "Deadlines sharpen my work.", b: "Deadlines reliably make my work worse.", expected: "opposed", note: "same object, opposite pull (en)" },
  { a: "기록은 많을수록 좋다.", b: "기록은 최소한으로 줄여야 한다.", expected: "opposed", note: "same object, opposite direction (ko)" },
  { a: "I do my best thinking out loud with others.", b: "생각은 반드시 혼자 조용히 해야 정리된다.", expected: "opposed", note: "cross-language opposition" },
  { a: "Meetings are where decisions actually happen.", b: "Nothing is ever truly decided in a meeting.", expected: "opposed", note: "same object, cannot both hold (en)" },
];

/** A few at a time — polite to the provider, fast enough for CI. */
async function judgeAll(): Promise<Array<Pair & { got: string }>> {
  const provider = await getDefaultModelProvider();
  const out: Array<Pair & { got: string }> = [];
  const width = 6;
  for (let i = 0; i < BENCH.length; i += width) {
    const slice = BENCH.slice(i, i + width);
    const verdicts = await Promise.all(
      slice.map((pair) =>
        provider.judgeSignalMatch({
          preferredLocale: "en-US",
          candidateStatement: pair.a,
          existingStatement: pair.b,
        }),
      ),
    );
    slice.forEach((pair, j) => out.push({ ...pair, got: verdicts[j]!.relation }));
  }
  return out;
}

describe.skipIf(!HAS_KEY)("the judge, on the bench", () => {
  it(
    "clears the bar: ≥80% overall, zero invented oppositions",
    { timeout: 180_000 },
    async () => {
      const results = await judgeAll();
      const misses = results.filter((r) => r.got !== r.expected);
      const inventedOpposition = misses.filter((r) => r.got === "opposed");
      const accuracy = (results.length - misses.length) / results.length;

      for (const m of misses) {
        console.warn(
          `[judge-eval] MISS (${m.note}): expected ${m.expected}, got ${m.got}\n  A: ${m.a}\n  B: ${m.b}`,
        );
      }
      console.log(
        `[judge-eval] ${results.length - misses.length}/${results.length} correct (${Math.round(accuracy * 100)}%), invented oppositions: ${inventedOpposition.length}`,
      );

      expect(
        inventedOpposition,
        "a phantom opposition manufactures a dispute the person never had",
      ).toHaveLength(0);
      expect(accuracy, "the judge must clear 80% on the bench").toBeGreaterThanOrEqual(0.8);
    },
  );
});
