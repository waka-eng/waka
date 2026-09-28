/**
 * THE PROOF — does the distillation carry the person, or does the archive?
 *
 *     pnpm --filter @waka/api eval:self-likeness
 *
 * Founder, in the meeting of 2026-09-18, naming the thing this product has to
 * establish:
 *
 *   *"우리가 결국 증명해야 되는 거는, 세컨 브레인이랑 다르다는 걸 증명해야 되는
 *    거는 — 이 전체를 읽고 행동하는 에이전트보다, 톱 오브 마인드랑 필로소피만
 *    읽고 하는 에이전트가 더 나랑 비슷한 선택을 한다는 걸 증명하는 거."*
 *
 * An agent given ONLY your top of mind and your principles chooses more like
 * you than an agent given your whole archive. If that holds, the three layers
 * are load-bearing and this is not a second brain. If it does not, the layers
 * are decoration over a search index.
 *
 * ── THREE ARMS, AND ONLY ONE COMPARISON MATTERS ───────────────────────────
 *
 *   A  nothing                        the floor
 *   B  the whole archive, raw         "is Waka useful at all"
 *   C  top of mind + principles only  "is the DISTILLATION the point"
 *
 * B-vs-C is the thesis. A-vs-B is the sales pitch. C beating B is the only
 * result that means anything, and it is the one that can come out the wrong
 * way — which is the whole argument for building this before anyone is
 * committed to the answer.
 *
 * ── THE BAR IS ON THE INSTRUMENT, NEVER ON THE ANSWER ─────────────────────
 *
 * THIS FILE DOES NOT ASSERT THAT C WINS, and that is deliberate rather than
 * timid. A test whose gate is "C > B" asserts its own conclusion: if the
 * thesis is false it goes red forever, and a suite that is red forever gets
 * deleted — taking the evidence with it. So the gates below ask only whether
 * the MEASUREMENT is sound:
 *
 *   · every arm returns parseable choices (the instrument works at all)
 *   · arm A lands meaningfully below B and C
 *
 * That second one is the load-bearing gate and it is not a formality. If an
 * agent told nothing about the person scores as well as one told everything,
 * the probes are answerable by general good sense and the bench measures
 * nothing about this person. A-vs-the-rest is how the bench proves it is a
 * bench.
 *
 * The B-vs-C number is PRINTED, with its margin, and left for a human to read.
 *
 * ── THE BENCH IS A SYNTHETIC PERSON, AND HERE IS WHY THAT IS HONEST ───────
 *
 * Ground truth here is "what would this person actually choose", which exists
 * only if the person was authored. Real archives cannot supply it — nobody
 * has recorded their own counterfactual choices — and using a real person's
 * memories in a fixture would be wrong twice over.
 *
 * SO THE LIMIT HAS TO BE SAID PLAINLY, because it is easy to overclaim from
 * this file. The persona's distillation below is written by the same hand as
 * the probes. That means this bench can measure ONE thing:
 *
 *   ✓ whether a distillation of this size CARRIES enough of a person for an
 *     agent to choose like them
 *
 * and cannot measure:
 *
 *   ✗ whether Waka's own pipeline PRODUCES a distillation that does
 *
 * The second question is the real one and it needs a derivation run over the
 * archive below — `top-of-mind-synthesis` and `principle-generation`, against
 * a database. That is the follow-up, and it is what turns this from a
 * property of the idea into a property of the product. Until then, a failure
 * here is decisive and a success here is necessary but not sufficient.
 *
 * ── AND THE BENCH DEFENDS ITSELF AGAINST BEING RIGGED ─────────────────────
 *
 * The obvious way to "prove" the thesis is to write the answer into the
 * distillation. The hermetic cases below run on every `pnpm test`, with no
 * key and no network, and refuse that: no sixteen-character run of a correct
 * answer may appear in ANY arm's context. A probe whose answer is quoted
 * somewhere measures recall, not judgement.
 *
 * WHAT THIS MOCKS, AND WHY: nothing. The hermetic half reads its own fixture;
 * the live half is the point of the exercise and talks to the real model.
 * Skips visibly without a key, the way `judge-eval.test.ts` does.
 */
import { describe, expect, it } from "vitest";

import {
  buildGeminiJsonHeaders,
  fetchModelWithTimeout,
} from "../src/lib/gemini-http.js";
import { buildGenerateContentUrl } from "../src/queue/gemini.js";

