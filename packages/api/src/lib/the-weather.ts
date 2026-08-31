/**
 * The weather — what the loop did, told as days.
 *
 * goal: the-legible-loop, Phase 5. Each sentence here is a VIEW of a record
 * that already exists — an inspiration kept, a signal minted, a root grown,
 * a refusal written, an artifact version (including the explicit no-change
 * kind), a consultation served. Nothing is written to tell the weather, no
 * model is called, and nothing can be said that a row does not back: delete
 * the row and the sentence vanishes, which is exactly what
 * `the-weather.db.test.ts` proves.
 *
 * COUNTS ARE COUNTED, AND EXACTLY (founder ruling, 2026-08-24: "just show
 * 'your memory was consulted x times' with x always being an accurate
 * number"). The telling first spelled every count out and saturated at
 * twenty into "many", which made the sentence VAGUER THAN THE RECORD IT IS
 * A VIEW OF — "you kept many memories; your memory was consulted many
 * times" says less than the rows behind it and is precisely the vague
 * explanation the research (finding 8) shows is worse than none. "States
 * render, numerals never" is about STATES: a confidence, a score, a tally
 * of people standing somewhere, where a number turns a fact about a person
 * into a readout. How many times WAKA was read is not a state of the
 * person — it is a thing that happened, as countable as a date, and a
 * record that will not say how many is not a record.
 *
 * Day labels stay words ("today", "yesterday", "three days ago"): those are
 * WHEN, and a person says them that way.
 *
 * The vague-explanation research (docs/craft/the-legible-loop.md, findings
 * 2 and 8) is why the shape is "what changed", never "how it felt": a delta
 * of records, told after the world has drawn — seeing first, telling
 * second.
 */

import { and, desc, eq, gt, isNull, lte, ne, or } from "drizzle-orm";

import {
  consultations,
  inspirations,
  signalEvidence,
  signals,
  suppressions,
  topOfMinds,
} from "../db/index.js";
import type { getDb } from "./db.js";

type WakaDb = ReturnType<typeof getDb>;

/** How far back the weather is told. A fortnight, like the gate says. */
export const WEATHER_WINDOW_DAYS = 14;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type ProseLocale = "en-US" | "ko-KR";

const DAY_WORDS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
] as const;

/* the native day words a Korean speaker actually says, out to the window's
   own edge — the fortnight is fourteen, so the table is total */
const KO_DAY_WORDS = [
  "",
  "",
  "이틀",
  "사흘",
  "나흘",
  "닷새",
  "엿새",
  "이레",
  "여드레",
  "아흐레",
  "열흘",
  "열하루",
  "열이틀",
  "열사흘",
  "열나흘",
] as const;

/**
 * A count, exactly, as the record holds it. See the ruling in the header:
 * a telling that rounds its own rows off into "many" is a worse record than
 * the rows.
 */
export function exactCount(n: number): string {
  return String(n);
}

function exactTimes(n: number, locale: ProseLocale = "en-US"): string {
  if (locale === "ko-KR") {
    if (n === 1) return "한 번";
    if (n === 2) return "두 번";
    return `${exactCount(n)}번`;
  }
  if (n === 1) return "once";
  if (n === 2) return "twice";
  return `${exactCount(n)} times`;
}

/** "today", "yesterday", "two days ago" … — the day labels of the telling. */
export function wordedDaysAgo(daysAgo: number, locale: ProseLocale = "en-US"): string {
  if (locale === "ko-KR") {
    if (daysAgo <= 0) return "오늘";
    if (daysAgo === 1) return "어제";
    const word = KO_DAY_WORDS[daysAgo];
    return word ? `${word} 전` : `${daysAgo}일 전`;
  }
  if (daysAgo <= 0) return "today";
  if (daysAgo === 1) return "yesterday";
  /* the window is a fortnight, so the table covers every label it can ever
     produce; past it the honest thing is the number, same as a count */
  return `${DAY_WORDS[daysAgo] ?? String(daysAgo)} days ago`;
}

