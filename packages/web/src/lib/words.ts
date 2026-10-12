/**
 * THE WORLD'S LANGUAGE — data turned into the words this world says.
 *
 * One reason to exist: every function here takes a fact and returns a phrase,
 * in the register the world speaks. No React, no canvas, no network. That is
 * what makes it a module rather than a pile — you can read the whole thing and
 * know what belongs in it.
 *
 * The register matters as much as the logic. This world says "four days ago"
 * and "you and your agent", never "4d" or "2 members". `docs/architecture.md`
 * calls this the third vocabulary: canon words in the API, world words inside
 * the world, and human words on screen. These are the human words.
 *
 * AND THE HUMAN WORDS SPEAK TWO LANGUAGES (founder, 2026-08-31, reversing
 * 2026-08-22). Every function takes the locale LAST, defaulting to English,
 * so a caller that has not learned about Korean yet still speaks — in the
 * default, never in a crash. Korean counts use the native numerals a person
 * says out loud (두 달, 사흘, 스무 날), which is this module's own law —
 * "counts are prose here, never digits" — kept in the other language.
 */
import { DAY_MS } from "./num";

export type WordsLocale = "en-US" | "ko-KR";

/**
 * How long ago, ALWAYS as a relative phrase in words — "Today", "Yesterday",
 * "Last week", "Eighty-seven days ago". It is paired with the absolute date,
 * so it must never fall back to naming the date itself or the panel's meta
 * line prints the same string twice.
 */
