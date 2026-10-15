#!/usr/bin/env tsx
/**
 * Seed the recordable demo world on a local stack, through the public API
 * only — the same calls the clients make, so every frame shows the product,
 * never a hand-arranged database. goal: no-quiet-corners, Track D.
 *
 * Cast: Yunji founds "the reading circle"; Bo and Cy join; Dee joins and is
 * removed (a door mark). Yunji's captures derive real signals via the live
 * model; one gets said in her own words (a star). Signals are shared to the
 * wall; Bo answers one; Bo proposes and Cy says no (the counted stance —
 * the question stays open); Yunji proposes and Bo carries it (the room's
 * first spoken version).
 *
 *   pnpm dev:local                 # in one terminal, with GEMINI_API_KEY set
 *   pnpm tsx tools/demo/seed.ts    # in another — takes a few minutes
 *
 * Prints the login credentials as JSON on the LAST line; `walk.mjs` reads
 * them to verify every scene of the README's shot list is on screen.
 */
import {
  capture,
  DEFAULT_BASE_URL,
  listSignals,
  signUp,
  waitFor,
  type Session,
} from "../e2e/organic";

const BASE = process.env.WAKA_DEMO_BASE_URL ?? DEFAULT_BASE_URL;

async function api<T>(
  session: Session,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: init.method ?? (init.body === undefined ? "GET" : "POST"),
    headers: {
      Authorization: `Bearer ${session.token}`,
      ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const raw = await res.text();
  if (!res.ok) {
    throw new Error(`${init.method ?? "GET"} ${path} → ${res.status}: ${raw.slice(0, 300)}`);
  }
  return raw ? (JSON.parse(raw) as T) : (undefined as T);
}

/* `WallSignal` WENT with the room block: it described what
   `/api/groups/:id/wall` served, and nothing serves that now. */

async function firstSignal(session: Session, label: string) {
  return waitFor(
    async ({ note }) => {
      const signals = await listSignals(session, { limit: 50 });
      note(`${signals.length} signals`);
      return signals[0] ?? null;
    },
    { timeoutMs: 120_000, label },
  );
}

async function main() {
  const password = "demo-pass-4712!A";
  const yunji = await signUp({
    baseUrl: BASE,
    name: "Yunji",
    password,
    email: `yunji.demo.${Date.now()}@example.test`,
  });
  const bo = await signUp({ baseUrl: BASE, name: "Bo", password });
  /* Cy and Dee are still signed up -- four real accounts is what this seed
     is for -- but nothing binds them now that the room they joined is gone.
     Bo keeps a binding because Bo still writes their own memories below. */
  await signUp({ baseUrl: BASE, name: "Cy", password });
  await signUp({ baseUrl: BASE, name: "Dee", password });

  /* Yunji's archive — coherent enough that the live model mints a pattern.
     PUBLIC, because since 2026-08-24 a room reads its members' public
     memories and grows its own statements from them; a private archive
     leaves the demo's room with a wall that is correctly, and unhelpfully,
     empty. */
  for (const text of [
    "Skipped the team dinner to walk the river path again. Third time this month choosing a walk over a crowd.",
    "Turned down the conference invite. A quiet afternoon reading beat the networking hall, again.",
    "The best conversation this week happened on a walk, not in the meeting room.",
    "Planned another depth day — one topic, no tabs. The wide-open days leave nothing behind.",
    "Said no to the group trip. Two friends, one trail, real talk.",
  ]) {
    await capture(yunji, { text, visibility: "public" });
  }
  /* Bo's ground has to MEET Yunji's, not merely exist beside it: a room
     statement is served only where two members' memories stand under the
     same one, so these say the same thing about crowds and walking that
     hers do, in his own words. His shipping-small memories stay too — they
     are his own pattern, and a room that grew one statement rather than
     every statement is the honest demo. */
  for (const text of [
    "Shipped the tiny version today instead of polishing the grand one. It already taught me more.",
    "Cut the feature list in half and the demo got better. Small and finished beats big and imagined.",
    "Left the launch party after twenty minutes and walked home along the canal instead.",
    "Skipped the all-hands and took the long walk. The thinking happened on the walk, as usual.",
    "Turned down another mixer. One friend, one trail, and an actual conversation.",
  ]) {
    await capture(bo, { text, visibility: "public" });
  }

  const yunjiSignal = await firstSignal(yunji, "Yunji's first signal");
  /* BO'S SIGNAL STILL FORMS, for a smaller reason than before. This waited
     up to 120s so Bo's layer 2 existed before the ROOM read anything, or the
     room's read raced his derivation. There is no room to race now. It is
     kept because the demo's point is that these are real accounts with real
     derived memory, and Bo is the only other person who writes — but if this
     seed ever needs to be faster, this is the two minutes to reclaim. */
  await firstSignal(bo, "Bo's first signal");

  // The star: Yunji says it in her own words — the edit locks.
  await api(yunji, `/api/signals/${yunjiSignal.id}`, {
    method: "PATCH",
    body: { statement: "I choose walks and depth over crowds — meetings are the exception." },
  });

  // Her own poster.
  await api(yunji, "/api/top-of-mind/refresh", { method: "POST", body: {} });

  /* THE ROOM WENT OUT OF THE DEMO SEED (2026-10-15). Everything from here
     drove `/api/groups`, `/join`, `/members`, `/wall`, `/proposals` and
     `/top-of-mind/versions` to stage a four-person reading circle: a
     declined ask, an affirmed one, and the room's first board version.
     Those routes are gone, so the seed threw partway through and left a
     half-built demo account behind rather than failing cleanly.

     WHAT THE DEMO LOSES: the only scripted multi-person story in the repo.
     Bo, Cy and Dee are still signed up, and only Bo keeps anything, so
     this still produces four real accounts -- what it no longer produces is
     anything they share. If a group story is wanted again it has to be
     seeded in SQL, the same note as `erasure.ts`. */
  console.log(
    JSON.stringify({ email: yunji.email, password, yunjiSignalId: yunjiSignal.id }),
  );
}

await main();