export interface WeatherSentence {
  text: string;
  /** which record table backs this sentence — the view's own receipt */
  backing:
    | "inspirations"
    | "signals"
    | "signal_evidence"
    | "suppressions"
    | "top_of_minds"
    | "consultations";
}

export interface WeatherDay {
  /** whole days before `now`; zero is today */
  daysAgo: number;
  label: string;
  sentences: WeatherSentence[];
}

export interface AntechamberRow {
  id: string;
  /** the refused candidate's words — what stands in the dim place */
  candidateStatement: string;
  /** the dismissed signal whose vector refused it; null once truly deleted */
  anchorSignalId: string | null;
  /** what the anchor said at the moment it refused — outlives the anchor */
  anchorStatement: string;
  /** whether the anchor still refuses (dismissed now) — false after restore
      or deletion, so the world knows whether "put it back" means anything */
  anchorStillRefusing: boolean;
  suppressedAt: string;
}

export interface TheWeather {
  /** one sentence for the time since the caller was last here; null when
      nothing happened — most days, and silence is the honest telling */
  told: string | null;
  days: WeatherDay[];
  antechamber: AntechamberRow[];
}

interface WindowCounts {
  kept: number;
  minted: number;
  roots: number;
  refusals: number;
  posterRewrites: number;
  posterHeld: number;
  posterYourHand: number;
  posterFirst: number;
  consulted: number;
}

/**
 * The clauses of one day (or one away-window), in a fixed voice. Every
 * clause maps one-to-one onto a family of rows; a count of zero says
 * nothing rather than "nothing happened" — absence of a row is absence of
 * a sentence.
 */
/** "the sky held" is filtered out of the spoken line by identity, so the
    phrase lives in exactly one place per language. */
function skyHeldText(locale: ProseLocale): string {
  return locale === "ko-KR" ? "하늘은 그대로였어요" : "the sky held";
}

function tellCounts(c: WindowCounts, locale: ProseLocale = "en-US"): WeatherSentence[] {
  const ko = locale === "ko-KR";
  const out: WeatherSentence[] = [];
  if (c.kept > 0) {
    out.push({
      text: ko
        ? c.kept === 1
          ? "기억 하나를 간직했어요"
          : `기억 ${exactCount(c.kept)}개를 간직했어요`
        : c.kept === 1
          ? "you kept a memory"
          : `you kept ${exactCount(c.kept)} memories`,
      backing: "inspirations",
    });
  }
  if (c.minted > 0) {
    out.push({
      text: ko
        ? c.minted === 1
          ? "새 신호가 하나 생겼어요"
          : `새로운 신호가 ${exactCount(c.minted)}개 생겼어요`
        : c.minted === 1
          ? "a new signal was spoken"
          : `${exactCount(c.minted)} new signals were spoken`,
      backing: "signals",
    });
  }
  if (c.roots > 0) {
    out.push({
      text: ko
        ? c.roots === 1
          ? "신호 하나가 뒤에 선 기억을 하나 더 찾았어요"
          : `신호들이 뒤에 선 기억을 ${exactCount(c.roots)}개 더 찾았어요`
        : c.roots === 1
          ? "a signal found another memory behind it"
          : `your signals found ${exactCount(c.roots)} more memories behind them`,
      backing: "signal_evidence",
    });
  }
  if (c.refusals > 0) {
    out.push({
      text: ko
        ? c.refusals === 1
          ? "후보 하나를 거절했어요 — 치워 둔 것과 너무 가까워서요"
          : `후보 ${exactCount(c.refusals)}개를 거절했어요 — 치워 둔 것과 너무 가까워서요`
        : c.refusals === 1
          ? "refused a candidate — too close to what you dismissed"
          : `refused ${exactCount(c.refusals)} candidates — too close to what you dismissed`,
      backing: "suppressions",
    });
  }
  // The sky held: memories were read and no pattern moved. Only worth
  // saying when something was actually read — a quiet day is quiet.
  if (c.kept > 0 && c.minted === 0 && c.roots === 0 && c.refusals === 0) {
    out.push({ text: skyHeldText(locale), backing: "inspirations" });
  }
  if (c.posterFirst > 0) {
    out.push({
      text: ko
        ? "톱 오브 마인드가 처음으로 쓰였어요"
        : "your top of mind was written for the first time",
      backing: "top_of_minds",
    });
  }
  if (c.posterRewrites > 0) {
    out.push({
      text: ko
        ? c.posterRewrites === 1
          ? "톱 오브 마인드가 다시 쓰였어요"
          : `톱 오브 마인드가 ${exactTimes(c.posterRewrites, locale)} 다시 쓰였어요`
        : c.posterRewrites === 1
          ? "your top of mind was rewritten"
          : `your top of mind was rewritten ${exactTimes(c.posterRewrites)}`,
      backing: "top_of_minds",
    });
  }
  if (c.posterHeld > 0) {
    out.push({
      text: ko
        ? "전부 다시 읽었는데, 톱 오브 마인드는 그대로였어요"
        : "everything was read again, and your top of mind held",
      backing: "top_of_minds",
    });
  }
  if (c.posterYourHand > 0) {
    out.push({
      text: ko
        ? "톱 오브 마인드가 내 말을 받아들였어요"
        : "your top of mind took your own words",
      backing: "top_of_minds",
    });
  }
  if (c.consulted > 0) {
    out.push({
      text: ko
        ? c.consulted === 1
          ? "기억이 참고됐어요"
          : `기억이 ${exactTimes(c.consulted, locale)} 참고됐어요`
        : c.consulted === 1
          ? "your memory was consulted"
          : `your memory was consulted ${exactTimes(c.consulted)}`,
      backing: "consultations",
    });
  }
  return out;
}

