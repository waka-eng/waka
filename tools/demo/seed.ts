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
  const cy = await signUp({ baseUrl: BASE, name: "Cy", password });
  const dee = await signUp({ baseUrl: BASE, name: "Dee", password });

  // Yunji's archive — coherent enough that the live model mints a pattern.
  for (const text of [
    "Skipped the team dinner to walk the river path again. Third time this month choosing a walk over a crowd.",
    "Turned down the conference invite. A quiet afternoon reading beat the networking hall, again.",
    "The best conversation this week happened on a walk, not in the meeting room.",
    "Planned another depth day — one topic, no tabs. The wide-open days leave nothing behind.",
    "Said no to the group trip. Two friends, one trail, real talk.",
  ]) {
    await capture(yunji, { text });
  }
  for (const text of [
    "Shipped the tiny version today instead of polishing the grand one. It already taught me more.",
    "Cut the feature list in half and the demo got better. Small and finished beats big and imagined.",
  ]) {
    await capture(bo, { text });
  }

  const yunjiSignal = await firstSignal(yunji, "Yunji's first signal");
  const boSignal = await firstSignal(bo, "Bo's first signal");

  // The star: Yunji says it in her own words — the edit locks.
  await api(yunji, `/api/signals/${yunjiSignal.id}`, {
    method: "PATCH",
    body: { statement: "I choose walks and depth over crowds — meetings are the exception." },
  });

  // Her own poster.
  await api(yunji, "/api/top-of-mind/refresh", { method: "POST", body: {} });

  // The room.
  const created = await api<{ group: { id: string; joinCode: string } }>(yunji, "/api/groups", {
    body: { name: "the reading circle" },
  });
  const groupId = created.group.id;
  for (const person of [bo, cy, dee]) {
    await api(person, "/api/groups/join", { body: { joinCode: created.group.joinCode } });
  }
  // Dee passes through — a removal mark on the door.
  await api(yunji, `/api/groups/${groupId}/members/${dee.profileId}`, { method: "DELETE" });

  // The wall: two statements, owned.
  await api(yunji, `/api/signals/${yunjiSignal.id}/shares`, { body: { groupId } });
  await api(bo, `/api/signals/${boSignal.id}/shares`, { body: { groupId } });

  // Bo answers Yunji's statement — a named reaction, lit on the wall.
  await api(bo, "/api/feedback", {
    body: { targetType: "signal", targetId: yunjiSignal.id, value: "true" },
  });

  // Bo puts a sentence to the room; Cy says no — one counted stance of
  // three, and the question stays open on the panel.
  const boAsk = await api<{ proposal: { id: string } }>(bo, `/api/groups/${groupId}/proposals`, {
    body: { kind: "add_entry", body: "We keep choosing walks over meetings." },
  });
  await api(cy, `/api/groups/${groupId}/proposals/${boAsk.proposal.id}/decline`, {
    method: "POST",
    body: {},
  });

  // Yunji puts one up and Bo carries it — the room first speaks.
  const carried = await api<{ proposal: { id: string } }>(
    yunji,
    `/api/groups/${groupId}/proposals`,
    { body: { kind: "add_entry", body: "This circle reads for depth, not for volume." } },
  );
  await api(bo, `/api/groups/${groupId}/proposals/${carried.proposal.id}/affirm`, {
    method: "POST",
    body: {},
  });

  // Wait until the room's version exists — the walk expects a spoken room.
  await waitFor(
    async ({ note }) => {
      const versions = await api<{ versions: unknown[] }>(
        yunji,
        `/api/groups/${groupId}/top-of-mind/versions`,
      );
      note(`${versions.versions.length} versions`);
      return versions.versions.length > 0 ? versions : null;
    },
    { timeoutMs: 60_000, label: "the room's first version" },
  );

  console.log(
    JSON.stringify({ email: yunji.email, password, groupId, yunjiSignalId: yunjiSignal.id }),
  );
}

await main();
