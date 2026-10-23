/**
 * EXTRACTION ON TRIAL — a fixed bench of captures with known expectations,
 * so any model swap is one command instead of a live-probe exercise:
 *
 *     WAKA_MODEL_EXTRACT=<candidate> pnpm --filter @waka/api eval:extraction
 *
 * Extraction is the layer that decides what a person's memory learns, and
 * its failure modes are exactly four:
 *
 *   1. INVENTION — a pattern the capture is not evidence of. Priced by each
 *      case's own topic expectations: every statement must speak to a topic
 *      the capture actually carries.
 *   2. DEAFNESS — a real pattern missed. Priced by minimum candidate counts,
 *      and by cases that carry two distinct patterns and expect both heard.
 *   3. LOGBOOK NOISE — a pattern extracted from a capture that is only an
 *      errand. The prompt's own doctrine: "a durable pattern … not a summary
 *      of what the capture says". Priced by zero-candidate cases.
 *   4. META-REFERENCE — "this note", "the article", "the user". A statement
 *      that cannot stand alone months later. ZERO tolerance, like the judge
 *      bench's invented oppositions: a model that scores well but writes
 *      un-standalone statements loses outright.
 *
 * Language is checked structurally, per canon (docs/generation.md: a signal
 * quotes the person's vocabulary, so statements follow the CAPTURE's
 * language): English captures must not answer in hangul and Korean captures
 * must. Half the bench is Korean, deliberately — same reasoning as the
 * judge bench.
 *
 * What is deliberately NOT penalized: a statement close to the capture's own
 * words. "In their words" is the design ("a generator that paraphrases every
 * capture into house style produces statements nobody recognizes as their
 * own") — one case pins the boundary by feeding a capture that already IS a
 * pattern sentence and accepting a near-verbatim answer.
 *
 * WHAT THIS MOCKS, AND WHY: nothing. The live model behind the default
 * provider, whichever road the environment selects. Excluded from the
 * hermetic suite; run by CI's credentialed job and by hand for candidate
 * evals. Skips (visibly) when no model key is present.
 */
import { describe, expect, it } from "vitest";
import {mkdir,writeFile} from 'node:fs/promises';

import { getDefaultModelProvider } from "../src/lib/model-provider.js";
import type { SignalCandidateExtractionInput } from "../src/lib/model-provider.js";

const HAS_KEY = Boolean(
  process.env.OPENROUTER_API_KEY?.trim() || process.env.GEMINI_API_KEY?.trim(),
);

interface Case {
  note: string;
  text: string;
  locale: "en-US" | "ko-KR";
  /** inclusive bounds on how many candidates this capture should yield */
  min: number;
  max: number;
  /** every group must be matched by at least one statement (topic coverage —
      deafness check); with two groups the capture carries two patterns */
  topics?: RegExp[];
  /** no statement may match (invention check) */
  never?: RegExp;
}

const KO = /[가-힣]/;
/** the un-standalone tells, both languages — zero tolerance */
const META =
  /this note|the article|the capture|the user|the author|이 노트|이 글|이 기사|위 글|사용자/i;