export function agoWords(ms: number, T: number, locale: WordsLocale = "en-US"): string {
  const days = Math.floor((T - ms) / DAY_MS);
  if (locale === "ko-KR") {
    if (days <= 0) return "오늘";
    if (days === 1) return "어제";
    /* the native day words a person actually says, while they last */
    const NATIVE_DAYS = ["", "", "이틀", "사흘", "나흘", "닷새", "엿새"];
    if (days < 7) return `${NATIVE_DAYS[days]} 전`;
    if (days < 14) return "지난주";
    if (days < 100) return `${koNativeCount(days)} 날 전`;
    const months = Math.round(days / 30);
    return months < 2 ? "몇 달 전" : `${koNativeCount(months)} 달 전`;
  }
  const cap = (s: string) => `${s[0].toUpperCase()}${s.slice(1)}`;
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${cap(numWords(days))} days ago`;
  if (days < 14) return "Last week";
  if (days < 100) return `${cap(numWords(days))} days ago`;
  const months = Math.round(days / 30);
  return months < 2 ? "A few months ago" : `${cap(numWords(months))} months ago`;
}

/**
 * THE MONTH SOMETHING IS DATED TO, SPOKEN — "June twenty twenty-six",
 * "이천이십육년 유월". Korean says the year first, because Korean does.
 *
 * TWO READERS NOW, AND THE SECOND ONE IS WHY THIS COMMENT GREW. The dial's
 * scrub label was the first. The second is the proof line under a principle
 * card — "Held since October twenty twenty-six, drawn from fourteen things
 * you kept" — which carried its OWN
 * `toLocaleDateString(locale, { month: "long", year: "numeric" })` and
 * therefore printed `October 2026` and `2026년 10월`: this module's year rule
 * broken in English and its "counts are prose here, never digits" law broken
 * in Korean, on the one surface in the product whose entire value is that a
 * stranger can read the line and believe it.
 *
 * A reader moving between the dial and the principles page saw one fact in
 * two registers, and no gate could see it because neither string ever enters
 * the catalogue. `test/one-date-vocabulary.test.tsx` can see it now.
 *
 * WHY THE YEAR IS ALWAYS HERE, unlike `dialMonth` one rung down. `dialMonth`
 * labels rows in a list, where a year on one row and not its neighbour is a
 * visible inconsistency, so it drops the year when it is this one. This
 * phrase is spoken alone, inside a sentence about how long something has been
 * true — and "held since October" is a sentence that quietly means a
 * different thing every January.
 */
export function monthTag(ms: number, locale: WordsLocale = "en-US"): string {
  const d = new Date(ms);
  if (locale === "ko-KR") {
    return `${koSinoNumber(d.getFullYear())}년 ${KO_MONTHS[d.getMonth()]}`;
  }
  return `${d.toLocaleDateString("en-US", { month: "long" })} ${yearWords(d.getFullYear())}`;
}

/** The collapsed links sentence, adapted for a group: what cited this save.
    Korean joins the titles with commas and closes with the locative 에 —
    which never inflects, so no title can break the grammar. */
export function citedWords(titles: string[], locale: WordsLocale = "en-US"): string {
  if (locale === "ko-KR") {
    if (titles.length === 1) return `“${titles[0]}”에 인용됨`;
    if (titles.length === 2) return `“${titles[0]}”, “${titles[1]}”에 인용됨`;
    return `“${titles[0]}”, “${titles[1]}” 외 ${koNativeCount(titles.length - 2)} 곳에 인용됨`;
  }
  if (titles.length === 1) return `Cited by “${titles[0]}”`;
  if (titles.length === 2) return `Cited by “${titles[0]}” and “${titles[1]}”`;
  return `Cited by “${titles[0]}”, “${titles[1]}” and ${numWords(titles.length - 2)} more`;
}

/**
 * The absolute date — "Aug 23", and with the year when it is not this one.
 * It was spelled all the way out ("May eighteenth") to obey "states render,
 * numerals never"; see the note inside `dateWords` for why a date is not one
 * of the states that rule is about.
 */
/* The two ordinal tables went with `ordWords`, their only reader. */
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const ONES = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
  "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
  "seventeen", "eighteen", "nineteen",
];

/* ─── Korean numerals ───
   Two systems, used where a Korean speaker uses each. NATIVE (하나, 스물)
   counts things — days, months, places; determiner forms (한, 두, 스무)
   because these words always stand before a counter here. SINO (이천이십육)
   reads years. Both spelled out: the numerals law does not change language. */
const KO_NATIVE_ONES = ["", "한", "두", "세", "네", "다섯", "여섯", "일곱", "여덟", "아홉"];
const KO_NATIVE_TENS = ["", "열", "스물", "서른", "마흔", "쉰", "예순", "일흔", "여든", "아흔"];
const KO_SINO_DIGITS = ["", "일", "이", "삼", "사", "오", "육", "칠", "팔", "구"];
const KO_MONTHS = [
  "일월", "이월", "삼월", "사월", "오월", "유월",
  "칠월", "팔월", "구월", "시월", "십일월", "십이월",
];

/** Native Korean count as a determiner — "두", "스무", "스물한". Digits past
    ninety-nine, same surrender as the English side. */
export function koNativeCount(n: number): string {
  if (n < 1 || n > 99) return String(n);
  if (n < 10) return KO_NATIVE_ONES[n];
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  /* bare twenty is 스무 before a counter; compounds keep 스물 (스물한) */
  if (ones === 0) return tens === 2 ? "스무" : KO_NATIVE_TENS[tens];
  return `${KO_NATIVE_TENS[tens]}${KO_NATIVE_ONES[ones]}`;
}

/** Sino-Korean number, spelled — 2026 → "이천이십육". Years wear this. */
export function koSinoNumber(n: number): string {
  if (n <= 0 || n > 9999) return String(n);
  const parts: string[] = [];
  const units = ["", "십", "백", "천"];
  const digits = String(n).split("").map(Number);
  digits.forEach((d, i) => {
    if (d === 0) return;
    const unit = units[digits.length - 1 - i];
    /* 일 is silent before a unit — 천구백, never 일천구백 */
    parts.push((d === 1 && unit !== "" ? "" : KO_SINO_DIGITS[d]) + unit);
  });
  return parts.join("");
}

/**
 * The full date stamp a person writes at the top of a page: `Aug 24, 2026` —
 * or `2026년 8월 24일`, which is what a Korean hand writes. The card's head
 * wears this instead of the spoken pair — "Two days ago · Aug 24" said the
 * same fact twice and went stale as the card stayed open (founder,
 * 2026-08-27: "just keep date. also add year"). The year is always present:
 * a memory product's dates are read across years, and a stamp that drops its
 * year is a stamp that will one day be misread by exactly the person this is
 * built for.
 */
export function dateStamp(ms: number, locale: WordsLocale = "en-US"): string {
  const d = new Date(ms);
  if (locale === "ko-KR") {
    return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
  }
  const month = d.toLocaleDateString("en-US", { month: "short" });
  return `${month} ${d.getDate()}, ${d.getFullYear()}`;
}

export function dateWords(ms: number, T: number, locale: WordsLocale = "en-US"): string {
  const d = new Date(ms);
  /*
   * A DATE IS READ, NOT COUNTED.
   *
   * "August twenty-third" spelled out obeyed the letter of "states render,
   * numerals never" and missed its point. That law is about STATES — a count
   * of members, a score, a tally — where a numeral turns a fact about people
   * into a readout. A calendar date is none of those: it is a label, everyone
   * already reads it as digits, and spelling it out makes the reader do
   * arithmetic to find out when something was.
   *
   * `Aug 23`, which is what a person writes down — `8월 23일` in the other
   * hand. The month stays short so it cannot be mistaken for a count, and the
   * year is only there when it is not this one.
   */
  if (locale === "ko-KR") {
    const md = `${d.getMonth() + 1}월 ${d.getDate()}일`;
    if (d.getFullYear() === new Date(T).getFullYear()) return md;
    return `${d.getFullYear()}년 ${md}`;
  }
  const month = d.toLocaleDateString("en-US", { month: "short" });
  if (d.getFullYear() === new Date(T).getFullYear()) return `${month} ${d.getDate()}`;
  return `${month} ${d.getDate()}, ${d.getFullYear()}`;
}
/**
 * A ROW ON THE DIAL, WHEN THE DAYS NO LONGER FIT.
 *
 * The dial offers the days something was kept on; past ten of them it rolls
 * up to the months that hold something, and past ten of those to the years.
 * Those two coarser rungs need their own label, and it is the same rule
 * `dateWords` follows one rung down: short enough that it cannot be mistaken
 * for a count, and carrying the year only when it is not this one — so a row
 * never wears a year its neighbours in the same list do not.
 *
 * `Aug`, `Aug 2025` — `8월`, `2025년 8월` in the other hand. They live here
 * rather than in the layout for the reason every other word does: one place
 * where the product's language is decided, and no language literals loose in
 * a component.
 */
export function dialMonth(ms: number, T: number, locale: WordsLocale = "en-US"): string {
  const d = new Date(ms);
  const thisYear = d.getFullYear() === new Date(T).getFullYear();
  if (locale === "ko-KR") {
    const m = `${d.getMonth() + 1}월`;
    return thisYear ? m : `${d.getFullYear()}년 ${m}`;
  }
  const month = d.toLocaleDateString("en-US", { month: "short" });
  return thisYear ? month : `${month} ${d.getFullYear()}`;
}

/**
 * THE LINE AT THE TOP OF A NOTE — the day AND the minute it was begun.
 *
 * Founder, with a screenshot of Apple Notes open on a blank note: "copy this
 * apple note experience." The one thing on that screen besides the words is a
 * grey line naming when the note was started — `October 11, 2026 at 11:07 AM`.
 *
 * It is the right line for this product too, and for a reason beyond the
 * reference: a page with nothing on it needs to say WHEN it is, because that
 * is the only fact about a note that exists before anybody writes in it.
 *
 * THE MONTH IS SPELLED IN FULL HERE, unlike `dateWords` one rung below. That
 * function shortens because its output sits in lists beside dozens of others
 * and has to stay scannable; this one is alone on a page and is being read
 * rather than scanned, so it can be the sentence a person would say.
 *
 * NO SECONDS AND NO TIMEZONE. A note is not an event log.
 */
export function momentStamp(ms: number, locale: WordsLocale = "en-US"): string {
  const d = new Date(ms);
  if (locale === "ko-KR") {
    const hour = d.getHours();
    const half = hour < 12 ? "오전" : "오후";
    const twelve = hour % 12 === 0 ? 12 : hour % 12;
    return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 ${half} ${twelve}:${String(d.getMinutes()).padStart(2, "0")}`;
  }
  const month = d.toLocaleDateString("en-US", { month: "long" });
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${month} ${d.getDate()}, ${d.getFullYear()} at ${time}`;
}

/**
 * THE DAY AND THE MINUTE, COMPACT — a moment named inside a sentence.
 *
 * `momentStamp` is the line standing alone at the top of a note, and it
 * spells its month in full because it is being read rather than scanned.
 * This is the same fact when it has to fit INSIDE a sentence somebody reads
 * once and moves on from: "Saved. The next reading is scheduled for Oct 11
 * at 7:05 AM." Exactly the relationship `dateWords` has to `dateStamp` one
 * rung up — short because it is surrounded by other words, not because it
 * matters less.
 *
 * COMPOSED FROM THE TWO FUNCTIONS THAT ALREADY SAY ITS HALVES, which is the
 * whole reason it is in this file rather than at its call site.
 * `InspirationProcessingNotice` carried
 * `new Intl.DateTimeFormat(locale, { month, day, hour, minute })` and printed
 * `Oct 11, 7:05 AM` — a comma where English says "at" — while the clock in
 * `AttachmentPreview` two inches away came out of a different option bag.
 * Two `Intl` calls agreeing is not a property anybody is holding: `Intl`
 * output moves with ICU versions and platforms, so the agreement was a
 * coincidence of today's Node and today's browser. Built out of `dateWords`
 * and `timeOf`, it cannot drift from the surfaces that print either half.
 *
 * THE YEAR FOLLOWS `dateWords`: present only when it is not this one. A
 * scheduled reading is usually minutes away, so in practice the year never
 * shows — but a queue that has been stuck since December must not tell
 * somebody in January that it will be read "Dec 3".
 */
export function momentTag(ms: number, T: number, locale: WordsLocale = "en-US"): string {
  const day = dateWords(ms, T, locale);
  const clock = timeOf(ms, locale);
  /* Korean needs no joiner — 날짜 다음에 시각이 바로 온다 — and inserting one
     would be an English habit wearing Hangul. */
  return locale === "ko-KR" ? `${day} ${clock}` : `${day} at ${clock}`;
}

/**
 * JUST THE CLOCK — a turn's own timestamp in a transcript.
 *
 * Founder, of the chat: "make the chat message thing also follow what you
 * see on this AI chat conversation." Every message in that reference
 * carries a bare time under the last bubble of its run — `2:30 PM` — and
 * that is all it carries, because a transcript you are reading top to
 * bottom already tells you the day.
 *
 * NOT `momentStamp`, WHICH IS THE WHOLE DATE. That one is alone on a page
 * and is the only fact there; this one appears a dozen times down a column
 * and has to disappear when you are not looking for it. Same reasoning as
 * `dateWords` beside an archive row, one scale smaller.
 */
export function timeOf(ms: number, locale: WordsLocale = "en-US"): string {
  const d = new Date(ms);
  if (locale === "ko-KR") {
    const hour = d.getHours();
    const twelve = hour % 12 === 0 ? 12 : hour % 12;
    return `${hour < 12 ? "오전" : "오후"} ${twelve}:${String(d.getMinutes()).padStart(2, "0")}`;
  }
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/**
 * WHICH STRETCH OF TIME A SAVE FALLS IN — the archive's own chapter headings.
 *
 * Founder, with a screenshot of the Apple Notes list: "copy this for saved
 * inspirations." That list is not a flat run of rows; it is broken into
 * `Previous 7 Days`, `Previous 30 Days`, then a heading per month. The break
 * is what makes a long archive readable without a single date on a row having
 * to be compared against its neighbour.
 *
 * WHY THESE FOUR RUNGS AND NOT A DATE PER DAY. A heading per day turns a week
 * of saving into seven headings and seven lists of one. The reference's
 * coarseness is the design: recent things are remembered by how long ago, and
 * older things by which month — which is exactly how a person asks for them.
 *
 * RETURNS A KEY AND ITS WORDS, because the caller groups by the key and prints
 * the words. Deriving the key from the words would make two saves in the same
 * month in different years collapse into one heading.
 */
export function archiveChapter(
  ms: number,
  T: number,
  locale: WordsLocale = "en-US",
): { key: string; words: string } {
  const day = 86_400_000;
  const age = T - ms;
  if (age < 7 * day) return { key: "d7", words: locale === "ko-KR" ? "지난 7일" : "Previous 7 Days" };
  if (age < 30 * day) return { key: "d30", words: locale === "ko-KR" ? "지난 30일" : "Previous 30 Days" };
  const d = new Date(ms);
  const key = `${d.getFullYear()}-${d.getMonth()}`;
  const thisYear = d.getFullYear() === new Date(T).getFullYear();
  if (locale === "ko-KR") {
    const m = `${d.getMonth() + 1}월`;
    return { key, words: thisYear ? m : `${d.getFullYear()}년 ${m}` };
  }
  const month = d.toLocaleDateString("en-US", { month: "long" });
  return { key, words: thisYear ? month : `${month} ${d.getFullYear()}` };
}

/** The coarsest rung the dial rolls up to. `2025` — `2025년`. */
export function dialYear(ms: number, locale: WordsLocale = "en-US"): string {
  const y = new Date(ms).getFullYear();
  return locale === "ko-KR" ? `${y}년` : `${y}`;
}

/**
 * The name a whisper says: the given name alone. The first whitespace-
 * separated part, which is the given name in a Western name and the whole of
 * a Korean one, since those are written without a space.
 */
export function givenName(full: string): string {
  const first = full.trim().split(/\s+/)[0];
  return first || full.trim();
}
/**
 * WHO IS IN THIS ROOM — said in words, and no longer said at all.
 *
 * `groupCompany` turned a room's member list into "with Jina and Minsu". Its
 * only reader was the wall's eyebrow, and the eyebrow is gone: the room now
 * DRAWS its company — a figure per member, standing in the ground, each one
 * giving its name when you reach for it. That is the same fact in the channel
 * this world actually has, so the sentence was a second telling of something
 * already on screen. Removed rather than kept warm; `git show 65f6ce1` has it
 * if the drawing ever needs words back.
 */

/* `ordWords` IS GONE — ordinals as words, "twenty-fifth" rather than "25th",
   called by nothing. The one ordinal this product still prints is the
   archive's row number, and the founder's ruling put that in DIGITS on
   purpose: "it's like your fifth inspiration, your 100th inspiration", set
   as an italic accent numeral (`.waka-list-index`). A spelled-out ordinal
   would make a person do arithmetic to find out which save they are looking
   at, which is the same argument `dateWords` makes about dates. */
/**
 * A year the way it is spoken — "twenty twenty-six", never "2026". The
 * two-thousands take the other form ("two thousand seven") until the tens
 * arrive, which is simply how people say them out loud.
 */
export function yearWords(y: number): string {
  if (y < 1100 || y > 2099) return String(y);
  const hi = Math.floor(y / 100);
  const lo = y % 100;
  if (hi === 20 && lo < 10) return lo === 0 ? "two thousand" : `two thousand ${numWords(lo)}`;
  return `${numWords(hi)} ${numWords(lo)}`;
}
/** Numbers as words, up to ninety-nine — "두", determiner-form, in Korean.
    Counts are prose here, never digits. */
export function numWords(n: number, locale: WordsLocale = "en-US"): string {
  if (locale === "ko-KR") return koNativeCount(n);
  if (n < 20) return ONES[n] ?? String(n);
  if (n > 99) return String(n);
  const t = TENS[Math.floor(n / 10)];
  const o = n % 10;
  return o === 0 ? t : `${t}-${ONES[o]}`;
}

/**
 * ═══ A CLAUSE BECOMING A SENTENCE TAKES A CAPITAL ══════════════════════
 *
 * The weather's clauses are written to be joined — "you kept a memory",
 * "your memory was consulted 170 times" — so the API composes them lower
 * case on purpose, and that is right for a clause. The moment one is spoken
 * ALONE, by the creature or on its own line, it stops being a clause and
 * becomes a sentence, and the founder's ruling covers every sentence a
 * person reads: *"make sure that like everything has the first character of
 * the word capitalized."*
 *
 * `capitalized.test.ts` could not see these. It reads the web's own
 * catalogue, and these strings are assembled on the server out of row
 * counts — so "you kept a memory." has been in the creature's mouth, lower
 * case, for as long as the weather has existed. Same shape as the
 * `text-transform: lowercase` found earlier the same day: a rule enforced
 * on one layer and undone on another.
 *
 * HANGUL IS LEFT ALONE, because it has no case to change — the same reason
 * `capitalized.test.ts` is silent on the Korean catalogue. `toLocaleUpperCase`
 * on a Hangul syllable returns the syllable, so this is a no-op there rather
 * than a special case, but it is written down so nobody "fixes" it later.
 */
export function asSentence(clause: string, locale: WordsLocale = "en-US"): string {
  const words = clause.trimStart();
  if (!words) return clause;
  return words[0]!.toLocaleUpperCase(locale) + words.slice(1);
}