const HAS_KEY = Boolean(process.env.GEMINI_API_KEY?.trim());

// ---------------------------------------------------------------------------
// The person
// ---------------------------------------------------------------------------

/**
 * LAYER 1 — what they kept. Incidents, not maxims: none of these states a
 * principle, they are the evidence a principle would be drawn FROM. Half
 * Korean, for the reason `judge-eval` gives — the archive this product holds
 * is majority Korean and an English-only bench certifies the easy half.
 */
const ARCHIVE: string[] = [
  "Moved the queue onto the managed service on Tuesday. Thursday we needed a retry behaviour it doesn't expose. Getting back off took nine days.",
  "지난달에 붙인 대시보드, 아무도 안 본다. 그런데 매주 누군가 고치고 있다.",
  "Wrote the importer spec for three weeks. Built it in two. Four months later: eleven files imported, all of them mine.",
  "인턴이 내가 한 달 설계한 걸 40줄로 만들어 왔다. 그게 돌아간다.",
  "Four meetings Thursday. What actually left my hands that day was three emails.",
  "The annual contract is the part I regret, not the price.",
  "블로그에 쓰고 나서야 그 결정이 진짜로 정해진 느낌이 들었다.",
  "Two hours uninterrupted on Saturday got further than the whole of Wednesday.",
  "We picked the framework because the migration out of it looked cheap. It was.",
  "누가 물어봐서 설명하다가 내가 틀렸다는 걸 알았다. 혼자 있었으면 몇 달 더 갔을 것.",
  "The prototype I threw away taught me the thing the design doc never would have.",
  "매주 30분씩 유지보수가 드는 건 결국 아무도 안 쓰게 된다.",
  "Said yes to the advisory call. Now it is monthly. Nobody decided that.",
  "The rollback took four minutes because we'd never turned off the old path.",
  "계획을 다 세우고 시작한 것들보다, 작게 내보내고 고친 게 더 멀리 갔다.",
  "I keep a folder of things I shipped in an afternoon. It is the folder I am proudest of.",
];

/**
 * LAYER 3 — what is current. Short, and about NOW rather than forever.
 */
const TOP_OF_MIND: string[] = [
  "I keep reaching for the smallest thing that works.",
  "요즘 후회하는 건 전부 되돌릴 수 없었던 쪽이다.",
  "Too much of my week is going into rooms.",
];

/**
 * LAYER 4 — what all of it turned out to say about how they choose.
 */
const PRINCIPLES: string[] = [
  "When you cannot tell which way is right, take the one you can undo.",
  "A thing that needs maintaining forever is a thing you did not choose.",
  "Ship it small to find out, instead of planning it whole to be sure.",
  "긴 시간 덩어리를 지켜라. 달력은 일의 적이다.",
  "공개적으로 말하지 않은 건 아직 정해진 게 아니다.",
];

// ---------------------------------------------------------------------------
// The probes
// ---------------------------------------------------------------------------

interface Probe {
  readonly id: string;
  readonly situation: string;
  readonly options: readonly string[];
  /** Index into `options`. */
  readonly answer: number;
  /** Which principle it follows from — for reading failures, not for scoring. */
  readonly because: string;
}

