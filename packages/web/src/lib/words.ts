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

/** The month a scrub is standing in, spoken — "June twenty twenty-six",
    "이천이십육년 유월". Korean says the year first, because Korean does. */
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
const ORD_ONES = [
  "zeroth", "first", "second", "third", "fourth", "fifth", "sixth", "seventh",
  "eighth", "ninth", "tenth", "eleventh", "twelfth", "thirteenth", "fourteenth",
  "fifteenth", "sixteenth", "seventeenth", "eighteenth", "nineteenth",
];
const ORD_TENS = [
  "", "", "twentieth", "thirtieth", "fortieth", "fiftieth", "sixtieth",
  "seventieth", "eightieth", "ninetieth",
];
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

/** Ordinals as words — "twenty-fifth" / "스물다섯 번째", never "25th". */
export function ordWords(n: number, locale: WordsLocale = "en-US"): string {
  if (locale === "ko-KR") {
    if (n < 1 || n > 99) return String(n);
    return n === 1 ? "첫 번째" : `${koNativeCount(n)} 번째`;
  }
  if (n < 20) return ORD_ONES[n] ?? String(n);
  if (n > 99) return String(n);
  const o = n % 10;
  return o === 0 ? ORD_TENS[Math.floor(n / 10)] : `${TENS[Math.floor(n / 10)]}-${ORD_ONES[o]}`;
}
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
