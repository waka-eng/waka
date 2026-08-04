/**
 * The surface.
 * ===========================================================================
 *
 * WHY THIS FILE EXISTS AND `Home.tsx` STILL DOES TOO
 *
 * Home is 6,300 lines in which data-fetching and rendering are interleaved,
 * and its shape is five stacked overlays: a 460px history panel, a draggable
 * memory-window layer, the capture modal, the room panel and the drop
 * overlay -- 26 `position: fixed` rules reaching z-index 1000. Each was
 * reasonable alone. Together they are why the product feels like parts.
 *
 * Restyling that shape can never produce the redesign, which is the lesson of
 * several failed attempts: the type, colour and motion system landed cleanly
 * and the app still looked identical, because composition is not a style.
 *
 * So this is the composition, written from scratch:
 *
 *   ONE SURFACE. Nothing navigates. Opening a reading does not take you
 *   anywhere -- the wall recedes in place and the claim comes forward in the
 *   same box. Capture, looking, rooms and time are STATES of this space, not
 *   places you visit. The room's name never moves, because it is where you
 *   are.
 *
 * State is a single machine rather than five independent open/closed flags,
 * which is what makes "the wall recedes and the thing comes forward" one
 * attribute on one element instead of a fight between z-indexes.
 *
 * Home stays routed at /classic until this replaces it outright, so nothing
 * that works today is lost while the shape is being judged.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { JSX } from "react";

import { contributorColor, contributorInitials } from "../components/faces";
import { useAuth } from "../lib/auth-context";
import {
  readStoredLocale,
  supportedLocales,
  writeStoredLocale,
  type SupportedLocale,
} from "../lib/i18n";
import {
  createInspiration,
  createFeedback,
  createGroup,
  deleteGroup,
  createReflection,
  fetchGroupTopOfMind,
  fetchGroups,
  fetchReflections,
  fetchRoomTimeline,
  fetchSavedSignalDetail,
  fetchSavedSignals,
  fetchSignalReadings,
  deleteInspiration,
  finalizeAttachment,
  setInspirationSharing,
  presignAttachment,
  uploadToPresignedUrl,
  deleteReflection,
  recordInspirationRevisit,
  refreshGroupTopOfMind,
  updateInspiration,
  joinGroup,
  leaveGroup,
  removeGroupMember,
  renameGroup,
  fetchTopOfMindNotes,
  generateGuidedReflectionQuestion,
  updateTopOfMindNote,
  type ApiGroupMemberSummary,
  type ApiGroupSummary,
  type ApiGroupTopOfMindNote,
  type ApiReflection,
  type ApiRoomTimeline,
  type ApiSavedSignalSearchResult,
  type ApiSignalReading,
  type InspirationRevisitEventType,
  type ApiTopOfMindNoteSurface,
} from "../lib/api";

/**
 * The states of the one surface.
 *
 * `wall` is home. Everything else is something happening in front of it, and
 * the wall is still there behind -- receded, never replaced.
 */
type State = "wall" | "reading" | "save" | "ask" | "capture";

/** The room you are standing in. `null` is your own wall. */
type RoomId = string | null;

/**
 * A reading, flattened out of the two shapes the API returns for it.
 *
 * The solo and group endpoints disagree about the shape of a note -- group
 * notes carry an author and group-scoped evidence previews, solo notes do
 * not -- and every surface downstream should not have to care which it got.
 */
interface Reading {
  id: string;
  text: string;
  hands: string[];
  evidence: { id: string; text: string; quote: string | null; author: string | null }[];
  createdAt: string | null;
}

function readingFromGroupNote(note: ApiGroupTopOfMindNote): Reading {
  const evidence = (note.evidencePreviews ?? []).map((preview) => ({
    id: preview.signalId,
    text: preview.textPreview ?? "",
    quote: preview.quote ?? null,
    author: preview.authorName ?? null,
  }));
  return {
    id: note.id,
    // `body` is the sentence the judge wrote; `title` is its short label. The
    // sentence is what belongs on a post-it -- the label reads as a heading
    // for something that is not there.
    text: note.body?.trim() || note.title || "",
    hands: Array.from(
      new Set(evidence.map((e) => e.author).filter((a): a is string => Boolean(a?.trim()))),
    ),
    evidence,
    createdAt: note.createdAt ?? null,
  };
}

function readingFromSoloNote(note: ApiTopOfMindNoteSurface): Reading {
  const evidence = (note.evidencePreviews ?? []).map((preview) => ({
    id: preview.signalId,
    text: preview.textPreview ?? "",
    quote: preview.quote ?? null,
    author: null,
  }));
  return {
    id: note.id,
    text: note.body?.trim() || note.title || "",
    // Your own wall has no other hands on it, and stamping "you" on every
    // reading is noise.
    hands: [],
    evidence,
    createdAt: note.createdAt ?? null,
  };
}

/**
 * Light up the words a reading rested on, inside the save they came from.
 *
 * Whitespace-tolerant because the stored quote came back through a model and
 * a database round-trip, and a single collapsed newline should not lose the
 * mark. If the quote no longer appears -- the save was edited, enrichment was
 * appended -- the text renders unmarked rather than marking the wrong words.
 * A missing highlight is honest; a wrong one attributes words to a person who
 * did not write them.
 */
/* The judge is asked for a span, not a paragraph, and the server caps what it
   stores — but this builds a RegExp out of whatever arrives, so it enforces its
   own ceiling rather than trusting the field it was handed. */
const MAX_QUOTE_CHARS = 400;

export function markQuote(text: string, quote: string | null): JSX.Element {
  if (!quote) return <>{text}</>;
  const trimmed = quote.trim();
  if (trimmed.length < 12 || trimmed.length > MAX_QUOTE_CHARS) return <>{text}</>;
  const pattern = trimmed
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\s+/g, "\\s+");
  const match = new RegExp(pattern, "i").exec(text);
  if (!match) return <>{text}</>;
  return (
    <>
      {text.slice(0, match.index)}
      <mark className="sf-mark">{match[0]}</mark>
      {text.slice(match.index + match[0].length)}
    </>
  );
}

/**
 * Show the part that mattered, not the whole article.
 *
 * A linked save carries the entire fetched page — one of these is over three
 * thousand words — and printing all of it under a one-sentence claim buries
 * the thing you came to check. So the text is cut to a window AROUND the
 * marked quote, which is the only part the reading actually rested on.
 *
 * Without a quote there is nothing to centre on, so it falls back to the
 * opening, which is at least where the person started writing.
 */
/**
 * Pasted material arrives with its own line breaks, and `white-space: pre-wrap`
 * honours every one of them -- so a post copied from Instagram renders as
 * fifteen one-line paragraphs at 1.68 leading and reads as broken.
 *
 * Single newlines inside a run of prose are the source's wrapping, not the
 * writer's intent; blank lines are. So: split on blank lines, join the rest.
 */
function paragraphs(text: string): string[] {
  return text
    .split(/\n\s*\n+/)
    .map((block) => block.replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean);
}

/*
 * A CITATION HAS TWO STATES AND NOTHING IN BETWEEN.
 *
 *   collapsed  the words the reading rested on, and only those
 *   expanded   the whole save, with those words marked inside it
 *
 * Everything else has been tried and each attempt had the same fault: the
 * collapsed body was derived from text that arrives ASYNCHRONOUSLY, so the
 * block rendered at one size, the detail fetch landed, and it grew — the
 * citation expanded itself while you were reading it.
 *
 * The quote ships with the note, so it is there on the first paint and never
 * changes. That is what makes this stable: collapsed depends on nothing that
 * has to load.
 *
 * Collapsed is deliberately NOT marked. The mark exists to find these words
 * inside a wall of text; when they are the only words on screen it says
 * nothing, and a solid accent across every line is where a highlight stops
 * being a highlight. It appears on expand, where it does its job.
 */

/** Today, yesterday, or a date./*
 * Restored verbatim from the shipped wall, because it was right and I replaced
 * it with something that collapsed.
 *
 * Each note gets its own TILT AND ITS OWN WIDTH. Combined with the grid's
 * `max-content` columns that is what makes a wall look like paper stuck up by
 * a person rather than a table of cards: the sheets are different sizes and
 * none of them are square to the wall.
 */
const NOTE_LAYOUTS: Array<{ tilt: number; w: string }> = [
  // Scaled down from the shipped 420/292/300/292/312. At the original size
  // four sheets filled the screen, and a wall you cannot see all of is not
  // doing the one thing a wall is for. The ratios between them are kept, so
  // the sheets still read as different pieces of paper.
  { tilt: -1.4, w: "340px" },
  { tilt: -2.2, w: "246px" },
  { tilt: 1.8, w: "252px" },
  { tilt: 1.2, w: "246px" },
  { tilt: -0.8, w: "262px" },
];

/*
 * Paper and ink, in pairs. The ink is coloured too -- warm brown, maroon,
 * moss, slate -- which is most of why these read as paper and not as tinted
 * rectangles, and which I missed twice.
 *
 * Keyed by POSITION, deliberately, having tried the alternative. Keying paper
 * to whose hands are on a reading sounds better and collapses in the most
 * common case there is: on your own wall nobody else's hands are on anything,
 * so every note takes the same paper and the wall goes uniformly olive. Whose
 * hands these are is answered by the faces in the footer, which is a place
 * that can say two names.
 */
