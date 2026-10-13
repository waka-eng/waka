/**
 * THE ROOM'S COMPANY — who stands behind your companion, and where.
 *
 * ── THERE IS NO COMPANY LEFT TO PLACE (2026-10-12) ───────────────────────
 *
 * Founder: "방 없애" — remove rooms. Every room surface in the product is
 * gone, `members` is a permanently-empty map in `pages/Home`, and
 * `groupCompanyPlaces` is therefore called with `undefined` on the one
 * branch that still calls it. THIS FILE AND ITS TEST SURVIVE THIS CHANGE FOR
 * ONE REASON: `canvas/simulation.ts` imports `groupCompanyPlaces`,
 * `noticeLight`, `NOTICE_MS` and `CompanyPlace` by name, and that file is
 * owned by another change in flight and may not be edited from here. It goes
 * the moment the loop's group branches do — along with the research below,
 * which is the only part anybody should be sorry to lose.
 *
 * founder, 2026-08-27: "if room is group, show the character as many times as
 * number of members are there. but the character should feel like its behind
 * mine, and more small and subtle."
 *
 * This module is the half of that which is a FACT rather than a frame: which
 * members appear, in what order, at what offsets. The sim multiplies the
 * offsets by the companion's size and does the drawing; keeping the placement
 * pure is what lets a test hold the three rules that would otherwise only
 * break visibly in a live room with real people in it:
 *
 *   - the viewer is never among them — your companion already IS you, and a
 *     room that drew you twice would be a room with a stranger in it;
 *   - humans stand before machines, and otherwise in the room's own member
 *     order — the same order the legend, the hues and `groupCompany`'s words
 *     are numbered from, so the company reads in the same sequence everywhere
 *     the room is named;
 *   - every offset is derived from the member's id and their seat, and from
 *     nothing else — the world never moves unless the user moved it, and that
 *     includes nobody reshuffling between frames or between visits.
 *
 * Offsets are in units of the companion's size, so the placement scales with
 * the being it stands behind rather than with the viewport.
 *
 * ── THE SECOND PASS: A GROUP OF PEOPLE, NOT A ROW OF COPIES ──────────────
 *
 * founder, 2026-08-27, on a screenshot of three grey blobs in a line:
 * "conduct research on how to make this group characters also have higher
 * quality craft and interactions. look at how game uses npc and characters
 * around the main."
 *
 * What that research says, and what each finding becomes here:
 *
 *   - AMBIENT CHARACTERS NEED IDLE VARIETY. A crowd sharing one idle loop
 *     "breaks immersion immediately"; the working number is 3–5 variants per
 *     archetype, with randomised start times. So a member draws one of four
 *     ways of standing (`idle`), phased by its own id — not one bob for
 *     everybody at different speeds, which is the same behaviour wearing a
 *     different clock.
 *   - DEPTH IS CUED BY LIGHT AND FOCUS, NOT BY ALPHA ALONE. Background
 *     characters "fall into shadow or softer highlights" and separate onto
 *     planes. So every member carries a `depth` — how far behind you it
 *     stands — and the sim spends it on size, tier and alpha at once, and
 *     paints far ones first so the near ones overlap them. A row of
 *     identical values IS the flat grey the founder photographed.
 *   - REACTION STATES ARE THE MOST NEGLECTED AND THE MOST MISSED. "NPCs
 *     without reaction states feel scripted regardless of how good the idle
 *     is." The sim owns the reactions (a member lights and says its name
 *     when noticed, and glances where your companion looks); what belongs
 *     here is `notice`, the per-member delay that keeps a room from
 *     answering you in unison.
 *
 * All of it stays derived from the id: same room, same people, same places,
 * every visit.
 */
import { unit } from "../character/body";
import type { ApiGroupMember } from "../lib/api";

/** How many ways there are to stand. See `idle` below. */
/* NOT EXPORTED: `groupCompanyPlaces` below is its only reader and lives
   here. It was public for a sim that reads the places and not the count. */
const COMPANY_IDLES = 4;

export interface CompanyPlace {
  profileId: string;
  /** a machine member wears the machine bake — pixels, colder light */
  agent: boolean;
  /** horizontal offset from the companion's centre, in companion sizes */
  dx: number;
  /** vertical offset — always negative: behind means above and beyond */
  dy: number;
  /** where its hover starts, 0..1 — so a row of beings breathes out of step */
  phase: number;
  /**
   * How far behind you this one stands, 0 (nearest) to 1 (furthest).
   *
   * One number, three channels: the sim reads it for size, for which light
   * tier the body is baked at, and for alpha — which is what a photographer
   * means by separating planes. Derived from the seat's own place in the arc
   * (the edges stand further back) plus a per-id nudge, so no two members
   * share a plane exactly and a group never reads as one flat card.
   */
  depth: number;
  /**
   * Which of the four ways of standing this member has: 0 breathes, 1 sways,
   * 2 shifts its weight now and then, 3 stands nearly still and turns its
   * head instead. Assigned from the id, so a person stands the same way in
   * the same room every time you visit — a member whose idle changed between
   * visits would be a different person wearing the same name.
   */
  idle: number;
  /**
   * Seconds of delay before this member answers something — a glance, a
   * notice. A room that turns to you in unison is a chorus line; people
   * answer raggedly, and the raggedness is the life.
   */
  notice: number;
}