const BENCH: Case[] = [
  /* ---- patterns that must be heard (en) ---- */
  {
    note: "recurring self-observation (en)",
    text: "Skipped the gym again to finish someone else's urgent thing. Third time this month — my own calendar always loses to other people's urgency.",
    locale: "en-US",
    min: 1,
    max: 3,
    topics: [/calendar|urgen|priorit|yield|other people|own time/i],
  },
  {
    note: "a quote generalized, not parroted (en)",
    text: "From the article: \"The best interface is no interface.\" I keep coming back to designs that remove steps instead of adding features.",
    locale: "en-US",
    min: 1,
    max: 3,
    topics: [/remove|fewer|subtract|simpl|less/i],
  },
  {
    note: "two distinct patterns in one capture (en)",
    text: "The long walk finally untangled the pricing decision. Separately — I noticed again that I only write well before anyone else is awake.",
    locale: "en-US",
    min: 2,
    max: 3,
    topics: [/walk|walking|moving|motion/i, /morning|early|before .*awake|quiet hours/i],
  },
  {
    note: "a tension named, not resolved (en)",
    text: "I want long unbroken focus blocks, and I said yes to four meetings today without hesitating.",
    locale: "en-US",
    min: 1,
    max: 3,
    topics: [/focus|unbroken|deep/i],
  },
  {
    note: "already a pattern sentence — near-verbatim is correct (en)",
    text: "Small daily rituals compound into identity.",
    locale: "en-US",
    min: 1,
    max: 2,
    topics: [/ritual|habit|daily|identity|compound/i],
  },
  /* ---- logbook noise that must yield nothing (en) ---- */
  {
    note: "an errand log teaches nothing (en)",
    text: "Bought milk and eggs. Dentist moved to 4pm. Package arrives Thursday.",
    locale: "en-US",
    min: 0,
    max: 0,
  },
  {
    note: "a bare fact of the day, no durable pattern (en)",
    text: "Flight UA118 delayed two hours. Gate changed to B44.",
    locale: "en-US",
    min: 0,
    max: 0,
  },
  {
    note: "invention bait: vivid scene, no pattern about the person (en)",
    text: "The barista's tattoo said 'per aspera'. Rain started as the bus pulled in.",
    locale: "en-US",
    min: 0,
    max: 1,
    never: /I (love|always|never|prefer)|coffee (habit|ritual)/i,
  },
  /* ---- the same failure modes, in Korean ---- */
  {
    note: "recurring self-observation (ko)",
    text: "또 남의 급한 일을 먼저 처리하느라 운동을 걸렀다. 이번 달만 세 번째 — 내 일정은 늘 다른 사람의 다급함에 밀린다.",
    locale: "ko-KR",
    min: 1,
    max: 3,
    topics: [/일정|밀리|다급|우선|시간/],
  },
  {
    note: "a quote generalized, not parroted (ko)",
    text: "책에서: \"최고의 인터페이스는 인터페이스가 없는 것이다.\" 요즘 계속 기능을 더하기보다 단계를 없애는 디자인으로 돌아가게 된다.",
    locale: "ko-KR",
    min: 1,
    max: 3,
    topics: [/없애|줄이|단순|덜어/],
  },
  {
    note: "two distinct patterns in one capture (ko)",
    text: "오래 걸으니 가격 문제가 드디어 풀렸다. 그리고 또 느꼈다 — 글은 남들이 깨기 전 새벽에만 잘 써진다.",
    locale: "ko-KR",
    min: 2,
    max: 3,
    topics: [/걷|걸으|산책/, /새벽|아침|이른/],
  },
  {
    note: "a tension named (ko)",
    text: "긴 몰입 시간을 원한다면서 오늘도 회의 네 개를 망설임 없이 수락했다.",
    locale: "ko-KR",
    min: 1,
    max: 3,
    topics: [/몰입|집중|회의/],
  },
  {
    note: "already a pattern sentence (ko)",
    text: "작은 습관이 정체성을 만든다.",
    locale: "ko-KR",
    min: 1,
    max: 2,
    topics: [/습관|정체성/],
  },
  {
    note: "an errand log teaches nothing (ko)",
    text: "우유랑 계란 샀다. 치과 4시로 변경. 택배는 목요일 도착.",
    locale: "ko-KR",
    min: 0,
    max: 0,
  },
  {
    note: "a bare fact of the day (ko)",
    text: "KE082편 두 시간 지연. 게이트 B44로 변경.",
    locale: "ko-KR",
    min: 0,
    max: 0,
  },
  {
    note: "invention bait (ko)",
    text: "카페 직원의 타투에 '페르 아스페라'라고 적혀 있었다. 버스가 들어올 때 비가 시작됐다.",
    locale: "ko-KR",
    min: 0,
    max: 1,
    never: /나는 (늘|항상|절대)|커피 (습관|취향)/,
  },
];

function inputFor(c: Case, i: number): SignalCandidateExtractionInput {
  return {
    profileId: `bench-${i}`,
    preferredLocale: c.locale,
    inspiration: {
      id: `bench-insp-${i}`,
      text: c.text,
      source: "app",
      createdAt: new Date("2026-08-01T09:00:00Z"),
    },
    reflections: [],
    attachments: [],
    existingStatements: [],
    relatedInspirations: [],
  };
}