const PROBES: readonly Probe[] = [
  {
    id: "vendor-lock",
    situation:
      "A vendor will remove a week of work for you, but the contract is annual and moving off it later means rewriting how data comes in. You cannot tell yet whether you will want to move off it.",
    options: [
      "Sign it. A week saved now compounds.",
      "Run a three-week bake-off against the other four vendors first.",
      "Do the crude version yourself this week and look again in a quarter.",
    ],
    answer: 2,
    because: "prefers the door that stays open",
  },
  {
    id: "meeting-creep",
    situation:
      "Someone proposes a recurring 30-minute sync. It would genuinely help the two of you stay aligned.",
    options: [
      "Agree to it once, with no recurrence, and let it be asked for again if it earned that.",
      "Agree, and put it on the calendar weekly.",
      "Decline, and send written updates instead.",
    ],
    answer: 0,
    because: "nothing becomes standing because nobody stopped it",
  },
  {
    id: "spec-first",
    situation:
      "A feature has an obvious shape but three unknowns about how people will use it. You have two weeks.",
    options: [
      "Spend the first week writing the design out fully so the second is clean.",
      "Put the thinnest possible version in front of someone on day three.",
      "Interview eight prospective users before writing anything.",
    ],
    answer: 1,
    because: "small and out, to find out",
  },
  {
    id: "dashboard",
    situation:
      "내부 대시보드를 하나 더 만들자는 제안이 왔다. 만드는 데 이틀, 유지에 매주 30분쯤 든다.",
    options: [
      "만든다. 이틀이면 싸다.",
      "만들지 않고, 필요할 때마다 쿼리를 직접 돌린다.",
      "만들되, 한 달 뒤에 쓰는 사람이 없으면 지우기로 먼저 합의한다.",
    ],
    answer: 2,
    because: "what must be tended forever was never really chosen",
  },
  {
    id: "undecided",
    situation:
      "팀이 방향을 정했다고 생각하는데, 아직 아무 데도 적지 않았고 밖에다 말한 적도 없다.",
    options: [
      "정해진 거니까 그대로 실행한다.",
      "짧게라도 밖에 적어 두고 나서 실행한다.",
      "다음 회의에서 한 번 더 확인한다.",
    ],
    answer: 1,
    because: "unsaid is not yet settled",
  },
  {
    id: "migration",
    situation:
      "Two libraries do the job equally well today. One is more capable; the other is smaller and could be removed in a single sitting.",
    options: [
      "Take the more capable one — you will grow into it.",
      "Write a thin abstraction so you can swap either way later.",
      "Take the smaller one, even though it does less.",
    ],
    answer: 2,
    because: "prefers the door that stays open — and the abstraction is itself a thing to tend",
  },
  {
    id: "big-block",
    situation:
      "You have one four-hour block free this week. Three people have asked for an hour each.",
    options: [
      "Keep the block whole and offer all three a written answer.",
      "Give two of them an hour and keep two hours.",
      "Give all three an hour and find the work time elsewhere.",
    ],
    answer: 0,
    because: "the calendar is the enemy of the work",
  },
  {
    id: "throwaway",
    situation:
      "A prototype you built to answer one question now works well enough that someone suggests shipping it.",
    options: [
      "Ship it and tidy it under real use.",
      "Throw it away and build the real one, now that you know the answer.",
      "Freeze it as an internal tool and maintain it lightly.",
    ],
    answer: 0,
    because: "small and out; the tidying is undoable, the delay is not",
  },
  {
    id: "advisory",
    situation:
      "한 번만 도와달라던 자문 통화가 어느새 매달이 되어 있다. 아무도 그렇게 정한 적은 없다.",
    options: [
      "계속한다. 관계가 중요하다.",
      "한 번 끝을 정하고, 다시 필요하면 그때 다시 요청받는다.",
      "바로 그만둔다.",
    ],
    answer: 1,
    because: "nothing becomes standing because nobody stopped it",
  },
  {
    id: "old-path",
    situation:
      "You are cutting over to a new code path. Keeping the previous one alive costs a little money and some confusion.",
    options: [
      "Delete the previous one at cutover — carrying both is the confusion.",
      "Delete it after a week, whatever has happened.",
      "Leave it alive until the new one has survived a full cycle.",
    ],
    answer: 2,
    because: "prefers the door that stays open",
  },
  {
    id: "explain",
    situation:
      "You are fairly sure about a technical call. Explaining it to someone would cost forty minutes.",
    options: [
      "Proceed — you are sure enough, and forty minutes is forty minutes.",
      "Explain it to someone before proceeding.",
      "Write it up but do not wait for a reply.",
    ],
    answer: 1,
    because: "they have found their own errors by saying them out loud",
  },
  {
    id: "framework",
    situation:
      "새 프로젝트를 시작한다. 팀이 잘 아는 무거운 스택과, 아무도 안 써봤지만 훨씬 가벼운 스택이 있다.",
    options: [
      "가벼운 쪽으로 간다. 나중에 못 벗어나는 게 더 비싸다.",
      "잘 아는 쪽으로 간다. 속도가 나온다.",
      "잘 아는 쪽으로 가되, 가벼운 쪽을 두 주 동안 평가한다.",
    ],
    answer: 0,
    because: "their record says they chose for a cheap way out, not for fluency",
  },
];

// ---------------------------------------------------------------------------
// The arms
// ---------------------------------------------------------------------------

type Arm = "nothing" | "archive" | "distillation";

