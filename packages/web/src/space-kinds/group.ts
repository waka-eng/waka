/**
 * A GROUP AS A SPACE: the wall a group is drawn as, and what furnishes it.
 *
 * `index.ts` beside this file says what KINDS of space exist and which of them
 * have a sky or a dial. This says what a group's own wall is made of: the
 * shared signals that become its orbs (`groupWallOrbs`), how one of those is
 * built into a ball (`makeGroupBall`), and what its headquarters says
 * (`deriveGroupChrome`).
 *
 * The canon draws the boundary this module exists to hold: sharing is a
 * per-signal choice, an inspiration never crosses an account boundary, and a
 * member may see THAT someone's shared signal fed an entry, never which one.
 * Everything here works from `ApiGroupWallSignal` — the shared statement — and
 * never from anyone's raw saves, so the boundary is enforced by what this file
 * is able to reach rather than by remembering not to.
 */
import type { ApiGroupTopOfMind, ApiGroupWallSignal } from "../lib/api";
import { hashStr, TAU } from "../lib/num";
import { colorBall } from "../space/inspiration/field";
import { scatterSeed, type Ball } from "../space/inspiration/orb";
import { formingWords, type WallChrome } from "../space/top-of-mind/board";


/** One deduped evidence signal: a save this room's readings cited. */
export interface GroupEvidence {
  signalId: string;
  textPreview: string;
  quote: string | null;
  kind: string | null;
  createdMs: number;
  authorUserId: string;
  authorName: string;
  /** Every reading of the room's that cited it — the panel's links sentence. */
  citedBy: string[];
}

/** Everything a room needs before it is allowed to wake. Cached per session. */
export interface GroupData {
  evidence: GroupEvidence[];
  top: ApiGroupTopOfMind | null;
}

/**
 * A ROOM IS A WALL OF STATEMENTS, AND EVERYTHING ELSE STAYS HOME.
 *
 * This used to build a room's orbs out of the evidence its readings cited —
 * other people's raw memories, previewed and quoted. The canon closed that:
 * sharing is a per-signal choice, an inspiration never crosses an account
 * boundary, and "a member may see that someone's shared signal fed an entry,
 * never which one".
 *
 * So a room's orbs are the shared PATTERNS themselves. Each carries whose it
 * is, and what it says. There is no quote, because the words behind it were
 * never sent and inventing one here would be the leak the canon forbids.
 * `citedBy` names the readings this member contributed to — attribution by
 * person, which is the finest grain the room is allowed to know.
 */
export function groupWallOrbs(wall: ApiGroupWallSignal[], top: ApiGroupTopOfMind | null): GroupEvidence[] {
  const fedBy = new Map<string, string[]>();
  for (const entry of top?.entries ?? []) {
    for (const c of entry.contributors) {
      const got = fedBy.get(c.profileId);
      if (got) {
        if (!got.includes(entry.body)) got.push(entry.body);
      } else fedBy.set(c.profileId, [entry.body]);
    }
  }
  const seen = new Map<string, GroupEvidence>();
  for (const s of wall) {
    if (seen.has(s.signalId)) continue;
    seen.set(s.signalId, {
      signalId: s.signalId,
      textPreview: s.statement,
      quote: null,
      kind: null,
      createdMs: Date.parse(s.sharedAt) || Date.now(),
      authorUserId: s.ownerProfileId,
      authorName: s.ownerName,
      citedBy: fedBy.get(s.ownerProfileId) ?? [],
    });
  }
  return [...seen.values()];
}

/**
 * A room orb: the same ball, built from an evidence preview. Aliveness decays
 * from `createdAt` on the personal jar's own half-life; the reflection and
 * note boosts are omitted because the payload cannot know them. Tint hashes
 * the signal id — evidence previews carry no theme terms.
 */
export function makeGroupBall(
  ev: GroupEvidence,
  groupId: string,
  colIdx: number,
  viewerId: string | null,
): Ball {
  const r = 24 + ((hashStr(ev.signalId + "r") % 1000) / 1000) * 8;
  const b: Ball = {
    id: `${groupId}:${ev.signalId}`,
    capturedMs: ev.createdMs,
    updatedMs: ev.createdMs,
    reflections: 0,
    hasNotes: false,
    frontier: false,
    hasGroup: false,
    textPreview: ev.textPreview,
    kind: ev.kind,
    quote: ev.quote,
    terms: [],
    r,
    rBase: r,
    sizeIdx: r < 26.5 ? 0 : r < 29.8 ? 1 : 2,
    frac: (hashStr(ev.signalId) % 1000) / 1000,
    scat: scatterSeed(ev.signalId),
    x: 0,
    y: 0,
    homeX: 0,
    homeY: 0,
    peekX: 0,
    peekY: 0,
    ampX: 10 + Math.random() * 8,
    ampY: 10 + Math.random() * 8,
    ampBaseX: 0,
    ampBaseY: 0,
    rateX: TAU / (7 + Math.random() * 6),
    rateY: TAU / (7 + Math.random() * 6),
    phX: Math.random() * TAU,
    phY: Math.random() * TAU,
    arrive: 1,
    entryH: 0,
    active: false,
    leaving: false,
    gone: 0,
    spawnAt: -1,
    peek: false,
    relightAt: 0,
    relight: 0,
    aliveFrom: 0,
    aliveTo: 0,
    alive: 0,
    alivePow: 0,
    breathRate: 0.9 + Math.random() * 0.5,
    breathPhase: Math.random() * TAU,
    hold: 0,
    dim: 0,
    glow: 0,
    press: 0,
    img: null,
    imgUrl: null,
    col: colIdx,
    sigId: ev.signalId,
    authorName: ev.authorName,
    own: viewerId !== null && ev.authorUserId === viewerId,
    citedBy: ev.citedBy,
    origin: "human",
    lens: 0,
  };
  b.ampBaseX = b.ampX;
  b.ampBaseY = b.ampY;
  colorBall(b, Date.now());
  return b;
}

/**
 * What the room's HQ will say, resolved before the room may wake.
 *
 * A group's artifact is the same one-artifact shape as a person's: entries,
 * pinned or in order, changed together through proposals. The room's poster is
 * its lead entry — pinned first, otherwise the top of the order — and there is
 * no generated stand-in when there is none.
 */
export function deriveGroupChrome(
  name: string,
  top: ApiGroupTopOfMind,
  openProposalMs: number | null,
  evidence: GroupEvidence[],
  company: string | null,
): WallChrome {
  const lead = top.entries.find((e) => e.pinnedAt) ?? top.entries[0] ?? null;
  const ambition = lead?.body ?? null;
  return {
    eyebrow: company ? `${name} \u00b7 ${company}` : name,
    text: ambition,
    awayFrom: null,
    formingAlt: ambition ? null : "Forming — nothing read together yet",
    asOf: null,
    /* A room forms through proposals, not through signals overhead: members'
       signals stay on their own walls, so an open proposal is the only thing
       a room has that is on its way to becoming what it believes. */
    forming: formingWords(Date.now(), openProposalMs, null),
    empty: evidence.length === 0,
    prevText: null,
  };
}
