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

/**
 * The absolute date, spelled all the way out — "May eighteenth", and with the
 * year when it is not this one. It used to format the day (and sometimes the
 * year) as digits, which put "June 25" in the panel directly beside a
 * relative line that obeyed the rule: states render, numerals never. The
 * spelled form is also the one a person would say aloud, which is the test
 * this whole surface is written to.
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
  const month = d.toLocaleDateString("en-US", { month: "long" });
  const day = ordWords(d.getDate());
  if (d.getFullYear() === new Date(T).getFullYear()) return `${month} ${day}`;
  return `${month} ${day}, ${yearWords(d.getFullYear())}`;
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
 * WHO IS HERE, IN WORDS AND NEVER AS A COUNT.
 *
 * "Three others" is a number wearing a sentence, and this page does not
 * render numerals. Names are what a person actually wants anyway. Past three
 * it says the first two and how many more — which is how anybody would say it
 * out loud.
 */
export function whoWords(rows: ApiGroupMember[]): string {
  const names = rows.map((r) => givenName(r.name)).filter(Boolean);
  if (names.length === 0) return "Who is here";
  if (names.length <= 3) return names.join(", ");
  return `${names[0]}, ${names[1]} and ${numWords(names.length - 2)} more`;
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
export function roomCompany(members: ApiGroupMember[] | undefined): string | null {
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