function contextFor(arm: Arm): string {
  if (arm === "nothing") return "";
  if (arm === "archive") {
    return ["Things this person has kept:", ...ARCHIVE.map((t) => `- ${t}`)].join("\n");
  }
  return [
    "What is on this person's mind right now:",
    ...TOP_OF_MIND.map((t) => `- ${t}`),
    "",
    "How this person has been seen to choose:",
    ...PRINCIPLES.map((t) => `- ${t}`),
  ].join("\n");
}

const ARMS: readonly Arm[] = ["nothing", "archive", "distillation"];

// ---------------------------------------------------------------------------
// Keeping the bench honest — hermetic, no key, every run
// ---------------------------------------------------------------------------

const flat = (s: string): string => s.toLowerCase().replace(/\s+/g, " ").trim();

/** The longest run of `needle` that appears verbatim inside `hay`. */
function longestSharedRun(needle: string, hay: string): string {
  const n = flat(needle);
  const h = flat(hay);
  let best = "";
  for (let len = Math.min(n.length, 60); len > best.length; len--) {
    for (let i = 0; i + len <= n.length; i++) {
      const sub = n.slice(i, i + len);
      if (h.includes(sub)) return sub;
    }
  }
  return best;
}

/** Below this, a shared run is ordinary language rather than a quotation. */
const LEAK = 16;

describe("the bench, before it is asked anything", () => {
  it("never quotes an answer into any arm's context", () => {
    const leaks: string[] = [];
    for (const probe of PROBES) {
      const answer = probe.options[probe.answer]!;
      for (const arm of ARMS) {
        const ctx = contextFor(arm);
        if (ctx === "") continue;
        const run = longestSharedRun(answer, ctx);
        if (run.length >= LEAK) {
          leaks.push(`${probe.id} → ${arm}: "${run}" (${run.length} chars)`);
        }
      }
    }
    expect(
      leaks,
      "a probe whose answer is quoted in the context measures recall, not judgement — " +
        "and quoting it into the distillation is exactly how this bench would be rigged",
    ).toEqual([]);
  });

  it("is really comparing the scan, so the case above cannot pass blind", () => {
    /* WITHOUT THIS, a `longestSharedRun` that always returned "" would make
       the leak case green forever. Plant a leak and require it to be seen. */
    const planted = longestSharedRun(
      "take the one you can undo",
      contextFor("distillation"),
    );
    expect(planted.length, "the scan cannot find a phrase that is verbatim in the distillation").toBeGreaterThanOrEqual(LEAK);
  });

  it("does not put the answer in the same place twice running", () => {
    const positions = PROBES.map((p) => p.answer);
    expect(new Set(positions).size, "every answer sits at one index — position alone would score").toBeGreaterThan(1);
    const longestRun = positions.reduce(
      (acc, v, i) => (i > 0 && v === positions[i - 1] ? { cur: acc.cur + 1, max: Math.max(acc.max, acc.cur + 1) } : { cur: 1, max: acc.max }),
      { cur: 1, max: 1 },
    ).max;
    expect(longestRun, "a long run of the same index is a pattern a model can learn instead of the person").toBeLessThanOrEqual(3);
  });

  it("asks in both of the languages this archive is actually kept in", () => {
    const hangul = /[ㄱ-힝]/;
    expect(PROBES.filter((p) => hangul.test(p.situation)).length, "no Korean probes — the bench certifies the easy half").toBeGreaterThanOrEqual(3);
    expect(ARCHIVE.filter((t) => hangul.test(t)).length, "no Korean in the archive").toBeGreaterThanOrEqual(5);
  });

  it("gives the distillation far less to go on than the archive", () => {
    const archive = contextFor("archive").length;
    const distilled = contextFor("distillation").length;
    expect(distilled, "the distillation is not shorter than the archive — then it is not a distillation").toBeLessThan(archive);
    expect(
      distilled / archive,
      "the distillation is nearly as long as the archive; the comparison would not be about compression at all",
    ).toBeLessThan(0.6);
  });

  it("is well formed", () => {
    for (const p of PROBES) {
      expect(p.options.length, `${p.id}: needs at least three options`).toBeGreaterThanOrEqual(3);
      expect(p.answer, `${p.id}: answer out of range`).toBeLessThan(p.options.length);
      expect(p.because.length, `${p.id}: no reason recorded`).toBeGreaterThan(0);
    }
    expect(new Set(PROBES.map((p) => p.id)).size).toBe(PROBES.length);
  });
});