interface Stamped {
  at: Date;
  kind: keyof WindowCounts;
}

async function loadStamps(
  db: WakaDb,
  profileId: string,
  since: Date,
  until: Date,
): Promise<Stamped[]> {
  const bounded = <T extends { at: Date | null }>(rows: T[]) =>
    rows.filter((r): r is T & { at: Date } => r.at !== null);

  const [kept, minted, roots, refusals, posters, consulted] = await Promise.all([
    db
      .select({ at: inspirations.createdAt })
      .from(inspirations)
      .where(
        and(
          eq(inspirations.profileId, profileId),
          gt(inspirations.createdAt, since),
          lte(inspirations.createdAt, until),
        ),
      ),
    db
      .select({ at: signals.createdAt })
      .from(signals)
      .where(
        and(
          eq(signals.profileId, profileId),
          gt(signals.createdAt, since),
          lte(signals.createdAt, until),
        ),
      ),
    db
      .select({ at: signalEvidence.createdAt })
      .from(signalEvidence)
      .where(
        and(
          eq(signalEvidence.profileId, profileId),
          gt(signalEvidence.createdAt, since),
          lte(signalEvidence.createdAt, until),
        ),
      ),
    db
      .select({ at: suppressions.suppressedAt })
      .from(suppressions)
      .where(
        and(
          eq(suppressions.profileId, profileId),
          gt(suppressions.suppressedAt, since),
          lte(suppressions.suppressedAt, until),
        ),
      ),
    db
      .select({ at: topOfMinds.createdAt, reason: topOfMinds.reason })
      .from(topOfMinds)
      .where(
        and(
          eq(topOfMinds.profileId, profileId),
          gt(topOfMinds.createdAt, since),
          lte(topOfMinds.createdAt, until),
        ),
      ),
    db
      .select({ at: consultations.servedAt })
      .from(consultations)
      .where(
        and(
          eq(consultations.profileId, profileId),
          gt(consultations.servedAt, since),
          lte(consultations.servedAt, until),
          /* ANOTHER HAND'S READS ONLY (founder, 2026-08-25: "are these
             numbers accurate?"). The record marks every serve, your own
             browser's included — the world loads your top of mind and your
             signals on every visit, so a day of using the product wrote a
             hundred rows and the line announced them as if someone else had
             been reading. Every row was real; the SENTENCE was wrong, because
             "your memory was consulted" means a reader who is not you. A
             null reader stays counted: that is an erased account's mark —
             someone read it, and their leaving does not unread it. */
          or(
            ne(consultations.readerProfileId, profileId),
            isNull(consultations.readerProfileId),
          )!,
        ),
      ),
  ]);

  const out: Stamped[] = [];
  for (const r of bounded(kept)) out.push({ at: r.at, kind: "kept" });
  for (const r of bounded(minted)) out.push({ at: r.at, kind: "minted" });
  for (const r of bounded(roots)) out.push({ at: r.at, kind: "roots" });
  for (const r of bounded(refusals)) out.push({ at: r.at, kind: "refusals" });
  for (const r of posters) {
    if (r.at === null) continue;
    if (r.reason === "regenerated") out.push({ at: r.at, kind: "posterRewrites" });
    else if (r.reason === "no_change") out.push({ at: r.at, kind: "posterHeld" });
    else if (r.reason === "human_edit") out.push({ at: r.at, kind: "posterYourHand" });
    else if (r.reason === "initial") out.push({ at: r.at, kind: "posterFirst" });
    /* member_proposal is a room's weather, not this profile's */
  }
  for (const r of bounded(consulted)) out.push({ at: r.at, kind: "consulted" });
  return out;
}