export function groupCompanyPlaces(
  members: ApiGroupMember[] | undefined,
  viewerId: string | null,
): CompanyPlace[] {
  if (!members || members.length === 0) return [];
  /* without knowing which one is you, drawing anyone risks drawing you —
     same guard, same reason, as `groupCompany`'s words */
  if (!viewerId) return [];
  const others = members.filter((m) => m.profileId !== viewerId);
  const ordered = [
    ...others.filter((m) => m.type !== "agent"),
    ...others.filter((m) => m.type === "agent"),
  ];
  const n = ordered.length;
  return ordered.map((m, i) => {
    /* a shallow arc behind and above: centred on yours, rising a little
       toward the edges, with a per-id nudge so a full room does not read as
       a picket fence */
    const k = i - (n - 1) / 2;
    const spread = n > 1 ? Math.abs(k) / ((n - 1) / 2) : 0;
    return {
      profileId: m.profileId,
      agent: m.type === "agent",
      /* WIDE ENOUGH TO CLEAR YOUR OWN LIGHT. At 0.6 apart and half a size up
         the company stood inside the companion's aura, where the bloom
         washes everything to the same pale grey — which is most of what the
         founder's "flat" screenshot actually shows. They stand further out
         and further back now, in their own dark, where the depth channels
         below can be seen at all. */
      dx: k * 0.78 + (unit(m.profileId, "cx") - 0.5) * 0.16,
      dy: -(0.66 + Math.abs(k) * 0.05) + (unit(m.profileId, "cy") - 0.5) * 0.1,
      phase: unit(m.profileId, "bp"),
      /* the arc bends away from you, so the ends of it are further off; the
         nudge keeps two members at the same seat-distance off one plane */
      depth: Math.min(1, spread * 0.72 + unit(m.profileId, "dp") * 0.28),
      idle: Math.floor(unit(m.profileId, "id") * COMPANY_IDLES) % COMPANY_IDLES,
      /* up to three quarters of a second: long enough to be visibly ragged,
         short enough that nobody looks slow */
      notice: unit(m.profileId, "nt") * 0.75,
    };
  });
}

/** How long a notice lasts, in milliseconds, before the member lets go. */
export const NOTICE_MS = 1900;

/**
 * HOW BRIGHT A NOTICED MEMBER IS, AND HOW BRIGHT ITS NAME IS — which are two
 * answers, not one.
 *
 * Founder, 2026-08-27, asking for this: "hovering/clicking on characters in
 * the background should show the name of the person above the character
 * temporarily and character should also brighten up temporarily." Built as
 * one value, so the name inherited the body's `notice` — the per-member delay
 * that keeps a room from turning to you in unison.
 *
 * Founder, 2026-09-08: "when in a room when I click on one of the agents
 * behind me, it takes a few seconds for the name to appear. It should show
 * immediately upon hover or click." MEASURED from the arithmetic that stood
 * here: the delay was `notice` (0 to 0.75s, drawn from the member's id) plus
 * a 0.18s ramp, so between nothing and 0.93 seconds depending on WHICH member
 * you pointed at — the same gesture answering at a different speed each time,
 * which is worse than a slow answer that is always slow.
 *
 * So the two are separated. The BODY keeps the raggedness, because that is
 * the research finding it was built from and it costs nothing: a room turning
 * toward you one by one is people rather than a chorus line. The NAME is not
 * a reaction, it is the ANSWER to the question the gesture asked, and an
 * answer waits for nobody: it comes up over `NAME_RISE` seconds from the
 * instant of the notice, on every member equally.
 *
 * Pure arithmetic, taking its clock as arguments rather than reading
 * `performance.now()`, so the timing can be held by a test without a browser
 * to run frames in — the same reason `canvas/scale.ts` takes a ratio.
 */
export const NAME_RISE = 0.1;
export const BODY_RISE = 0.18;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

export function noticeLight(
  /** seconds since the notice began; negative if this member is not the one */
  since: number,
  /** the member's own delay before it answers, in seconds */
  notice: number,
  /** milliseconds left before the notice lets go */
  msLeft: number,
): { body: number; name: number } {
  if (since < 0) return { body: 0, name: 0 };
  /* the shared fade-out: both let go together, so a member does not stand
     lit under a name that has already gone */
  const holding = clamp01(msLeft / 900);
  const turned = since - notice;
  return {
    body: turned > 0 ? holding * clamp01(turned / BODY_RISE) : 0,
    name: holding * clamp01(since / NAME_RISE),
  };
}