// ---------------------------------------------------------------------------
// The measurement — live, and only with a key
// ---------------------------------------------------------------------------

const SYSTEM =
  "You are choosing on behalf of one specific person. You will be given what is known about them, " +
  "a situation, and the options open to them. Answer with the index of the option THIS PERSON would " +
  "actually take — not the one that is wisest in general. If you are told nothing about them, choose " +
  "the option a thoughtful person would take. Answer with the index only.";

async function ask(arm: Arm, probe: Probe): Promise<number | null> {
  const ctx = contextFor(arm);
  const prompt = [
    ctx === "" ? "Nothing is known about this person." : ctx,
    "",
    `Situation: ${probe.situation}`,
    "",
    "Options:",
    ...probe.options.map((o, i) => `${i}. ${o}`),
  ].join("\n");

  const response = await fetchModelWithTimeout(fetch, buildGenerateContentUrl(), {
    method: "POST",
    headers: buildGeminiJsonHeaders(process.env.GEMINI_API_KEY!.trim()),
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0,
        responseMimeType: "application/json",
        responseSchema: {
          type: "object",
          properties: { choice: { type: "integer" } },
          required: ["choice"],
        },
      },
    }),
  });
  if (!response.ok) return null;
  const body = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = body.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) return null;
  try {
    const got = JSON.parse(text) as { choice?: unknown };
    return typeof got.choice === "number" ? got.choice : null;
  } catch {
    return null;
  }
}

describe.skipIf(!HAS_KEY)("an agent choosing as this person", () => {
  it(
    "reports how each arm does, and fails only if the bench itself is not measuring",
    async () => {
      const score: Record<Arm, { right: number; answered: number }> = {
        nothing: { right: 0, answered: 0 },
        archive: { right: 0, answered: 0 },
        distillation: { right: 0, answered: 0 },
      };
      const missed: string[] = [];

      for (const arm of ARMS) {
        /* a few at a time — polite to the provider, and the arms stay
           independent so one slow answer cannot reorder another arm */
        const width = 4;
        for (let i = 0; i < PROBES.length; i += width) {
          const slice = PROBES.slice(i, i + width);
          const got = await Promise.all(slice.map((p) => ask(arm, p)));
          slice.forEach((p, j) => {
            const choice = got[j];
            if (choice === null) return;
            score[arm].answered += 1;
            if (choice === p.answer) score[arm].right += 1;
            else if (arm === "distillation") missed.push(`${p.id}: chose ${choice}, wanted ${p.answer} — ${p.because}`);
          });
        }
      }

      const pct = (a: Arm): number =>
        score[a].answered === 0 ? 0 : Math.round((score[a].right / score[a].answered) * 100);

      /* eslint-disable no-console */
      console.log(
        [
          "",
          "  THE PROOF — one run, " + PROBES.length + " probes",
          "  ─────────────────────────────────────────────",
          `  A  nothing        ${pct("nothing")}%   (${score.nothing.right}/${score.nothing.answered})`,
          `  B  whole archive  ${pct("archive")}%   (${score.archive.right}/${score.archive.answered})`,
          `  C  distillation   ${pct("distillation")}%   (${score.distillation.right}/${score.distillation.answered})`,
          "",
          `  C − B = ${pct("distillation") - pct("archive")} points   ← the thesis. Reported, not asserted.`,
          "",
          ...(missed.length ? ["  where C chose otherwise:", ...missed.map((m) => "   · " + m), ""] : []),
        ].join("\n"),
      );
      /* eslint-enable no-console */

      for (const arm of ARMS) {
        expect(
          score[arm].answered,
          `arm "${arm}" produced no parseable choices — the instrument is broken, not the thesis`,
        ).toBeGreaterThanOrEqual(Math.ceil(PROBES.length * 0.75));
      }

      /* THE ONE GATE THAT IS NOT A FORMALITY. If knowing nothing about the
         person scores as well as knowing everything, these probes are
         answerable by general good sense and this bench says nothing about
         anybody. That is a broken bench, and it must fail loudly rather than
         print a meaningless margin. */
      const informed = Math.max(pct("archive"), pct("distillation"));
      expect(
        informed - pct("nothing"),
        `knowing nothing scored ${pct("nothing")}% against ${informed}% for the best informed arm. ` +
          "The probes do not require this person — the bench is measuring good sense, not self-likeness.",
      ).toBeGreaterThanOrEqual(15);
    },
    240_000,
  );
});