const emptyCounts = (): WindowCounts => ({
  kept: 0,
  minted: 0,
  roots: 0,
  refusals: 0,
  posterRewrites: 0,
  posterHeld: 0,
  posterYourHand: 0,
  posterFirst: 0,
  consulted: 0,
});

/**
 * The whole telling: the fortnight as days, one told sentence for the
 * caller's own away-window, and the antechamber.
 */
export async function assembleTheWeather(
  db: WakaDb,
  input: {
    profileId: string;
    now?: Date;
    since?: Date | null;
    /** false = the telling only. The told sentence and the days are event
        counts — no statement, no memory content — so a serve without the
        antechamber serves nothing derived, and the route writes no
        consultation for it. This is what lets the companion be ASKED
        without the asking inflating its own "consulted" count. */
    includeAntechamber?: boolean;
    /** the language the telling is spoken in — the profile's own */
    locale?: ProseLocale;
  },
): Promise<TheWeather> {
  const now = input.now ?? new Date();
  const locale = input.locale ?? "en-US";
  const windowStart = new Date(now.getTime() - WEATHER_WINDOW_DAYS * MS_PER_DAY);
  const stamps = await loadStamps(db, input.profileId, windowStart, now);

  // Whole days measured back from now — the label the world tells by.
  const dayOf = (at: Date) =>
    Math.max(0, Math.floor((now.getTime() - at.getTime()) / MS_PER_DAY));

  const byDay = new Map<number, WindowCounts>();
  for (const s of stamps) {
    const day = dayOf(s.at);
    const counts = byDay.get(day) ?? emptyCounts();
    counts[s.kind] += 1;
    byDay.set(day, counts);
  }

  const days: WeatherDay[] = [...byDay.entries()]
    .sort(([a], [b]) => a - b)
    .map(([daysAgo, counts]) => ({
      daysAgo,
      label: wordedDaysAgo(daysAgo, locale),
      sentences: tellCounts(counts, locale),
    }))
    .filter((day) => day.sentences.length > 0);

  // The told sentence: the caller's own away-window, one line. Assembled
  // from the same stamps — no second query, no second truth.
  let told: string | null = null;
  if (input.since) {
    const sinceMs = input.since.getTime();
    const away = emptyCounts();
    for (const s of stamps) {
      if (s.at.getTime() > sinceMs) away[s.kind] += 1;
    }
    /* THE SPOKEN LINE IS COUNTS ONLY (founder, 2026-08-24: "just drop
       today and the sky held"). "The sky held" is a fact about absence and
       earns its place in the record — the days, the markdown — but the
       creature's one line is what HAPPENED, counted. The label is the
       world's to add or omit; none is baked in here. */
    /* AND EXACTLY ONE OF THEM (founder, 2026-08-25: "always show the most
       relevant statement of the time when clicking on it to show text. never
       show more than 1 thing"). This was five clauses, then two, and neither
       was a whisper — a creature that reports a fortnight in one breath is a
       ticker. The record stays complete in the days and the markdown; the
       spoken line is the single most newsworthy thing that happened.

       Newsworthy means what changed ABOUT you before what you did: the poster
       moving outranks a signal moving outranks being read outranks your own
       keeping. Your own keeping is last on purpose — you were there for it. */
    const clauses = tellCounts(away, locale).filter((s) => s.text !== skyHeldText(locale));
    const NEWS: Record<WeatherSentence["backing"], number> = {
      top_of_minds: 0,
      signals: 1,
      signal_evidence: 2,
      suppressions: 3,
      consultations: 4,
      inspirations: 5,
    };
    const spoken = clauses
      .map((s, i) => ({ s, i }))
      .sort((a, b) => NEWS[a.s.backing] - NEWS[b.s.backing] || a.i - b.i)
      .slice(0, 1)
      .map((x) => x.s.text);
    told = spoken.length > 0 ? `${spoken[0]}.` : null;
  }

  const antechamberRows =
    input.includeAntechamber === false
      ? []
      : await db
          .select({
            id: suppressions.id,
            candidateStatement: suppressions.candidateStatement,
            anchorSignalId: suppressions.anchorSignalId,
            anchorStatement: suppressions.anchorStatement,
            suppressedAt: suppressions.suppressedAt,
            anchorDismissedAt: signals.dismissedAt,
          })
          .from(suppressions)
          .leftJoin(signals, eq(signals.id, suppressions.anchorSignalId))
          .where(eq(suppressions.profileId, input.profileId))
          .orderBy(desc(suppressions.suppressedAt))
          .limit(50);

  return {
    told,
    days,
    antechamber: antechamberRows.map((row) => ({
      id: row.id,
      candidateStatement: row.candidateStatement,
      anchorSignalId: row.anchorSignalId,
      anchorStatement: row.anchorStatement,
      anchorStillRefusing: row.anchorDismissedAt !== null,
      suppressedAt: row.suppressedAt.toISOString(),
    })),
  };
}