const NOTE_COLORS = [
  { hue: "#ece4cb", ink: "#4a3e1f" },
  { hue: "#e8d4ce", ink: "#6b3c34" },
  { hue: "#d8ddc6", ink: "#3f4a2a" },
  { hue: "#cdd3df", ink: "#3a4456" },
  { hue: "#f1d7a8", ink: "#4f3921" },
];

/** Today, yesterday, or a date. A wall you return to daily needs the first
 *  two to be words — "today" reads instantly, "3 Aug" has to be decoded. */
function whenShort(at: string): string {
  const then = new Date(at);
  if (Number.isNaN(then.getTime())) return "";
  const days = Math.floor((Date.now() - then.getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return then.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Same rule classic used for the Debug pill. */
function showsDebug(): boolean {
  const env = import.meta.env as Record<string, unknown>;
  return env.DEV === true || env.VITE_SHOW_INTERNAL === "1";
}

/* The same key classic used, deliberately: anyone with an unsaved draft when
   the old wall is deleted keeps it, instead of losing the one thing a product
   about keeping things must never lose. */
const DRAFT_KEY = "waka.captureDraft.v1";

/** Every URL in what you typed. These become link attachments, which is what
 *  makes the page behind them readable to the judge at all. */
function urlsIn(text: string): string[] {
  return Array.from(new Set(text.match(/https?:\/\/[^\s<>"')]+/g) ?? []));
}

export default function SurfacePage(): JSX.Element {
  const { user } = useAuth();

  const [state, setState] = useState<State>("wall");
  const [room, setRoom] = useState<RoomId>(null);
  const [rooms, setRooms] = useState<ApiGroupSummary[]>([]);
  const [members, setMembers] = useState<ApiGroupMemberSummary[]>([]);
  const [readings, setReadings] = useState<Reading[]>([]);
  const [loading, setLoading] = useState(true);

  const [openReading, setOpenReading] = useState<Reading | null>(null);
  /*
    EVERY save the reading rested on, not the first one that happened to carry
    a quote.

    The first cut showed one, and on a reading built from three saves across
    two people it showed one save by one person -- which quietly told you the
    room agreed with you, when the whole claim of the product is that it did
    not have to. A reading that joins hands has to show the hands.
  */
  const [openEvidence, setOpenEvidence] = useState<Reading["evidence"]>([]);
  const [fullText, setFullText] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [openSave, setOpenSave] = useState<ApiSavedSignalSearchResult | null>(null);
  /* What a save became. Reached by LOOKING, this is the question you have. */
  const [became, setBecame] = useState<ApiSignalReading[]>([]);
  /*
    Reflecting on a save.

    This is the one place in the product where the machine asks and YOU
    answer, and it was dropped in the rewrite. It belongs on the save reached
    by looking — arriving through a reading you came to check a claim, and a
    question would be an interruption.
  */
  const [locale, setLocale] = useState<SupportedLocale>(() => readStoredLocale());
  const [openSaveShared, setOpenSaveShared] = useState(true);
  const [openSaveAttachments, setOpenSaveAttachments] = useState<Array<"link" | "image" | "file">>(
    [],
  );
  const [reflections, setReflections] = useState<ApiReflection[]>([]);
  const [question, setQuestion] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState("");
  const [answering, setAnswering] = useState(false);

  /*
    Time.

    A room's life is a list of events, and the board as it stood at any of
    them. Travelling is a state of this surface like any other -- the wall
    re-forms where it stands rather than opening a separate history view,
    because what changed is the point and you cannot see a change you had to
    navigate away to look at.
  */
  const [timeline, setTimeline] = useState<ApiRoomTimeline | null>(null);
  const [travelledTo, setTravelledTo] = useState<string | null>(null);

  /*
    Every board the room has ever shown, fetched once.

    Live re-forming while you drag is only possible if nothing has to load
    mid-gesture. Each moment's board is small and the number of moments is the
    number of times the room has changed, so this is a handful of requests at
    room-open, in exchange for a rail that never stutters.
  */
  const [boards, setBoards] = useState<Record<string, Reading[]>>({});

  /* Re-ask for the solo wall, which is the only way back to "now" once it has
     been filtered down to a past state. */
  /* The unfiltered solo wall, so travelling can always come back. */
  const soloAll = useRef<Reading[]>([]);

  const reloadSolo = useCallback(() => {
    void fetchTopOfMindNotes({ limit: 12 })
      .then((notes) => {
        const mapped = notes.map(readingFromSoloNote);
        soloAll.current = mapped;
        setReadings(mapped);
      })
      .catch(() => undefined);
  }, []);

  const travel = useCallback(
    (at: string | null) => {
      if (!room) {
        /*
          Solo: the wall as it had accumulated by then, filtered from the FULL
          set rather than from what is currently displayed.

          The first cut filtered `readings` in place, which is destructive:
          travelling to Jul 6 cut the wall to one note, and then travelling
          forward to Jul 31 filtered that same single note again, so moving
          back down the rail could never restore anything. It also fed
          `moments`, so the rail's own stops disappeared as you used it.
        */
        setTravelledTo(at);
        const all = soloAll.current;
        setReadings(at ? all.filter((r) => !r.createdAt || r.createdAt <= at) : all);
        return;
      }
      setTravelledTo(at);
      const cached = boards[at ?? "now"];
      if (cached) {
        setReadings(cached);
        return;
      }
      void fetchRoomTimeline(room, at ?? undefined)
        .then((response) => {
          const board = response.board?.notes;
          if (!board) return;
          /*
            A past board is a record, not a re-reading. Its notes carry the
            evidence and the faces they had at the time, so travelling shows
            what the room actually said then rather than what it would say
            about that material now.
          */
          const mapped = board.map((note) => ({
              id: note.id,
              text: note.why?.trim() || note.title,
              hands: Array.from(new Set(note.evidence.map((e) => e.ownerName).filter(Boolean))),
              evidence: note.evidence.map((e) => ({
                id: e.signalId,
                text: e.textPreview,
                quote: null,
                author: e.ownerName,
              })),
            createdAt: note.createdAt,
          }));
          setBoards((current) => ({ ...current, [at ?? "now"]: mapped }));
          setReadings(mapped);
        })
        .catch(() => undefined);
    },
    [boards, reloadSolo, room],
  );

  /*
    Moving the notes around.

    A post-it you cannot move is a card. Position is the one thing on this
    wall that is yours to decide -- the machine puts them up in no order, and
    where they end up is what you made of them.
  */
  const [drags, setDrags] = useState<Record<number, { x: number; y: number }>>({});
  const [dragging, setDragging] = useState<number | null>(null);
  const dragFrom = useRef<{ i: number; x: number; y: number; baseX: number; baseY: number } | null>(
    null,
  );
  const dragMoved = useRef(false);

  useEffect(() => {
    if (dragging === null) return undefined;
    const onMove = (event: PointerEvent) => {
      const from = dragFrom.current;
      if (!from) return;
      const dx = event.clientX - from.x;
      const dy = event.clientY - from.y;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) dragMoved.current = true;
      setDrags((current) => ({
        ...current,
        [from.i]: { x: from.baseX + dx, y: from.baseY + dy },
      }));
    };
    const onUp = () => {
      dragFrom.current = null;
      setDragging(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [dragging]);

  /*
    Capture, properly.

    The surface could only save plain text, which quietly cost more than it
    looked: a bare URL with no enrichment is nearly invisible to the judge, so
    "save a link" was not a missing convenience, it was material the algorithm
    never got to read.

    Attachments are created AFTER the inspiration — the API needs an
    inspirationId — so a save with a link or a file is two steps, and the
    second failing must never lose the first. The text is kept either way.
  */
  const [draft, setDraft] = useState(() => {
    // Whatever you left in the box, still there. Losing a half-written save
    // to a refresh is the cheapest possible way to teach someone not to trust
    // a product that exists to keep things.
    try {
      return window.localStorage.getItem(DRAFT_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const [files, setFiles] = useState<File[]>([]);
  /*
    Shared with your rooms, or private.

    Default is shared — that is the server's default and the product's whole
    point. But a save you do not want read beside anyone else's has to be
    possible, and this was the one privacy control in the old capture cell.
    Without it every inspiration you keep is readable by every room you are in,
    with no way to say otherwise.
  */
  const [shareToGroups, setShareToGroups] = useState(true);
  /*
    How long the composer was open before you kept it.

    The pulse-speed proxy: a fast save is a reaction, a slow one a
    composition, and the scoring reads the difference. Classic sent it on
    every capture; the surface sent nothing, which is the same class of silent
    loss as the missing revisit tracking.
  */
  const composerOpenedAt = useRef<number | null>(null);
  const [dropping, setDropping] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [keeping, setKeeping] = useState(false);
  const [kept, setKept] = useState<string | null>(null);
  const draftRef = useRef<HTMLTextAreaElement>(null);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ApiSavedSignalSearchResult[]>([]);
  const [savedCount, setSavedCount] = useState<number | null>(null);
  const [searching, setSearching] = useState(false);
  const askInputRef = useRef<HTMLInputElement>(null);

  /* --- the room's wall ---------------------------------------------- */
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        let next: Reading[];
        if (room) {
          const board = await fetchGroupTopOfMind(room);
          next = board.notes.map(readingFromGroupNote);
          if (!cancelled) setMembers(board.members ?? []);
        } else {
          next = (await fetchTopOfMindNotes({ limit: 12 })).map(readingFromSoloNote);
          if (!cancelled) {
            setMembers([]);
            soloAll.current = next;
          }
        }
        if (cancelled) return;
        // Precision over recall: however many held is however many show. There
        // is no fill target here, so a wall of two is a finished wall.
        setReadings(next.filter((r) => r.text.trim().length > 0));
      } catch {
        // A room that will not load shows an empty wall rather than an error
        // banner: the empty state already says "nothing holds here yet", and a
        // second message about plumbing is not what you came for.
        if (!cancelled) setReadings([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [room, user?.id]);

  useEffect(() => {
    // Only a room has a life. Your own wall is one person's, and there is no
    // arrival to mark on it.
    if (!user || !room) {
      setTimeline(null);
      setTravelledTo(null);
      return undefined;
    }
    let cancelled = false;
    void fetchRoomTimeline(room)
      .then((response) => {
        if (!cancelled) setTimeline(response.timeline);
      })
      .catch(() => {
        if (!cancelled) setTimeline(null);
      });
    return () => {
      cancelled = true;
    };
  }, [room, user?.id]);

  /*
    How many you have kept, for the verb in the bar.

    `limit` is capped at 200 server-side (MAX_SIGNAL_ARCHIVE_LIMIT), and asking
    for more does not clamp — it fails zod validation and 400s. The first cut
    asked for 2000, the request was rejected, and the `.catch` swallowed it, so
    the count silently rendered as nothing at all. A caught error that leaves a
    number blank is indistinguishable from a slow network, which is why this
    took a screenshot to find.

    At 200 the number becomes "200" rather than the truth, so it says "200+"
    at the ceiling instead of quietly lying.
  */
  const SAVED_CEILING = 200;
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void fetchSavedSignals({ limit: SAVED_CEILING })
      .then((all) => {
        if (!cancelled) setSavedCount(all.length);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [user?.id, kept]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void fetchGroups()
      .then((next) => {
        if (!cancelled) setRooms(next);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  /* --- looking for something ---------------------------------------- */
  useEffect(() => {
    if (state !== "ask") return undefined;
    askInputRef.current?.focus();
    const q = query.trim();
    let cancelled = false;
    setSearching(true);
    const timer = window.setTimeout(() => {
      void fetchSavedSignals(q ? { q, limit: 20 } : { limit: 20 })
        .then((next) => {
          if (!cancelled) setResults(next);
        })
        .catch(() => {
          if (!cancelled) setResults([]);
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, state]);

  /* --- opening things ------------------------------------------------ */

  /*
    Arriving THROUGH a reading, there is exactly one question -- is that
    true? -- so the surface shows the claim and the words that carried it,
    and nothing else. The readings list, the reflections, the metadata and
    delete all answer questions you did not ask.
  */
  /*
    Revisit tracking.

    Not a feature — a signal. Every time a save is actually looked at, the
    scoring wants to know, and classic recorded it from eleven places. The
    surface recorded it from none, which degrades the algorithm while nothing
    visibly breaks. That is exactly why it goes in first.

    Fire-and-forget: a failed revisit must never interrupt reading.
  */
  const sawSave = useCallback((id: string, how: InspirationRevisitEventType) => {
    if (!id) return;
    void recordInspirationRevisit(id, how).catch(() => undefined);
  }, []);

  const enterReading = useCallback((reading: Reading) => {
    setOpenReading(reading);
    setOpenEvidence(reading.evidence);
    setExpanded(new Set());
    setState("reading");
    // Every cited save, in parallel. The previews the board ships are 180
    // characters of whatever sat at the start of the save, which is rarely the
    // part that mattered.
    reading.evidence.forEach((piece) => {
      if (!piece.id) return;
      sawSave(piece.id, "detail_opened");
      void fetchSavedSignalDetail(piece.id)
        .then((detail) =>
          setFullText((current) => ({
            ...current,
            [piece.id]: detail.rawText ?? detail.textPreview ?? "",
          })),
        )
        .catch(() => undefined);
    });
  }, [sawSave]);

  const enterSave = useCallback((signal: ApiSavedSignalSearchResult) => {
    setOpenSave(signal);
    setSaveDraft(null);
    setSaveRating(null);
    // The list row does not carry the flag; the detail does, under the older
    // spelling. Assume shared until the fetch says otherwise, because shared
    // is the server default.
    setOpenSaveShared(true);
    setBecame([]);
    setReflections([]);
    setQuestion(null);
    setAnswer("");
    setState("save");
    sawSave(signal.id, "detail_opened");
    void fetchSignalReadings(signal.id).then(setBecame).catch(() => undefined);
    void fetchReflections(signal.id).then(setReflections).catch(() => undefined);
    void fetchSavedSignalDetail(signal.id)
      .then((detail) => {
        setFullText((current) => ({
          ...current,
          [signal.id]: detail.rawText ?? detail.textPreview ?? "",
        }));
        const shared = (detail as { sharedToGroups?: boolean }).sharedToGroups;
        if (typeof shared === "boolean") setOpenSaveShared(shared);
        setOpenSaveAttachments(
          (detail.attachments ?? [])
            .map((a) => a.type)
            .filter((t): t is "link" | "image" | "file" =>
              t === "link" || t === "image" || t === "file",
            ),
        );
      })
      .catch(() => undefined);
  }, []);

  /*
    Keeping something.

    No modal, no bordered box. Capture is a state of this surface like every
    other, and it answers immediately -- the gap between saving and being read
    is hours, and a product that says nothing in that gap is where trust is
    lost cheapest.
  */
  const keep = useCallback(async () => {
    const text = draft.trim();
    if ((!text && files.length === 0) || keeping) return;
    setKeeping(true);
    try {
      const made = await createInspiration({
        text,
        ...(composerOpenedAt.current
          ? { captureElapsedMs: Date.now() - composerOpenedAt.current }
          : {}),
        // Shared is the server default; only send the flag when this one is
        // being kept back.
        ...(shareToGroups ? {} : { shareToGroups: false }),
      });

      // Links first: cheap, and the enrichment they trigger is the whole
      // reason a URL is worth saving.
      const links = urlsIn(text);
      for (const url of links) {
        await finalizeAttachment({ type: "link", inspirationId: made.id, url }).catch(
          () => undefined,
        );
      }

      // Then files: presign, PUT to S3, record. Each one independently, so a
      // single failure does not take the others or the save with it.
      for (const file of files) {
        try {
          const signed = await presignAttachment({
            filename: file.name,
            contentType: file.type || "application/octet-stream",
            size: file.size,
          });
          await uploadToPresignedUrl(signed.uploadUrl, file, signed.headers);
          await finalizeAttachment({
            type: file.type.startsWith("image/") ? "image" : "file",
            inspirationId: made.id,
            key: signed.key,
            name: file.name,
            contentType: file.type,
            size: file.size,
          });
        } catch {
          /* the words are saved; one attachment failing is not worth losing them */
        }
      }

      setDraft("");
      setFiles([]);
      try {
        window.localStorage.removeItem(DRAFT_KEY);
      } catch {
        /* private mode */
      }
      setKept(
        links.length > 0
          ? "Kept, and the page behind that link is being read."
          : "Kept. It sits with what you have been circling — the room reads it on its next pass.",
      );
    } catch {
      setKept("Could not keep that. It is still in the box; try again.");
    } finally {
      setKeeping(false);
    }
  }, [draft, files, keeping, shareToGroups]);

  /* The draft survives a refresh. */
  useEffect(() => {
    try {
      if (draft.trim()) window.localStorage.setItem(DRAFT_KEY, draft);
      else window.localStorage.removeItem(DRAFT_KEY);
    } catch {
      /* private mode */
    }
  }, [draft]);

  /*
    The whole surface is the drop target — no overlay panel, no dashed
    rectangle you have to hit. Drop anywhere and the composer opens with the
    file already on it.
  */
  useEffect(() => {
    const over = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes("Files")) return;
      event.preventDefault();
      setDropping(true);
    };
    const leave = (event: DragEvent) => {
      if (event.relatedTarget) return;
      setDropping(false);
    };
    const drop = (event: DragEvent) => {
      const dropped = Array.from(event.dataTransfer?.files ?? []);
      if (dropped.length === 0) return;
      event.preventDefault();
      setDropping(false);
      setFiles((current) => [...current, ...dropped]);
      setState("capture");
      composerOpenedAt.current = Date.now();
      window.setTimeout(() => draftRef.current?.focus(), 60);
    };
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, []);

  /*
    Ask the next question.

    The prompt is generated from the save AND every answer already given, so a
    thread deepens rather than circling — which is the whole difference between
    reflecting and being interviewed.
  */
  const askNext = useCallback(async () => {
    if (!openSave || asking) return;
    setAsking(true);
    try {
      const generated = await generateGuidedReflectionQuestion({
        // The locale decides what language the question is asked in — without
        // it the machine writes to you in English on a Korean wall.
        locale,
        inspiration: {
          text: fullText[openSave.id] ?? openSave.textPreview,
          kind: (openSave.kind ?? "note") as never,
          // What is attached changes what is worth asking about.
          attachmentKinds: openSaveAttachments,
        },
        priorAnswers: reflections
          .filter((r) => r.answer)
          .map((r) => ({ question: r.question, answer: r.answer as string })),
      });
      setQuestion(generated.question);
    } catch {
      setQuestion(null);
    } finally {
      setAsking(false);
    }
  }, [asking, fullText, locale, openSave, openSaveAttachments, reflections]);

  const saveAnswer = useCallback(async () => {
    if (!openSave || !question || !answer.trim() || answering) return;
    setAnswering(true);
    try {
      const created = await createReflection(openSave.id, {
        question,
        answer: answer.trim(),
      });
      setReflections((current) => [...current, created.reflection]);
      setAnswer("");
      setQuestion(null);
    } catch {
      /* leave the draft in the box rather than losing what was typed */
    } finally {
      setAnswering(false);
    }
  }, [answer, answering, openSave, question]);

  const toWall = useCallback(() => {
    setState("wall");
    setOpenReading(null);
    setOpenEvidence([]);
    setOpenSave(null);
    setKept(null);
  }, []);

  // Escape always means "back to the wall". One surface, one way out.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && state !== "wall") toWall();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state, toWall]);

  /*
    When each person arrived, off the room's own life.

    "6 hearts" was a number standing in for people -- it said how many without
    saying who, on a surface whose entire subject is whose hearts these are.
    The names are the answer, and when they arrived is what makes a room a
    thing that happened rather than a roster.
  */
  const joinedAt = useMemo(() => {
    const map = new Map<string, string>();
    for (const event of timeline?.events ?? []) {
      if (event.kind === "member" && event.event === "joined") map.set(event.userId, event.at);
    }
    return map;
  }, [timeline]);

  /*
    Every moment in the room's life, laid out in real time rather than evenly
    spaced -- three readings in one afternoon and then a month of quiet should
    LOOK like that, or the rail lies about the shape of the room.
  */
  const moments = useMemo(() => {
    /*
      Your own wall has a life too — it just has no timeline endpoint.

      `fetchRoomTimeline` is a group route: it replays a room's events and
      rebuilds the board as it stood. Solo has none of that, so the honest
      reconstruction is the one thing the data already carries — when each
      reading was written. Travelling back then means showing the wall as it
      had ACCUMULATED, which is true as far as it goes.

      What it cannot show is a reading that was retired: nothing in this
      response remembers what used to be there. So a solo wall travels
      forward-only through its own arrivals, and that limit is the data's, not
      a shortcut.
    */
    if (!room) {
      /* Built from the FULL set: a rail whose stops vanish as you travel is a
         rail you can walk off. */
      const days = new Map<string, string>();
      for (const reading of (travelledTo ? soloAll.current : readings)) {
        if (!reading.createdAt) continue;
        const day = reading.createdAt.slice(0, 10);
        const seen = days.get(day);
        if (!seen || reading.createdAt < seen) days.set(day, reading.createdAt);
      }
      const raw = [...days.values()].sort();
      if (raw.length < 2) return [];
      const first = Date.parse(raw[0]!);
      const span = Math.max(1, Date.now() - first);
      return raw.map((at, i) => ({
        at,
        key: `solo-${i}`,
        label: "the wall as it stood",
        pct: Math.min(100, Math.max(0, ((Date.parse(at) - first) / span) * 100)),
        when: new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      }));
    }
    if (!timeline) return [];
    const raw = [
      { at: timeline.formedAt, key: "formed", label: "the room formed" },
      ...timeline.events
        .filter((e) => e.kind === "member" || e.kind === "note_written")
        .map((e, i) => ({
          at: e.at,
          key: `${e.kind}-${i}`,
          label:
            e.kind === "member"
              ? `${e.name} ${e.event}`
              : `the room said \u201c${e.title}\u201d`,
        })),
    ].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    const first = Date.parse(raw[0]?.at ?? "");
    const last = Date.now();
    const span = Math.max(1, last - first);
    return raw.map((m) => ({
      ...m,
      pct: Math.min(100, Math.max(0, ((Date.parse(m.at) - first) / span) * 100)),
      when: new Date(m.at).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    }));
  }, [timeline]);

  /*
    Warm every stop as soon as the room's life is known, so the first drag is
    as smooth as the tenth.
  */
  useEffect(() => {
    if (!room || moments.length === 0) return;
    for (const moment of moments) {
      if (boards[moment.at]) continue;
      void fetchRoomTimeline(room, moment.at)
        .then((response) => {
          const board = response.board?.notes;
          if (!board) return;
          setBoards((current) => ({
            ...current,
            [moment.at]: board.map((note) => ({
              id: note.id,
              text: note.why?.trim() || note.title,
              hands: Array.from(new Set(note.evidence.map((e) => e.ownerName).filter(Boolean))),
              evidence: note.evidence.map((e) => ({
                id: e.signalId,
                text: e.textPreview,
                quote: null,
                author: e.ownerName,
              })),
              createdAt: note.createdAt,
            })),
          }));
        })
        .catch(() => undefined);
    }
    // `boards` is read to skip what is already warm; including it would refire
    // this on every arrival and re-request the rest.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moments, room]);

  /* `now` is a stop like any other, at the far end. */
  const allStops = useMemo(
    () => [...moments, { at: null as string | null, key: "now", label: "what it says today", pct: 100, when: "now" }],
    [moments],
  );

  const here = useMemo(
    () => allStops.find((stop) => stop.at === travelledTo) ?? allStops[allStops.length - 1]!,
    [allStops, travelledTo],
  );

  /*
    Which stops get a printed date.

    Every stop cannot: a room that wrote four readings in one afternoon would
    stack four labels on top of each other and none would be readable. So a
    date is printed only when it clears the last printed one by enough of the
    track to stand alone -- and `now` always wins its place, because it is the
    end of the line and the thing you come back to.

    Every stop still keeps its dot and its hover, so nothing is lost by not
    being labelled; the labels are a ruler, not the content.
  */
  const trackRef = useRef<HTMLDivElement>(null);
  const [scrubbing, setScrubbing] = useState(false);

  /*
    Snap to the nearest stop rather than to the nearest pixel. Dragging is
    continuous, but where you LAND is always somewhere the room actually did
    something.
  */
  const scrubTo = useCallback(
    (clientX: number) => {
      const track = trackRef.current;
      if (!track || allStops.length === 0) return;
      const box = track.getBoundingClientRect();
      const pct = Math.min(100, Math.max(0, ((clientX - box.left) / box.width) * 100));
      let nearest = allStops[0]!;
      for (const stop of allStops) {
        if (Math.abs(stop.pct - pct) < Math.abs(nearest.pct - pct)) nearest = stop;
      }
      if (nearest.at !== travelledTo) travel(nearest.at);
    },
    [allStops, travel, travelledTo],
  );

  /*
    LAY THE WALL OUT BY WHAT THE READINGS SHARE.

    Until now the notes flowed in whatever order the API returned them, which
    is to say: none. On a real wall the things near each other are about each
    other, and that adjacency is readable before you read a word — it is the
    oldest trick in sensemaking and the product was throwing it away.

    Two readings are related when they rest on the same saves. So: start from
    the reading with the most evidence, then repeatedly place whichever
    remaining reading shares the most with the one just placed. A greedy chain
    rather than a real clustering, deliberately — it is O(n²) on a set of six,
    it is stable, and it puts related sheets side by side, which is the entire
    point. Nothing here needs a dendrogram.

    The payoff is that the wall says something at a glance: a run of sheets
    built on the same material sits together, and a reading that shares nothing
    with anything ends up alone at the end — which is itself worth seeing.
  */
  const wall = useMemo(() => {
    if (readings.length < 3) return readings;
    const idsOf = (r: Reading) => new Set(r.evidence.map((e) => e.id).filter(Boolean));
    const sets = new Map(readings.map((r) => [r.id, idsOf(r)]));
    const shared = (a: Reading, b: Reading) => {
      const sa = sets.get(a.id)!;
      const sb = sets.get(b.id)!;
      let n = 0;
      for (const id of sa) if (sb.has(id)) n += 1;
      return n;
    };
    const rest = [...readings];
    rest.sort((a, b) => b.evidence.length - a.evidence.length);
    const out: Reading[] = [rest.shift()!];
    while (rest.length) {
      const last = out[out.length - 1]!;
      let best = 0;
      for (let i = 1; i < rest.length; i += 1) {
        if (shared(last, rest[i]!) > shared(last, rest[best]!)) best = i;
      }
      out.push(rest.splice(best, 1)[0]!);
    }
    return out;
  }, [readings]);

  /*
    The three things you can do about a provisional claim, and all of them
    live ON THE SHEET.

    An earlier cut put "rewrite / hold / take it down" as three text buttons
    inside the opened reading. That is one level too far in: judging a reading
    is something you do while looking at the wall, not something you navigate
    to, and three words of UI under the claim competed with the claim.

    Rewriting is not a button at all now — the sentence on the sheet IS the
    editable thing, the way it was in the shipped wall. Pin and take-down are
    two small marks in the corner of the paper.
  */
  const [held, setHeld] = useState<Set<string>>(new Set());
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [undo, setUndo] = useState<{ id: string; text: string } | null>(null);
  const undoTimer = useRef<number | null>(null);
  const saveTimers = useRef<Record<string, number>>({});

  /* Autosave, debounced. A correction you have to confirm is a correction you
     will abandon halfway. */
  const rewrite = useCallback((reading: Reading, next: string) => {
    setDrafts((current) => ({ ...current, [reading.id]: next }));
    if (saveTimers.current[reading.id]) window.clearTimeout(saveTimers.current[reading.id]);
    saveTimers.current[reading.id] = window.setTimeout(() => {
      const text = next.trim();
      if (!text || text === reading.text) return;
      setReadings((current) =>
        current.map((r) => (r.id === reading.id ? { ...r, text } : r)),
      );
      void updateTopOfMindNote(reading.id, { title: text }).catch(() => undefined);
    }, 900);
  }, []);

  const hold = useCallback(
    (reading: Reading) => {
      const on = !held.has(reading.id);
      setHeld((current) => {
        const next = new Set(current);
        if (on) next.add(reading.id);
        else next.delete(reading.id);
        return next;
      });
      void createFeedback({
        targetType: "top_of_mind_note",
        targetId: reading.id,
        // The API has no "un-hold", so releasing one is recorded as the
        // opposite judgement rather than as an absence.
        value: on ? "important" : "not_important",
      }).catch(() => undefined);
    },
    [held],
  );

  const takeDown = useCallback((reading: Reading) => {
    setReadings((current) => current.filter((r) => r.id !== reading.id));
    if (undoTimer.current) window.clearTimeout(undoTimer.current);
    setUndo({ id: reading.id, text: reading.text });
    undoTimer.current = window.setTimeout(() => setUndo(null), 4200);
    void createFeedback({
      targetType: "top_of_mind_note",
      targetId: reading.id,
      value: "not_true",
      correctionText: "taken down from the wall",
    }).catch(() => undefined);
  }, []);

  /*
    A save's own text is editable, exactly as a reading's is. Same autosave,
    same absence of an edit mode — you correct the thing by typing into it.
  */
  const [saveDraft, setSaveDraft] = useState<string | null>(null);
  const [saveRating, setSaveRating] = useState<"true" | "partly" | "not_true" | null>(null);
  const saveTimer = useRef<number | null>(null);

  const rewriteSave = useCallback(
    (id: string, next: string) => {
      setSaveDraft(next);
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => {
        const text = next.trim();
        if (!text) return;
        setFullText((current) => ({ ...current, [id]: text }));
        void updateInspiration(id, { text })
          .then(() => sawSave(id, "inspiration_updated"))
          .catch(() => undefined);
      }, 900);
    },
    [sawSave],
  );

  /*
    Deleting a save asks first, and offers no undo.

    Taking a READING down is feedback — the note is retired and can be put
    back. Deleting an inspiration removes the material itself, server-side,
    permanently. Offering "put it back" for something that cannot come back
    would be the product lying about what it just did, so this is the one act
    on the surface that stops and asks.
  */
  const dropSave = useCallback((signal: ApiSavedSignalSearchResult) => {
    if (
      !window.confirm(
        "Delete this inspiration? Readings already made from it stay, but it cannot be brought back.",
      )
    ) {
      return;
    }
    setResults((current) => current.filter((r) => r.id !== signal.id));
    setOpenSave(null);
    setState("ask");
    void deleteInspiration(signal.id).catch(() => undefined);
  }, []);

  const dropReflection = useCallback((reflection: ApiReflection) => {
    setReflections((current) => current.filter((r) => r.id !== reflection.id));
    void deleteReflection(reflection.inspirationId, reflection.id).catch(() => undefined);
  }, []);

  /*
    Reading the room again.

    A room-level act, so it belongs to the room's name rather than to a
    toolbar. The server owns the cooldown and says whether it actually looked,
    so the surface reports what happened rather than assuming.
  */
  const [rereading, setRereading] = useState(false);
  const [lastRead, setLastRead] = useState<string | null>(null);

  /* When the room last wrote anything — the newest reading on the wall is the
     honest proxy, since that is the last time a pass produced something. */
  const lastReadLabel = useMemo(() => {
    const newest = readings
      .map((r) => (r.createdAt ? Date.parse(r.createdAt) : 0))
      .filter((n) => Number.isFinite(n) && n > 0)
      .sort((a, b) => b - a)[0];
    if (!newest) return "not read yet";
    const mins = Math.round((Date.now() - newest) / 60000);
    if (mins < 2) return "last read just now";
    if (mins < 60) return `last read ${mins} minutes ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `last read ${hrs} hour${hrs === 1 ? "" : "s"} ago`;
    const days = Math.round(hrs / 24);
    return `last read ${days} day${days === 1 ? "" : "s"} ago`;
  }, [readings]);

  const reread = useCallback(async () => {
    if (rereading) return;
    setRereading(true);
    try {
      if (!room) {
        // Your own wall has no refresh endpoint — the solo pass runs on its
        // own schedule — so reading it again means asking for it again.
        const notes = await fetchTopOfMindNotes({ limit: 12 });
        setReadings(notes.map(readingFromSoloNote));
        setLastRead("read just now");
        return;
      }
      const next = await refreshGroupTopOfMind(room);
      setReadings(next.notes.map(readingFromGroupNote));
      setLastRead(
        next.refreshed ? "read just now" : "looked just now — nothing new held",
      );
    } catch {
      setLastRead("could not read the room just now");
    } finally {
      setRereading(false);
    }
  }, [rereading, room]);

  /* Once the wall changes, drop the one-off message and go back to the
     relative time — a status line that never resets becomes a lie. */
  useEffect(() => {
    if (!lastRead) return undefined;
    const timer = window.setTimeout(() => setLastRead(null), 6000);
    return () => window.clearTimeout(timer);
  }, [lastRead]);

  const reload = useCallback(() => {
    void (room
      ? fetchGroupTopOfMind(room).then((b) => setReadings(b.notes.map(readingFromGroupNote)))
      : fetchTopOfMindNotes({ limit: 12 }).then((n) => setReadings(n.map(readingFromSoloNote))));
  }, [room]);

  const putBack = useCallback(() => {
    if (!undo) return;
    if (undoTimer.current) window.clearTimeout(undoTimer.current);
    // A deleted save is gone server-side; the honest undo is to say so rather
    // than to pretend. Only a reading can actually be put back, because taking
    // one down is feedback, not a delete.
    setUndo(null);
    // Re-fetch rather than splice it back at the end: the wall is ordered by
    // shared material, and a note put back in the wrong place is a lie about
    // what it sits beside.
    reload();
  }, [reload, undo]);

  /*
    Making a room, and getting into one.

    ONE field does both. "Which of these am I doing" is a question the product
    can answer from what you typed — a join code is short and has no spaces, a
    room name is anything else — so asking the person to pick a mode first is
    work the machine should be doing.
  */
  /*
    An invite link OFFERS the join; it never performs it.

    `?join=CODE` puts your saved inspirations into a pool other people read.
    A link alone must not be enough to do that, so arriving with one stops the
    surface and asks — the one place on here where ceremony is correct.
  */
  const [offeredCode, setOfferedCode] = useState<string | null>(() => {
    const code = new URLSearchParams(window.location.search).get("join");
    return code && code.trim() ? code.trim() : null;
  });

  const acceptInvite = useCallback(async () => {
    if (!offeredCode) return;
    try {
      const joined = await joinGroup(offeredCode);
      setRooms((current) =>
        current.some((r) => r.id === joined.group.id) ? current : [...current, joined.group],
      );
      setRoom(joined.group.id);
    } catch {
      /* a bad code simply does not open a room */
    } finally {
      setOfferedCode(null);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [offeredCode]);

  const declineInvite = useCallback(() => {
    setOfferedCode(null);
    window.history.replaceState({}, "", window.location.pathname);
  }, []);


  const [roomInput, setRoomInput] = useState("");
  const [roomBusy, setRoomBusy] = useState(false);
  const [roomError, setRoomError] = useState<string | null>(null);
  const [renameTo, setRenameTo] = useState("");
  const [copied, setCopied] = useState(false);

  const makeOrJoinRoom = useCallback(async () => {
    const value = roomInput.trim();
    if (!value || roomBusy) return;
    setRoomBusy(true);
    setRoomError(null);
    try {
      const looksLikeCode = /^[A-Za-z0-9-]{4,24}$/.test(value) && !value.includes(" ");
      const made = looksLikeCode
        ? await joinGroup(value).then((r) => r.group)
        : await createGroup(value);
      setRooms((current) =>
        current.some((r) => r.id === made.id) ? current : [...current, made],
      );
      setRoomInput("");
      setRoom(made.id);
      setState("wall");
    } catch {
      setRoomError(
        "That is not a room name we could make, or a code we could find. Try again.",
      );
    } finally {
      setRoomBusy(false);
    }
  }, [roomBusy, roomInput]);

  /* A <details> menu has no controlled state, so closing one after a choice
     means reaching for the element. */
  const closeMenus = useCallback(() => {
    document.querySelectorAll<HTMLDetailsElement>(".sf-foot details[open]").forEach((el) => {
      el.open = false;
    });
  }, []);

  const roomName = room ? (rooms.find((r) => r.id === room)?.name ?? "room") : "your top of mind";
  const activeRoom = room ? (rooms.find((r) => r.id === room) ?? null) : null;

  // The name steps back when the surface is busy: still present, so you always
  // know which wall you are at, but no longer competing with what you came to
  // read.
  const busy = state !== "wall";

  /*
    Who is in this room, and how someone else gets in.

    Opened from the face pile in the bar rather than from a cog: the faces are
    already the roster, so the actions belong to them. Not a settings form —
    the name is editable where it sits, the code is one line you click to
    copy, and removing someone appears only on the row you are pointing at,
    because it is rare and it is not what this panel is for.
  */
  const roomPanel = room ? (
    <>
      <input
        className="sf-roomname-edit"
        defaultValue={roomName}
        aria-label="room name"
        onChange={(event) => setRenameTo(event.target.value)}
        onBlur={() => {
          const next = renameTo.trim();
          if (!next || next === roomName) return;
          setRooms((current) => current.map((r) => (r.id === room ? { ...r, name: next } : r)));
          void renameGroup(room, next).catch(() => undefined);
        }}
      />

      {activeRoom?.joinCode ? (
        <button
          type="button"
          className="sf-invite"
          onClick={() => {
            void navigator.clipboard
              ?.writeText(activeRoom.joinCode)
              .then(() => setCopied(true))
              .catch(() => undefined);
            window.setTimeout(() => setCopied(false), 1800);
          }}
        >
          <span className="sf-invite-code">{activeRoom.joinCode}</span>
          <small>{copied ? "copied" : "invite someone"}</small>
        </button>
      ) : null}

      <ul className="sf-members">
        {members.map((member) => (
          <li key={member.userId}>
            <span className="sf-face" style={{ background: contributorColor(member.name) }}>
              {contributorInitials(member.name)}
            </span>
            <span className="sf-member-name">{member.name}</span>
            <span className="sf-member-when">
              {joinedAt.get(member.userId)
                ? `since ${new Date(joinedAt.get(member.userId)!).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })}`
                : "from the start"}
            </span>
            {member.userId !== user?.id ? (
              <button
                type="button"
                className="sf-remove"
                onClick={() => {
                  setMembers((current) => current.filter((m) => m.userId !== member.userId));
                  void removeGroupMember(room, member.userId).catch(() => undefined);
                }}
              >
                remove
              </button>
            ) : null}
          </li>
        ))}
      </ul>

      {/*
        Deleting the room is the owner's version of leaving, and it ends it for
        everyone — so it is the only control here that names the consequence in
        the confirmation rather than in a label.
      */}
      {activeRoom?.role === "owner" ? (
        <button
          type="button"
          className="sf-leave"
          onClick={() => {
            if (
              !window.confirm(
                `Delete “${roomName}” for everyone? The readings it made are lost with it.`,
              )
            ) {
              return;
            }
            setRooms((current) => current.filter((r) => r.id !== room));
            setRoom(null);
            void deleteGroup(room).catch(() => undefined);
          }}
        >
          delete this room
        </button>
      ) : null}

      <button
        type="button"
        className="sf-leave"
        onClick={() => {
          if (!window.confirm("Leave this room? Your saves stop being read here.")) return;
          setRooms((current) => current.filter((r) => r.id !== room));
          setRoom(null);
          void leaveGroup(room).catch(() => undefined);
        }}
      >
        leave this room
      </button>
    </>
  ) : null;

  return (
    <div
      className="sf"
      data-state={state}
      data-busy={busy ? "true" : "false"}
      data-dropping={dropping ? "true" : "false"}
    >
      {offeredCode ? (
        <div className="sf-invite-offer" role="dialog" aria-label="an invitation">
          <p className="sf-claim">You have been invited into a room.</p>
          <p className="sf-invite-what">
            Joining puts what you have saved into a pool the people in that room read, and
            puts theirs in front of you. You can leave at any time.
          </p>
          <div className="sf-invite-acts">
            <button type="button" className="sf-accept" onClick={() => void acceptInvite()}>
              join it
            </button>
            <button type="button" className="sf-quiet" onClick={declineInvite}>
              not now
            </button>
          </div>
        </div>
      ) : null}

      <header className="sf-head">
        {/*
          The name, and nothing else.

          It used to carry a headline above it ("6 readings held") and a line
          beneath ("alone"). Both were telling you what you can already see:
          the readings are on the wall, and if nobody else's face is anywhere
          on the screen then you are on your own. A header that narrates the
          page is a header doing the page's job badly.

          Who is in a room now lives where every other person on this surface
          does — the face pile at the end of the bar, beside yours.
        */}
        <h1 className="sf-roomname">{roomName}</h1>
        {/*
          Reading the room again is a room-level act, so it belongs to the
          room's name rather than to a toolbar. The server owns the cooldown
          and reports whether it actually looked, so this says what happened
          instead of assuming it worked.
        */}
        {/*
          When it was last read, and a way to read it again.

          The time is a FACT, not a control — making the whole sentence
          clickable meant the only way to learn what "reading" does here was
          to do it, which is a poor trade for something that spends model
          budget. So the sentence just says when, quietly, and the rotate beside
          it is the button. Icon and text, each doing one job.
        */}
        <p className="sf-lastread">
          <span>{lastRead ?? lastReadLabel}</span>
          <button
            type="button"
            className={`sf-reread${rereading ? " spinning" : ""}`}
            onClick={() => void reread()}
            disabled={rereading}
            title="read this room again"
            aria-label="read this room again"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1" />
              <path d="M20.6 4.4v4.4h-4.4" />
            </svg>
          </button>
        </p>
      </header>

      <div className="sf-body">
        {/* ---------------------------------------------------------- WALL */}
        <section className={`sf-layer sf-layer--wall${state === "wall" ? " on" : ""}`}>
          {loading ? null : readings.length === 0 ? (
            <p className="sf-empty">
              Nothing here holds yet. That is about the material, not about anyone in the room.
            </p>
          ) : (
            <div className="sf-wall">
              {wall.map((reading, i) => {
                const layout = NOTE_LAYOUTS[i % NOTE_LAYOUTS.length]!;
                const paper = NOTE_COLORS[i % NOTE_COLORS.length]!;
                const drag = drags[i] ?? { x: 0, y: 0 };
                return (
                  <article
                    key={reading.id}
                    className={`sf-postit${dragging === i ? " sf-postit--dragging" : ""}${held.has(reading.id) ? " sf-postit--held" : ""}`}
                    style={{
                      ["--bg" as string]: paper.hue,
                      ["--ink" as string]: paper.ink,
                      ["--tilt" as string]: `${layout.tilt}deg`,
                      ["--w" as string]: layout.w,
                      ["--dx" as string]: `${drag.x}px`,
                      ["--dy" as string]: `${drag.y}px`,
                    }}
                    onPointerDown={(event) => {
                      if ((event.target as HTMLElement).closest("button")) return;
                      const base = drags[i] ?? { x: 0, y: 0 };
                      dragFrom.current = {
                        i,
                        x: event.clientX,
                        y: event.clientY,
                        baseX: base.x,
                        baseY: base.y,
                      };
                      dragMoved.current = false;
                      setDragging(i);
                    }}

                  >
                    {/*
                      The sentence IS the editable thing, exactly as it was on
                      the shipped wall — no button, no mode, no pencil icon.
                      You click into a reading about yourself and change it,
                      which is the least ceremonious possible way to disagree.
                      Autosaved, because a correction you have to confirm is a
                      correction you abandon halfway.
                    */}
                    <textarea
                      className="sf-postit-text"
                      value={drafts[reading.id] ?? reading.text}
                      rows={1}
                      spellCheck
                      aria-label="this reading — edit to correct it"
                      onPointerDown={(event) => event.stopPropagation()}
                      onChange={(event) => rewrite(reading, event.target.value)}
                    />
                    <footer>
                      <button
                        type="button"
                        className="sf-provenance"
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.stopPropagation();
                          enterReading(reading);
                        }}
                      >
                        {reading.hands.length > 0 ? (
                          <span className="sf-faces">
                            {reading.hands.map((name) => (
                              <span
                                key={name}
                                className="sf-face"
                                style={{ background: contributorColor(name) }}
                              >
                                {contributorInitials(name)}
                              </span>
                            ))}
                          </span>
                        ) : null}
                        <span>
                          {reading.hands.length > 0 ? `${reading.hands.join(", ")} · ` : ""}
                          {reading.evidence.length}
                        </span>
                      </button>
                      {reading.createdAt ? (
                        <span className="sf-when">{whenShort(reading.createdAt)}</span>
                      ) : null}
                      {/*
                        Hold it, or take it down — in the footer row, in fixed
                        slots, present at rest.

                        They were floated in the sheet's top-right and revealed
                        on hover, so the note reserved an empty square it only
                        filled when pointed at: dead space at rest, and a
                        layout that shifted under the cursor. Here the row is
                        the same shape always and only their contrast changes.
                      */}
                      <span className="sf-postit-acts">
                        <button
                          type="button"
                          className={`sf-act${held.has(reading.id) ? " on" : ""}`}
                          title={held.has(reading.id) ? "held — click to release" : "hold this"}
                          aria-label={held.has(reading.id) ? "release" : "hold"}
                          aria-pressed={held.has(reading.id)}
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={(event) => {
                            event.stopPropagation();
                            hold(reading);
                          }}
                        >
                          {/* The classic pushpin, verbatim. */}
                          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                            <path d="M14.8 3.4 20.6 9.2" />
                            <path d="M15.7 4.3 11.4 8.6 8 8.2 6.4 9.8 14.2 17.6 15.8 16 15.4 12.6 19.7 8.3" />
                            <path d="M10.4 14.4 4 20.8" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          className="sf-act"
                          title="take it down"
                          aria-label="take it down"
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={(event) => {
                            event.stopPropagation();
                            takeDown(reading);
                          }}
                        >
                          {/* And the classic bin. */}
                          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                            <path d="M4 7h16" />
                            <path d="M10 11v6" />
                            <path d="M14 11v6" />
                            <path d="M6.5 7 7.4 20h9.2l.9-13" />
                            <path d="M9 7V4.8h6V7" />
                          </svg>
                        </button>
                      </span>
                    </footer>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        {/* ------------------------------------------------------- READING */}
        <section className={`sf-layer sf-layer--reading${state === "reading" ? " on" : ""}`}>
          {openReading ? (
            <div className="sf-column">
              <button type="button" className="sf-back" onClick={toWall}>
                ← the wall
              </button>
              <p className="sf-claim">{openReading.text}</p>
              <div className="sf-label">
                made from {openEvidence.length} inspiration
                {openEvidence.length === 1 ? "" : "s"} you saved
              </div>
              {/*
                One block per save, each with the hand that wrote it. A reading
                built from three saves across two people used to render as one
                save by one person, which said the opposite of what the room
                had actually done.
              */}
              {openEvidence.map((piece) => {
                const whole = fullText[piece.id];
                const isOpen = expanded.has(piece.id);
                return (
                  <article key={piece.id} className="sf-evidence">
                    <header className="sf-evidence-head">
                      {piece.author ? (
                        <span
                          className="sf-face"
                          style={{ background: contributorColor(piece.author) }}
                        >
                          {contributorInitials(piece.author)}
                        </span>
                      ) : null}
                      <span className="sf-evidence-who">{piece.author ?? "you"}</span>
                    </header>
                    {isOpen ? (
                      <div className="sf-prose">
                        {paragraphs(whole ?? piece.text).map((block, i) => (
                          <p key={i}>{markQuote(block, piece.quote)}</p>
                        ))}
                      </div>
                    ) : piece.quote ? (
                      <p className="sf-said">{piece.quote}</p>
                    ) : (
                      /* 87% of citations name no words. Saying so beats showing
                         a truncation that looks identical to one that does. */
                      <p className="sf-said sf-said--none">
                        no exact words named — {paragraphs(piece.text)[0]?.slice(0, 120)}…
                      </p>
                    )}
                    <button
                      type="button"
                      className="sf-more"
                      onClick={() =>
                        setExpanded((current) => {
                          const next = new Set(current);
                          if (next.has(piece.id)) next.delete(piece.id);
                          else next.add(piece.id);
                          return next;
                        })
                      }
                    >
                      {isOpen ? "less" : "the whole save"}
                    </button>
                  </article>
                );
              })}
            </div>
          ) : null}
        </section>

        {/* ---------------------------------------------------------- SAVE */}
        <section className={`sf-layer sf-layer--save${state === "save" ? " on" : ""}`}>
          {openSave ? (
            <div className="sf-column">
              <button type="button" className="sf-back" onClick={() => setState("ask")}>
                ← what you asked
              </button>
              <div className="sf-savemeta">
                kept {new Date(openSave.capturedAt).toLocaleDateString()}
              </div>
              {/* Your own words, and you can change them. Same rule as a
                  reading: the text is the field, autosaved, no edit mode. */}
              <textarea
                className="sf-savetext"
                value={saveDraft ?? fullText[openSave.id] ?? openSave.textPreview}
                aria-label="what you saved — edit to correct it"
                onChange={(event) => rewriteSave(openSave.id, event.target.value)}
              />
              {/*
                What it became. Reached by LOOKING, this is the question you
                actually have -- so it is open, not folded behind a toggle.
                Absent entirely when nothing has cited it, rather than showing
                a zero.
              */}
              {/*
                Reflecting. The machine asks, you answer — the one exchange in
                the product that runs that direction.

                Your answers are set at the same size as the question, never
                smaller: a surface where the machine's prose outranks the
                person's has decided who the record belongs to.
              */}
              <div className="sf-reflect">
                {reflections.map((r) => (
                  <div key={r.id} className="sf-reflect-past">
                    <p className="sf-reflect-q">{r.question}</p>
                    {r.answer ? <p className="sf-reflect-a">{r.answer}</p> : null}
                    {/* On hover only. Dropping one exchange is rare and should
                        not sit beside every answer you have ever given. */}
                    <button
                      type="button"
                      className="sf-remove sf-reflect-drop"
                      onClick={() => dropReflection(r)}
                    >
                      remove
                    </button>
                  </div>
                ))}
                {question ? (
                  <div className="sf-reflect-live">
                    <p className="sf-reflect-q">{question}</p>
                    <textarea
                      className="sf-reflect-field"
                      value={answer}
                      placeholder="…"
                      autoFocus
                      onChange={(event) => setAnswer(event.target.value)}
                      onKeyDown={(event) => {
                        if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                          void saveAnswer();
                        }
                      }}
                      aria-label={question}
                    />
                    <div className="sf-reflect-foot">
                      <button
                        type="button"
                        onClick={() => void saveAnswer()}
                        disabled={!answer.trim() || answering}
                      >
                        {answering ? "keeping…" : "keep this"}
                      </button>
                      <button type="button" className="sf-quiet" onClick={() => setQuestion(null)}>
                        not now
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="sf-more"
                    onClick={() => void askNext()}
                    disabled={asking}
                  >
                    {asking
                      ? "thinking…"
                      : reflections.length > 0
                        ? "ask me another"
                        : "ask me something about this"}
                  </button>
                )}
              </div>

              {became.length > 0 ? (
                <div className="sf-became">
                  <div className="sf-label">BECAME</div>
                  {became.map((reading) => (
                    <div key={reading.note.id} className="sf-became-row">
                      <span className="sf-became-where">
                        {reading.context.scope === "alone" ? "alone" : reading.context.groupName}
                      </span>
                      <span className="sf-became-title">{reading.note.title}</span>
                    </div>
                  ))}
                </div>
              ) : null}
              {/* Content first, destructive last. */}
              {/*
                Whether the save itself still rings true.

                Distinct from correcting a READING: this is about the material,
                not about what the room made of it, and the scoring reads it.
                Three plain words rather than stars — the product's own
                vocabulary for a claim is true / partly / not true.
              */}
              <div className="sf-rate">
                {(["true", "partly", "not_true"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    className={saveRating === value ? "on" : ""}
                    onClick={() => {
                      setSaveRating(value);
                      void createFeedback({
                        targetType: "signal",
                        targetId: openSave.id,
                        value,
                      }).catch(() => undefined);
                    }}
                  >
                    {value === "not_true" ? "not any more" : value === "partly" ? "partly" : "still true"}
                  </button>
                ))}
              </div>
              <div className="sf-save-foot">
                <span>kept {new Date(openSave.capturedAt).toLocaleDateString()}</span>
                <button
                  type="button"
                  className={`sf-share${openSaveShared ? "" : " private"}`}
                  onClick={() => {
                    const next = !openSaveShared;
                    setOpenSaveShared(next);
                    void setInspirationSharing(openSave.id, next).catch(() => undefined);
                  }}
                >
                  {openSaveShared ? "your rooms can read this" : "private to you"}
                </button>
                <button type="button" className="sf-remove" onClick={() => dropSave(openSave)}>
                  delete this inspiration
                </button>
              </div>
            </div>
          ) : null}
        </section>

        {/* ----------------------------------------------------------- ASK */}
        <section className={`sf-layer sf-layer--ask${state === "ask" ? " on" : ""}`}>
          <div className="sf-column">
            <button type="button" className="sf-back" onClick={toWall}>
              ← the wall
            </button>
            <p className="sf-question">What were you circling?</p>
            <input
              ref={askInputRef}
              className="sf-field"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="What were you circling?"
            />
            {/*
              An empty field shows what you have kept most recently, rather
              than an empty page waiting to be typed into. Asking is the fast
              path once you know what you want; before that, seeing is.
            */}
            <div className="sf-label">
              {query.trim() ? `${results.length} of what you have kept` : "most recent"}
            </div>
            <div className="sf-results">
              {searching ? <p className="sf-empty">looking…</p> : null}
              {!searching && query.trim() && results.length === 0 ? (
                <p className="sf-empty">Nothing you have kept matches that.</p>
              ) : null}
              {results.map((signal) => (
                <button
                  type="button"
                  key={signal.id}
                  className="sf-result"
                  onClick={() => enterSave(signal)}
                >
                  <p>{signal.textPreview}</p>
                  <span>{new Date(signal.capturedAt).toLocaleDateString()}</span>
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* -------------------------------------------------------- CAPTURE */}
      <section className={`sf-layer sf-layer--capture${state === "capture" ? " on" : ""}`}>
        <div className="sf-column">
          <button type="button" className="sf-back" onClick={toWall}>
            ← the wall
          </button>
          <textarea
            ref={draftRef}
            className="sf-draft"
            value={draft}
            placeholder="What caught you?"
            onChange={(event) => {
              setDraft(event.target.value);
              setKept(null);
            }}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") void keep();
            }}
            aria-label="What caught you?"
          />
          {/* What is coming with it. Filenames as text under the draft, not
              preview cards — the words are the save; these are its luggage. */}
          {files.length > 0 ? (
            <ul className="sf-attached">
              {files.map((file, i) => (
                <li key={`${file.name}-${i}`}>
                  <span>{file.name}</span>
                  <button
                    type="button"
                    className="sf-remove"
                    onClick={() => setFiles((current) => current.filter((_, n) => n !== i))}
                  >
                    remove
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="sf-draft-foot">
            <button
              type="button"
              onClick={() => void keep()}
              disabled={(!draft.trim() && files.length === 0) || keeping}
            >
              {keeping ? "keeping…" : "keep"}
            </button>
            <button type="button" className="sf-quiet" onClick={() => fileInput.current?.click()}>
              attach
            </button>
            <input
              ref={fileInput}
              type="file"
              multiple
              hidden
              onChange={(event) => {
                setFiles((current) => [...current, ...Array.from(event.target.files ?? [])]);
                event.target.value = "";
              }}
            />
            {/* Shared by default. One word, and it says which state it is in
                rather than which state it would switch to. */}
            <button
              type="button"
              className={`sf-share${shareToGroups ? "" : " private"}`}
              onClick={() => setShareToGroups((on) => !on)}
              aria-pressed={!shareToGroups}
            >
              {shareToGroups ? "your rooms can read this" : "private to you"}
            </button>
            <span className="sf-shortcut">⌘↵</span>
          </div>
          {kept ? <p className="sf-kept">{kept}</p> : null}
        </div>
        </section>
      </div>

      {/*
        The rail lives on the frame, not in a state of its own.

        Time was a place you had to go, which meant leaving the wall to look at
        how the wall had changed -- the one thing you cannot see if you had to
        navigate away from it. It is a line above the verbs now: every moment
        in the room's life, and clicking one re-forms the readings in place.

        Only a room has a life. Your own wall is one person's, and there is no
        arrival to mark on it.
      */}
      {/*
        ONE row.

        The bottom was two stacked utility rows — a timeline and a verbs line —
        holding a fifth of the screen. Two control bars under a wall is what a
        dashboard looks like, and it was the least considered part of the
        product by a distance.

        Now the verbs sit left and time sits right, on the same line. Time is
        collapsed to the word you are at — "now", or the date you travelled to
        — and the track only unrolls when you reach for it. It is a control
        you use rarely; it should not be furniture you look at constantly.
      */}
      <nav className="sf-foot">
        <div className="sf-verbs">
          {undo ? (
            <button type="button" className="sf-undo" onClick={putBack}>
              took it down · put it back
            </button>
          ) : null}
          <button
            type="button"
            className={state === "capture" ? "on" : ""}
            onClick={() => {
              const opening = state !== "capture";
              setState(opening ? "capture" : "wall");
              if (opening) composerOpenedAt.current = Date.now();
              window.setTimeout(() => draftRef.current?.focus(), 60);
            }}
          >
            ＋ capture
            {draft.trim() && state !== "capture" ? (
              /* Something is still in the box. */
              <span className="sf-dot" aria-label="you have an unfinished save" />
            ) : null}
          </button>
          <button
            type="button"
            className={state === "ask" ? "on" : ""}
            onClick={() => setState(state === "ask" ? "wall" : "ask")}
          >
            {/* The count is the point: it says how much you have kept before
                you have asked for anything, which is the only number on this
                surface a person actually wants at a glance. */}
            {/* Until it lands, no number at all rather than a placeholder
                that looks like a count of nothing. */}
            {savedCount === null
              ? "inspirations"
              : `${savedCount}${savedCount >= SAVED_CEILING ? "+" : ""} inspirations`}
          </button>
          {/*
            Rooms live in the bar, not on the wall.

            Switching rooms was a full-screen state you travelled to, which
            made choosing a wall feel like leaving one. It is a menu on the
            same line as everything else you can do, so the wall never goes
            away while you pick.
          */}
          <details className="sf-rooms-menu">
            <summary>rooms</summary>
            <div className="sf-rooms-panel">
              <button
                type="button"
                className={`sf-room-row${room === null ? " on" : ""}`}
                onClick={() => {
                  setRoom(null);
                  closeMenus();
                }}
              >
                <span>your top of mind</span>
                <small>alone</small>
              </button>
              {rooms.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className={`sf-room-row${room === r.id ? " on" : ""}`}
                  onClick={() => {
                    setRoom(r.id);
                    closeMenus();
                  }}
                >
                  <span>{r.name}</span>
                  <small>
                    {r.memberCount} {r.memberCount === 1 ? "person" : "people"}
                  </small>
                </button>
              ))}
              {/*
                One field for both. A join code is short with no spaces; a room
                name is anything else — so the machine decides which you meant
                rather than making you pick a mode first.
              */}
              <form
                className="sf-room-new"
                onSubmit={(event) => {
                  event.preventDefault();
                  void makeOrJoinRoom();
                }}
              >
                <input
                  value={roomInput}
                  placeholder="new room, or a code to join one"
                  onChange={(event) => {
                    setRoomInput(event.target.value);
                    setRoomError(null);
                  }}
                  aria-label="new room, or a code to join one"
                />
                {roomInput.trim() ? (
                  <button type="submit" disabled={roomBusy}>
                    {roomBusy
                      ? "…"
                      : /^[A-Za-z0-9-]{4,24}$/.test(roomInput.trim())
                        ? "join"
                        : "make"}
                  </button>
                ) : null}
              </form>
              {roomError ? <p className="sf-room-err">{roomError}</p> : null}
            </div>
          </details>
        </div>

        {/*
          Everything on the right edge sits in one group, so your face is at
          the edge of the page whether or not there is a timeline or a cast
          beside it. Before, each of the three claimed `margin-left: auto`
          independently, so the row redistributed itself depending on which
          happened to be present — your face landed mid-line on your own wall
          and at the edge in a room.
        */}
        <div className="sf-foot-end">
        {moments.length > 1 ? (
          <div className="sf-time" role="group" aria-label="over time">
            <div
              className="sf-time-track"
              ref={trackRef}
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                setScrubbing(true);
                scrubTo(event.clientX);
              }}
              onPointerMove={(event) => {
                if (scrubbing) scrubTo(event.clientX);
              }}
              onPointerUp={() => setScrubbing(false)}
              onPointerCancel={() => setScrubbing(false)}
            >
              <span className="sf-time-line" />
              {allStops.map((stop) => (
                <button
                  key={stop.key}
                  type="button"
                  className={`sf-time-stop${travelledTo === stop.at ? " on" : ""}`}
                  style={{ left: `${stop.pct}%` }}
                  data-what={`${stop.when} — ${stop.label}`}
                  aria-label={`${stop.when} — ${stop.label}`}
                  onClick={() => travel(stop.at)}
                />
              ))}
              <span
                className={`sf-time-handle${scrubbing ? " dragging" : ""}`}
                style={{ left: `${here.pct}%` }}
                aria-hidden="true"
              />
            </div>
            {/* The one word you need when you are not using it. */}
            {/* At rest it names the control, not the position: "now" was
                answering a question nobody had asked yet. Once you travel it
                becomes the date, because then the position is the point. */}
            <span className={`sf-time-now${travelledTo ? " travelled" : ""}`}>
              {travelledTo ? here.when : "timeline"}
            </span>
          </div>
        ) : null}

        {/*
          The room's people, then you.

          Yours is always the face at the far end, and everyone else's sits to
          its left — so the pile reads as "them, and me", which is the order a
          person thinks in. On your own wall there is nobody to the left, which
          is how the surface says "alone" without printing the word.

          The pile is also the way into the room: who is here and how someone
          else gets in belong to the faces, not to a settings screen.
        */}
        {room && members.length > 0 ? (
          <details className="sf-cast-menu">
            <summary aria-label="about this room">
              <span className="sf-cast">
                {members
                  .filter((m) => m.userId !== user?.id)
                  .map((member) => (
                    <span
                      key={member.userId}
                      className="sf-face"
                      style={{ background: contributorColor(member.name) }}
                      title={member.name}
                    >
                      {contributorInitials(member.name)}
                    </span>
                  ))}
              </span>
            </summary>
            <div className="sf-roomsettings">{roomPanel}</div>
          </details>
        ) : null}

        {/*
          You, and everything that is about you rather than about the room:
          your profile, the language, and the admin surfaces if you have them.
          Classic scattered these as three separate pills in three corners.
        */}
        <details className="sf-you">
          <summary aria-label="you">
            <span
              className="sf-face"
              style={{ background: contributorColor(user?.name ?? "you") }}
            >
              {contributorInitials(user?.name ?? "you")}
            </span>
          </summary>
          <div className="sf-you-menu">
            <a href="/profile">your profile</a>
            {/* The Debug pill from classic. It was a floating chip in the
                corner of the wall; it belongs with the other things that are
                about you and your access, not the room. */}
            {showsDebug() ? <a href="/admin">debug</a> : null}
            {/* The language is about you, not the room, so it lives with the
                other things that are. */}
            <div className="sf-you-langs">
              {supportedLocales.map((option) => (
                <button
                  key={option.code}
                  type="button"
                  className={option.code === locale ? "on" : ""}
                  onClick={() => {
                    setLocale(option.code);
                    writeStoredLocale(option.code);
                  }}
                >
                  {option.nativeLabel}
                </button>
              ))}
            </div>
          </div>
        </details>
        </div>
      </nav>
    </div>
  );
}