describe.skipIf(!HAS_KEY)("extraction, on the bench", () => {
  it(
    "clears the bar: ≥80% of cases, zero meta-references, statements in the capture's language",
    { timeout: 240_000 },
    async () => {
      const provider = await getDefaultModelProvider();
      const network=globalThis.fetch,guarded=process.env.WAKA_EVALUATION_REPORT==='1';
      let calls=0,costUsd=0,pendingUpperUsd=0,stopped=false,complete=false;
      const attempts:Array<Record<string,unknown>>=[],results=[] as Array<{ c: Case; statements: string[]; problems: string[] }>;
      let writes=Promise.resolve();
      const persist=()=>writes=writes.then(async()=>{if(guarded){await mkdir('../../work/web-quality',{recursive:true});await writeFile('../../work/web-quality/extraction-bench.json',JSON.stringify({calls,costUsd,maxCostUsd:.1,attempts,results,complete,stopped},null,2));}});
      await persist();
      if(guarded)globalThis.fetch=async(input,init)=>{
        const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
        expect(url.origin).toBe('https://openrouter.ai');expect(JSON.parse(String(init?.body)).model).toBe('deepseek/deepseek-v4.1-flash-1017');
        const request=JSON.parse(String(init?.body)),maximumCostUsd=(Buffer.byteLength(String(init?.body),'utf8')+256)*.3/1000000+request.max_tokens*1.2/1000000;
        if(stopped||calls>=20||costUsd+pendingUpperUsd+maximumCostUsd>.1){stopped=true;throw new Error('Extraction evaluation bound reached');}calls++;pendingUpperUsd+=maximumCostUsd;
        const row:Record<string,unknown>={phase:'dispatching',costUsd:null,maximumCostUsd};attempts.push(row);await persist();
        let response,body;
        try{response=await network(input,init);body=await response.clone().json();}
        catch(error){stopped=true;row.phase='unknown';await persist();throw error;}
        Object.assign(row,{phase:'received',status:response.status,costUsd:body.usage?.cost??null,output:body.choices?.[0]?.message?.content});
        if(!response.ok||!Number.isFinite(body.usage?.cost)){stopped=true;await persist();throw new Error('Unpriced or failed extraction evaluation');}
        pendingUpperUsd-=maximumCostUsd;costUsd+=body.usage.cost;await persist();
        if(costUsd>.1){stopped=true;throw new Error('Extraction evaluation cost exceeded');}return response;
      };
      try{
      const queue = [...BENCH.entries()];
      const workers = Array.from({ length: 4 }, async () => {
        for (;;) {
          if(stopped)return;
          const next = queue.shift();
          if (!next) return;
          const [i, c] = next;
          let statements;
          try{({statements}=await provider.extractSignalCandidates(inputFor(c,i)));}
          catch(error){results.push({c,statements:[],problems:[`runtime: ${(error as Error).name}`]});await persist();continue;}
          const texts = statements.map((s) => s.statement);
          const problems: string[] = [];
          if (texts.length < c.min) problems.push(`deaf: ${texts.length} < ${c.min}`);
          if (texts.length > c.max) problems.push(`noisy: ${texts.length} > ${c.max}`);
          for (const topic of c.topics ?? []) {
            if (!texts.some((t) => topic.test(t))) problems.push(`missed topic ${topic}`);
          }
          if (c.never && texts.some((t) => c.never!.test(t))) problems.push("invented");
          for (const t of texts) {
            const wantsHangul = c.locale === "ko-KR";
            if (wantsHangul !== KO.test(t)) problems.push(`wrong language: "${t}"`);
          }
          results.push({ c, statements: texts, problems });
          await persist();
        }
      });
      await Promise.all(workers);
      complete=results.length===BENCH.length;
      expect(complete,'all fixed cases must finish').toBe(true);
      expect(stopped,'unknown billing stops calibration').toBe(false);

      const metaOffenders = results.flatMap((r) =>
        r.statements.filter((t) => META.test(t)).map((t) => `${r.c.note}: "${t}"`),
      );
      const failed = results.filter((r) => r.problems.length > 0);
      const accuracy = (results.length - failed.length) / BENCH.length;

      for (const r of failed) {
        console.log(`[extraction-eval] MISS ${r.c.note} — ${r.problems.join("; ")}`);
        for (const t of r.statements) console.log(`                  · ${t}`);
      }
      console.log(
        `[extraction-eval] ${results.length - failed.length}/${results.length} correct ` +
          `(${Math.round(accuracy * 100)}%), meta-references: ${metaOffenders.length}`,
      );

      expect(metaOffenders, "un-standalone statements — zero tolerance").toEqual([]);
      expect(accuracy, "the bench's accuracy floor").toBeGreaterThanOrEqual(0.8);
      if(guarded){await persist();const path='../../work/web-quality/extraction-bench.json';await writeFile(path,JSON.stringify({calls,costUsd,maxCostUsd:.1,attempts,results,accuracy,metaOffenders,complete,stopped},null,2));}
      }finally{globalThis.fetch=network;if(!complete||stopped)await persist();}
    },
  );
});