/**
 * The wire rendering — the days only, as markdown, for any mind that asks
 * "what did WAKA do lately". Digit-free by construction: labels and counts
 * are words, and nothing else is printed.
 */
export function renderTheWeather(weather: TheWeather, locale: ProseLocale = "en-US"): string {
  const lines: string[] = [];
  if (locale === "ko-KR") {
    lines.push("# 날씨");
    lines.push("");
    lines.push("> 무엇이 있었는지 날들로 들려드려요 — 문장 하나하나가 저장된");
    lines.push("> 기록을 비추는 것이지, 누가 쓴 요약이 아니에요.");
    lines.push("");
    if (weather.days.length === 0) {
      lines.push("조용한 두 주였어요. 아무것도 움직이지 않았어요.");
    }
  } else {
    lines.push("# The weather");
    lines.push("");
    lines.push("> What the loop did, told as days — every sentence a view of a");
    lines.push("> stored record, never a summary someone wrote.");
    lines.push("");
    if (weather.days.length === 0) {
      lines.push("A quiet fortnight — nothing moved.");
    }
  }
  for (const day of weather.days) {
    lines.push(`## ${day.label}`);
    lines.push("");
    for (const sentence of day.sentences) {
      lines.push(`- ${sentence.text}.`);
    }
    lines.push("");
  }
  return lines.join("\n").replace(/\n+$/, "\n");
}
