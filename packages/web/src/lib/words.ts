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
 */
import type { ApiGroupMember } from "./api";
import { DAY_MS } from "./num";

/**
 * How long ago, ALWAYS as a relative phrase in words — "Today", "Yesterday",
 * "Last week", "Eighty-seven days ago". It is paired with the absolute date,
 * so it must never fall back to naming the date itself or the panel's meta
 * line prints the same string twice.
 */
export function agoWords(ms: number, T: number): string {
  const days = Math.floor((T - ms) / DAY_MS);
  const cap = (s: string) => `${s[0].toUpperCase()}${s.slice(1)}`;
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${cap(numWords(days))} days ago`;
  if (days < 14) return "Last week";
  if (days < 100) return `${cap(numWords(days))} days ago`;
  const months = Math.round(days / 30);
  return months < 2 ? "A few months ago" : `${cap(numWords(months))} months ago`;
}

/** The month a scrub is standing in, spoken — "June twenty twenty-six". */
export function monthTag(ms: number): string {
  const d = new Date(ms);
  return `${d.toLocaleDateString("en-US", { month: "long" })} ${yearWords(d.getFullYear())}`;
}

/** The collapsed links sentence, adapted for a group: what cited this save. */
export function citedWords(titles: string[]): string {
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

export function dateWords(ms: number, T: number): string {
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
   * `Aug 23`, which is what a person writes down. The month stays short so it
   * cannot be mistaken for a count, and the year is only there when it is not
   * this one.
   */
  const month = d.toLocaleDateString("en-US", { month: "short" });
  if (d.getFullYear() === new Date(T).getFullYear()) return `${month} ${d.getDate()}`;
  return `${month} ${d.getDate()}, ${d.getFullYear()}`;
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
 * WHAT KIND OF COMPANY THIS IS.
 *
 * Four rooms with four different populations were four identical walls: the
 * one where you sit alone, the one you share with your own agent, the one
 * with four other people in it, and the one where five machines talk about
 * their work all read the same. Who is in a room is the single most important
 * thing about it — you speak differently in each — so the eyebrow carries it
 * beside the name.
 *
 * In words and never as a count, and never as a badge: it is a description of
 * the company, which is what a person would actually say about a room.
 */
export function groupCompany(members: ApiGroupMember[] | undefined): string | null {
  if (!members || members.length === 0) return null;
  const agents = members.filter((m) => m.type === "agent").length;
  const people = members.length - agents;
  if (members.length === 1) return "on your own";
  if (people === 0) return "agents only";
  if (agents === 0) return people === 2 ? "the two of you" : "people";
  if (people === 1 && agents === 1) return "you and your agent";
  return "people and agents";
}

/** Ordinals as words — "twenty-fifth", never "25th". */
export function ordWords(n: number): string {
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
/** Numbers as words, up to ninety-nine. Counts are prose here, never digits. */
export function numWords(n: number): string {
  if (n < 20) return ONES[n] ?? String(n);
  if (n > 99) return String(n);
  const t = TENS[Math.floor(n / 10)];
  const o = n % 10;
  return o === 0 ? t : `${t}-${ONES[o]}`;
}
