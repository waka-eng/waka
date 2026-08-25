/**
 * The surface.
 * ===========================================================================
 *
 * ONE SURFACE. Nothing navigates. Opening a capture does not take you
 * anywhere — the wall recedes in place and the thing you asked for comes
 * forward in the same box. Capture, the archive, the signals and the board
 * are STATES of this space, not places you visit.
 *
 * State is a single machine rather than several independent open/closed
 * flags, which is what makes "the wall recedes and the thing comes forward"
 * one attribute on one element instead of a fight between z-indexes.
 *
 * The three layers of `docs/data-model.md` map onto it exactly:
 *
 *   capture + archive  → layer 1, the profile's own inspirations
 *   signals            → layer 2, the patterns those captures support
 *   the wall           → layer 3, the one top-of-mind artifact
 *
 * Each state reads one layer. Nothing here draws from two at once, because a
 * surface that mixes a raw capture with a distilled claim is a surface that
 * cannot tell you which one you are looking at.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { JSX } from "react";
import { useLocation, useNavigate } from "react-router-dom";
/* Two icons, imported one at a time so the bundler takes two and not the set. */
import { Check, Paperclip } from "lucide-react";

import { contributorColor, contributorInitials } from "../components/faces";
import { AgentsScreen } from "../components/AgentsScreen";
import { GraphScreen } from "../components/GraphScreen";
import { useAuth } from "../lib/auth-context";
import { confidenceBandKey } from "../lib/confidence";
import {
  formatMessage,
  readStoredLocale,
  type SupportedLocale,
} from "../lib/i18n";
import { t } from "../lib/locales";
import {
  ApiError,
  affirmGroupProposal,
  createGroup,
  createGroupProposal,
  createInspiration,
  declarePrinciple,
  declineGroupProposal,
  deleteGroup,
  deletePrinciple,
  disputePrinciple,
  fetchGroupMembers,
  fetchGroupProposals,
  fetchGroups,
  fetchGroupTopOfMind,
  fetchGroupWall,
  fetchPrinciples,
  joinGroup,
  leaveGroup,
  refreshGroupTopOfMind,
  reorderPrinciples,
  updatePrinciple,
  createReflection,
  deleteInspiration,
  deleteReflection,
  deleteSignal,
  dismissTopOfMindEntry,
  fetchInspiration,
  fetchInspirations,
  fetchSignal,
  fetchSignals,
  fetchTopOfMind,
  finalizeAttachment,
  presignAttachment,
  refreshTopOfMind,
  restoreTopOfMindEntry,
  holdTopOfMindEntry,
  updateSignal,
  updateTopOfMindEntry,
  uploadToPresignedUrl,
  type ApiGroupMember,
  type ApiGroupProposal,
  type ApiGroupProposalKind,
  type ApiGroupSummary,
  type ApiGroupTopOfMind,
  type ApiGroupWallSignal,
  type ApiInspiration,
  type ApiPrinciple,
  type ApiInspirationSummary,
  type ApiSignal,
  type ApiSignalDetail,
  type ApiTopOfMind,
  type ApiTopOfMindEntry,
} from "../lib/api-surface";
import { whenShort } from "../lib/when";
import {
  buildSurfacePath,
  parseSurfacePath,
  type SurfaceView,
} from "../lib/surface-route";

interface SurfaceNavigationOptions {
  entityId?: string | null;
  replace?: boolean;
}

/**
 * Light up the words a signal rested on, inside the capture they came from.
 *
 * Whitespace-tolerant because the stored quote came back through a model and
 * a database round-trip, and a single collapsed newline should not lose the
 * mark. If the quote no longer appears — the capture was edited, enrichment
 * was appended — the text renders unmarked rather than marking the wrong
 * words. A missing highlight is honest; a wrong one attributes words to a
 * person who did not write them.
 */
/* The extractor is asked for a span, not a paragraph, and the server caps what
   it stores — but this builds a RegExp out of whatever arrives, so it enforces
   its own ceiling rather than trusting the field it was handed. */
const MAX_QUOTE_CHARS = 400;

export function markQuote(text: string, quote: string | null): JSX.Element {
  if (!quote) return <>{text}</>;
  const trimmed = quote.trim();
  if (trimmed.length < 12 || trimmed.length > MAX_QUOTE_CHARS) return <>{text}</>;
  const quoteRe = trimmed
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\s+/g, "\\s+");
  const match = new RegExp(quoteRe, "i").exec(text);
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
 * Pasted material arrives with its own line breaks, and `white-space: pre-wrap`
 * honours every one of them — so a post copied from Instagram renders as
 * fifteen one-line paragraphs at 1.68 leading and reads as broken.
 *
 * Single newlines inside a run of prose are the source's wrapping, not the
 * writer's intent; blank lines are. So: split on blank lines, join the rest.
 */
export function paragraphs(text: string): string[] {
  return text
    .split(/\n\s*\n+/)
    .map((block) => block.replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean);
}

/*
 * Each note gets its own TILT AND ITS OWN WIDTH. Combined with the grid's
 * `max-content` columns that is what makes a wall look like paper stuck up by
 * a person rather than a table of cards: the sheets are different sizes and
 * none of them are square to the wall.
 */
const NOTE_LAYOUTS: Array<{ tilt: number; w: string }> = [
  { tilt: -1.4, w: "340px" },
  { tilt: -2.2, w: "246px" },
  { tilt: 1.8, w: "252px" },
  { tilt: 1.2, w: "246px" },
  { tilt: -0.8, w: "262px" },
];

/*
 * Paper and ink, in pairs. The ink is coloured too — warm brown, maroon, moss,
 * slate — which is most of why these read as paper and not as tinted
 * rectangles.
 *
 * Keyed by POSITION, deliberately. Keying paper to an entry's type sounds
 * better and collapses in the most common case there is: a board that is
 * mostly patterns goes uniformly olive. What kind of statement it is belongs
 * in words, in a place that can say a word.
 */
const NOTE_COLORS = [
  { hue: "#ece4cb", ink: "#4a3e1f" },
  { hue: "#e8d4ce", ink: "#6b3c34" },
  { hue: "#d8ddc6", ink: "#3f4a2a" },
  { hue: "#cdd3df", ink: "#3a4456" },
  { hue: "#f1d7a8", ink: "#4f3921" },
];


/* Anyone with an unfinished capture when the tab closes keeps it, instead of
   losing the one thing a product about keeping things must never lose. */
const DRAFT_KEY = "waka.captureDraft.v1";

/** Every URL in what you typed. These become link attachments, which is what
 *  makes the page behind them readable to extraction at all. */
function urlsIn(text: string): string[] {
  return Array.from(new Set(text.match(/https?:\/\/[^\s<>"')]+/g) ?? []));
}

/** How long the archive count is worth counting exactly. */
const ARCHIVE_LIMIT = 200;

/** How long a rewritten entry or signal waits before it is persisted. */
const AUTOSAVE_DELAY_MS = 700;

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

export default function SurfacePage(): JSX.Element {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const route = useMemo(() => parseSurfacePath(location.pathname), [location.pathname]);
  const view = route.view;
  const openInspirationId = route.view === "inspiration" ? route.entityId : null;

  const [locale] = useState<SupportedLocale>(() => readStoredLocale());
  const [notice, setNotice] = useState<string | null>(null);

  /* Declared first because every layer's handlers close over it. */
  const navigateSurface = useCallback(
    (next: SurfaceView, options: SurfaceNavigationOptions = {}): void => {
      navigate(buildSurfacePath({ view: next, entityId: options.entityId ?? null }), {
        replace: options.replace ?? false,
      });
    },
    [navigate],
  );

  // Layer 3 — the board.
  const [topOfMind, setTopOfMind] = useState<ApiTopOfMind | null>(null);
  const [boardLoading, setBoardLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [entryDrafts, setEntryDrafts] = useState<Record<string, string>>({});
  const [takenDown, setTakenDown] = useState<ApiTopOfMindEntry | null>(null);
  const [drags, setDrags] = useState<Record<string, { x: number; y: number }>>({});
  const [dragging, setDragging] = useState<string | null>(null);

  // Layer 4 — the principles. Loaded on arrival (not on view entry) so the
  // count is ready the moment the view opens.
  const [principlesList, setPrinciplesList] = useState<ApiPrinciple[]>([]);
  const [principlesLoaded, setPrinciplesLoaded] = useState(false);
  const [principleDrafts, setPrincipleDrafts] = useState<Record<string, string>>({});
  const [declareDraft, setDeclareDraft] = useState("");
  const [declaring, setDeclaring] = useState(false);
  const principleTimers = useRef<Record<string, number>>({});

  const loadPrinciples = useCallback(async (): Promise<void> => {
    try {
      const rows = await fetchPrinciples();
      setPrinciplesList(rows);
      setPrincipleDrafts(Object.fromEntries(rows.map((row) => [row.id, row.statement])));
    } catch {
      // The verb simply stays hidden; the view shows the error if visited.
      setPrinciplesList([]);
    } finally {
      setPrinciplesLoaded(true);
    }
  }, []);

  useEffect(() => {
    void loadPrinciples();
  }, [loadPrinciples]);

  const declare = useCallback((): void => {
    const statement = declareDraft.trim();
    if (!statement || declaring) return;
    setDeclaring(true);
    void (async () => {
      try {
        const result = await declarePrinciple(statement);
        setDeclareDraft("");
        if (result.created === "principle") {
          setNotice(t(locale, "principlesDeclaredAsPrinciple"));
          await loadPrinciples();
        } else {
          // Routed, never refused: the words are kept as a capture, and the
          // surface says only where they landed.
          setNotice(t(locale, "principlesDeclaredAsCapture"));
        }
      } catch (err) {
        setNotice(errorMessage(err, t(locale, "principlesError")));
      } finally {
        setDeclaring(false);
      }
    })();
  }, [declareDraft, declaring, locale, loadPrinciples]);

  const rewritePrinciple = useCallback(
    (principle: ApiPrinciple, statement: string): void => {
      setPrincipleDrafts((current) => ({ ...current, [principle.id]: statement }));
      window.clearTimeout(principleTimers.current[principle.id]);
      principleTimers.current[principle.id] = window.setTimeout(() => {
        const trimmed = statement.trim();
        if (!trimmed || trimmed === principle.statement) return;
        void (async () => {
          try {
            const updated = await updatePrinciple(principle.id, trimmed);
            setPrinciplesList((current) =>
              current.map((row) => (row.id === updated.id ? updated : row)),
            );
          } catch (err) {
            setNotice(errorMessage(err, t(locale, "principlesError")));
          }
        })();
      }, AUTOSAVE_DELAY_MS);
    },
    [locale],
  );

  const movePrinciple = useCallback(
    (principle: ApiPrinciple, direction: -1 | 1): void => {
      const index = principlesList.findIndex((row) => row.id === principle.id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= principlesList.length) return;
      const order = principlesList.map((row) => row.id);
      [order[index], order[target]] = [order[target]!, order[index]!];
      void (async () => {
        try {
          setPrinciplesList(await reorderPrinciples(order));
        } catch (err) {
          setNotice(errorMessage(err, t(locale, "principlesError")));
        }
      })();
    },
    [principlesList, locale],
  );

  const removePrinciple = useCallback(
    (principle: ApiPrinciple): void => {
      if (!window.confirm(t(locale, "principlesRemoveConfirm"))) return;
      void (async () => {
        try {
          await deletePrinciple(principle.id);
          setPrinciplesList((current) => current.filter((row) => row.id !== principle.id));
        } catch (err) {
          setNotice(errorMessage(err, t(locale, "principlesError")));
        }
      })();
    },
    [locale],
  );

  const disputePrincipleRow = useCallback(
    (principle: ApiPrinciple): void => {
      void (async () => {
        try {
          await disputePrinciple(principle.id);
          setPrinciplesList((current) =>
            current.map((row) =>
              row.id === principle.id ? { ...row, state: "contested" as const } : row,
            ),
          );
        } catch (err) {
          setNotice(errorMessage(err, t(locale, "principlesError")));
        }
      })();
    },
    [locale],
  );

  // Rooms — the walls a few profiles keep together ("groups" in the canon).
  // A room shows only what crossed the account boundary by choice: members'
  // shared signal statements and the reading generated from them — never
  // anyone's captures. The list is loaded when a rooms view opens; a deep
  // link to /rooms/:id needs the summary (name, role, join code) and there
  // is no single-group endpoint, so membership stays the one read that
  // answers both "which rooms" and "may I".
  const [groupsList, setGroupsList] = useState<ApiGroupSummary[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [groupsLoaded, setGroupsLoaded] = useState(false);
  const [roomNameDraft, setRoomNameDraft] = useState("");
  const [joinCodeDraft, setJoinCodeDraft] = useState("");
  const [roomBusy, setRoomBusy] = useState(false);
  const [roomWall, setRoomWall] = useState<ApiGroupWallSignal[]>([]);
  const [roomTom, setRoomTom] = useState<ApiGroupTopOfMind | null>(null);
  const [roomMembers, setRoomMembers] = useState<ApiGroupMember[]>([]);
  const [roomProposals, setRoomProposals] = useState<ApiGroupProposal[]>([]);
  const [roomLoading, setRoomLoading] = useState(false);
  const [roomRereading, setRoomRereading] = useState(false);
  const [roomEntryDrafts, setRoomEntryDrafts] = useState<Record<string, string>>({});
  const [roomProposeDraft, setRoomProposeDraft] = useState("");

  const roomId = route.view === "room" ? route.entityId : null;
  const room = roomId ? (groupsList.find((row) => row.id === roomId) ?? null) : null;

  const loadGroups = useCallback(async (): Promise<void> => {
    setGroupsLoading(true);
    try {
      setGroupsList(await fetchGroups());
    } catch (err) {
      setNotice(errorMessage(err, "Your rooms could not be loaded."));
    } finally {
      setGroupsLoading(false);
      setGroupsLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (view !== "rooms" && view !== "room") return;
    void loadGroups();
  }, [view, loadGroups]);

  /* A room that is not on the member's own list does not exist for them —
     the server answers 404 either way, so the redirect happens here where it
     can land on the list instead of a blank layer. */
  useEffect(() => {
    if (!roomId || !groupsLoaded || groupsLoading) return;
    if (!groupsList.some((row) => row.id === roomId)) {
      setNotice(t(locale, "roomGone"));
      navigateSurface("rooms", { replace: true });
    }
  }, [roomId, groupsLoaded, groupsLoading, groupsList, locale, navigateSurface]);

  useEffect(() => {
    if (!roomId) return;
    let cancelled = false;
    setRoomLoading(true);
    setRoomWall([]);
    setRoomTom(null);
    setRoomMembers([]);
    setRoomProposals([]);
    setRoomEntryDrafts({});
    setRoomProposeDraft("");
    (async () => {
      try {
        const [wall, tom, members, proposals] = await Promise.all([
          fetchGroupWall(roomId),
          fetchGroupTopOfMind(roomId),
          fetchGroupMembers(roomId),
          fetchGroupProposals(roomId),
        ]);
        if (cancelled) return;
        setRoomWall(wall);
        setRoomTom(tom);
        setRoomMembers(members);
        setRoomProposals(proposals);
      } catch (err) {
        if (!cancelled) setNotice(errorMessage(err, "This room could not be loaded."));
      } finally {
        if (!cancelled) setRoomLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [roomId]);

  const createRoom = useCallback((): void => {
    const name = roomNameDraft.trim();
    if (!name || roomBusy) return;
    setRoomBusy(true);
    void (async () => {
      try {
        const group = await createGroup(name);
        setRoomNameDraft("");
        setGroupsList((current) => [group, ...current]);
        navigateSurface("room", { entityId: group.id });
      } catch (err) {
        setNotice(errorMessage(err, t(locale, "roomsError")));
      } finally {
        setRoomBusy(false);
      }
    })();
  }, [roomNameDraft, roomBusy, locale, navigateSurface]);

  const joinRoom = useCallback((): void => {
    const code = joinCodeDraft.trim();
    if (!code || roomBusy) return;
    setRoomBusy(true);
    void (async () => {
      try {
        const { group, alreadyMember } = await joinGroup(code);
        setJoinCodeDraft("");
        if (alreadyMember) setNotice(t(locale, "roomsAlreadyMember"));
        setGroupsList((current) =>
          current.some((row) => row.id === group.id) ? current : [group, ...current],
        );
        navigateSurface("room", { entityId: group.id });
      } catch (err) {
        setNotice(errorMessage(err, t(locale, "roomsError")));
      } finally {
        setRoomBusy(false);
      }
    })();
  }, [joinCodeDraft, roomBusy, locale, navigateSurface]);

  /* One button, two verbs: the owner closing a room and a member leaving one
     are the same gesture with different blast radii, so the confirmation is
     what carries the difference. */
  const leaveOrCloseRoom = useCallback((): void => {
    if (!room) return;
    const owner = room.role === "owner";
    if (!window.confirm(t(locale, owner ? "roomCloseConfirm" : "roomLeaveConfirm"))) return;
    void (async () => {
      try {
        if (owner) await deleteGroup(room.id);
        else await leaveGroup(room.id);
        setGroupsList((current) => current.filter((row) => row.id !== room.id));
        navigateSurface("rooms", { replace: true });
      } catch (err) {
        setNotice(errorMessage(err, t(locale, "roomError")));
      }
    })();
  }, [room, locale, navigateSurface]);

  const reloadRoomProposals = useCallback(async (id: string): Promise<void> => {
    setRoomProposals(await fetchGroupProposals(id));
  }, []);

  /* Same contract as the personal reread: wait for the version to move, and
     say so honestly when it does not. Shared with the accepted-proposal path,
     because an acceptance also asks regeneration for the next version. */
  const pollRoomVersion = useCallback(
    async (id: string, before: number): Promise<boolean> => {
      const deadline = Date.now() + 90_000;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 3_000));
        const next = await fetchGroupTopOfMind(id);
        if ((next.topOfMind?.version ?? 0) > before) {
          setRoomTom(next);
          setRoomEntryDrafts({});
          return true;
        }
      }
      return false;
    },
    [],
  );

  const rereadRoom = useCallback((): void => {
    if (!roomId || roomRereading) return;
    setRoomRereading(true);
    void (async () => {
      const before = roomTom?.topOfMind?.version ?? 0;
      try {
        await refreshGroupTopOfMind(roomId);
        if (!(await pollRoomVersion(roomId, before))) {
          setNotice(t(locale, "roomStillReading"));
        }
      } catch (err) {
        setNotice(errorMessage(err, t(locale, "roomReadFailed")));
      } finally {
        setRoomRereading(false);
      }
    })();
  }, [roomId, roomRereading, roomTom, locale, pollRoomVersion]);

  const proposeRoomChange = useCallback(
    (input: { kind: ApiGroupProposalKind; entryId?: string; body?: string }): void => {
      if (!roomId) return;
      void (async () => {
        try {
          await createGroupProposal(roomId, input);
          setNotice(t(locale, "roomProposalSent"));
          await reloadRoomProposals(roomId);
        } catch (err) {
          setNotice(errorMessage(err, t(locale, "roomError")));
        }
      })();
    },
    [roomId, locale, reloadRoomProposals],
  );

  const affirmRoomProposal = useCallback(
    (proposal: ApiGroupProposal): void => {
      if (!roomId) return;
      void (async () => {
        try {
          const before = roomTom?.topOfMind?.version ?? 0;
          const { accepted } = await affirmGroupProposal(roomId, proposal.id);
          await reloadRoomProposals(roomId);
          if (accepted) {
            setNotice(t(locale, "roomAccepted"));
            setRoomRereading(true);
            try {
              await pollRoomVersion(roomId, before);
            } finally {
              setRoomRereading(false);
            }
          }
        } catch (err) {
          setNotice(errorMessage(err, t(locale, "roomError")));
        }
      })();
    },
    [roomId, roomTom, locale, reloadRoomProposals, pollRoomVersion],
  );

  const declineRoomProposal = useCallback(
    (proposal: ApiGroupProposal): void => {
      if (!roomId) return;
      void (async () => {
        try {
          await declineGroupProposal(roomId, proposal.id);
          await reloadRoomProposals(roomId);
        } catch (err) {
          setNotice(errorMessage(err, t(locale, "roomError")));
        }
      })();
    },
    [roomId, locale, reloadRoomProposals],
  );

  // Layer 2 — the signals.
  const [signals, setSignals] = useState<ApiSignal[]>([]);
  const [signalsLoading, setSignalsLoading] = useState(false);
  const [openSignal, setOpenSignal] = useState<ApiSignalDetail | null>(null);
  const [signalDrafts, setSignalDrafts] = useState<Record<string, string>>({});

  // Layer 1 — the archive and one capture.
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ApiInspirationSummary[]>([]);
  const [searching, setSearching] = useState(false);
  const [savedCount, setSavedCount] = useState<number | null>(null);
  const [detail, setDetail] = useState<ApiInspiration | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [reflectionQuestion, setReflectionQuestion] = useState("");
  const [reflectionAnswer, setReflectionAnswer] = useState("");

  // The composer.
  const [draft, setDraft] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    try {
      return window.localStorage.getItem(DRAFT_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const [files, setFiles] = useState<File[]>([]);
  const [keeping, setKeeping] = useState(false);
  const [kept, setKept] = useState<string | null>(null);

  const draftRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const askInputRef = useRef<HTMLInputElement | null>(null);
  const autosaveTimers = useRef<Record<string, number>>({});
  const dragFrom = useRef<
    { id: string; x: number; y: number; baseX: number; baseY: number } | null
  >(null);
  const dragMoved = useRef(false);

  /* The draft outlives the tab. Written on every keystroke because the moment
     worth protecting is the one nobody chose — a closed laptop, a crash. */
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (draft) window.localStorage.setItem(DRAFT_KEY, draft);
      else window.localStorage.removeItem(DRAFT_KEY);
    } catch {
      // Private-mode browsers refuse; the draft still lives in memory.
    }
  }, [draft]);

  useEffect(() => {
    const timers = autosaveTimers.current;
    return () => {
      for (const handle of Object.values(timers)) window.clearTimeout(handle);
    };
  }, []);

  // -------------------------------------------------------------------------
  // Loading
  // -------------------------------------------------------------------------

  const loadBoard = useCallback(async (): Promise<void> => {
    setBoardLoading(true);
    try {
      const next = await fetchTopOfMind();
      setTopOfMind(next);
      setEntryDrafts({});
    } catch (err) {
      setNotice(errorMessage(err, "Your board could not be loaded."));
    } finally {
      setBoardLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadBoard();
  }, [loadBoard]);


  /* The count in the bar is the one number a person actually wants at a
     glance, so it is fetched once on arrival rather than only when the
     archive is opened. */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows = await fetchInspirations({ limit: ARCHIVE_LIMIT });
        if (!cancelled) setSavedCount(rows.length);
      } catch {
        // A missing count shows no number at all, which is honest; the
        // archive itself reports its own failure when it is opened.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (view !== "signals") return;
    let cancelled = false;
    setSignalsLoading(true);
    (async () => {
      try {
        const rows = await fetchSignals({ limit: 100 });
        if (!cancelled) setSignals(rows);
      } catch (err) {
        if (!cancelled) setNotice(errorMessage(err, "Your signals could not be loaded."));
      } finally {
        if (!cancelled) setSignalsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [view]);

  /* Typing in the archive searches as you go; an empty field shows what you
     kept most recently, rather than a blank page waiting to be typed into. */
  useEffect(() => {
    if (view !== "archive") return;
    let cancelled = false;
    setSearching(true);
    const handle = window.setTimeout(() => {
      (async () => {
        try {
          const rows = await fetchInspirations({
            q: query.trim() || undefined,
            limit: 40,
          });
          if (!cancelled) setResults(rows);
        } catch (err) {
          if (!cancelled) setNotice(errorMessage(err, "That search did not run."));
        } finally {
          if (!cancelled) setSearching(false);
        }
      })();
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [view, query]);

  useEffect(() => {
    if (!openInspirationId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    (async () => {
      try {
        const next = await fetchInspiration(openInspirationId);
        if (!cancelled) setDetail(next);
      } catch (err) {
        if (!cancelled) {
          setNotice(errorMessage(err, "That capture could not be opened."));
          setDetail(null);
        }
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [openInspirationId]);

  useEffect(() => {
    if (view === "capture") window.setTimeout(() => draftRef.current?.focus(), 60);
    if (view === "archive") window.setTimeout(() => askInputRef.current?.focus(), 60);
  }, [view]);

  // -------------------------------------------------------------------------
  // The board
  // -------------------------------------------------------------------------

  const entries = useMemo(
    () =>
      (topOfMind?.entries ?? [])
        .filter((entry) => !entry.dismissed)
        .slice()
        .sort((a, b) => {
          if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
          return a.sortOrder - b.sortOrder;
        }),
    [topOfMind],
  );

  const replaceEntry = useCallback((updated: ApiTopOfMindEntry): void => {
    setTopOfMind((current) =>
      current
        ? {
            ...current,
            entries: current.entries.map((entry) =>
              entry.id === updated.id ? updated : entry,
            ),
          }
        : current,
    );
  }, []);

  /**
   * Run one curation action against the board.
   *
   * A 404 here is not a failure to explain away: it means the artifact was
   * regenerated under the reader and this line is no longer in the live
   * version — the generator reworded or dropped it. The server resolves ids
   * forward when the text survived, so reaching this branch means the text
   * did not. Leaving the old words on screen beside an error would invite the
   * same dead click again, so the board is reloaded to show what is actually
   * there now.
   */
  const curate = useCallback(
    async (
      action: () => Promise<ApiTopOfMindEntry>,
      fallback: string,
      onDone?: () => void,
    ): Promise<void> => {
      try {
        replaceEntry(await action());
        onDone?.();
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          setNotice("Your board was rewritten while you were reading it.");
          await loadBoard();
          return;
        }
        setNotice(errorMessage(err, fallback));
      }
    },
    [replaceEntry, loadBoard],
  );

  /**
   * Rewriting an entry is the least ceremonious possible way to disagree with
   * a reading about yourself: the sentence IS the editable thing, no button,
   * no mode, no pencil. It autosaves, because a correction you have to confirm
   * is a correction you abandon halfway — and the save locks the entry, so
   * the next synthesis works around your words instead of over them.
   */
  const rewriteEntry = useCallback(
    (entry: ApiTopOfMindEntry, text: string): void => {
      setEntryDrafts((current) => ({ ...current, [entry.id]: text }));
      window.clearTimeout(autosaveTimers.current[entry.id]);
      autosaveTimers.current[entry.id] = window.setTimeout(() => {
        const body = text.trim();
        if (!body || body === entry.body) return;
        void (async () => {
          try {
            replaceEntry(await updateTopOfMindEntry(entry.id, { body }));
          } catch (err) {
            setNotice(errorMessage(err, "That correction was not saved."));
          }
        })();
      }, AUTOSAVE_DELAY_MS);
    },
    [replaceEntry],
  );

  /**
   * Holding is one-directional, and the control says so by going quiet once
   * it is done: the generator carries a held entry into every version it
   * writes, so the way back is taking it down rather than a second press.
   */
  const holdEntry = useCallback(
    (entry: ApiTopOfMindEntry): void => {
      if (entry.pinned) return;
      void curate(
        () => holdTopOfMindEntry(entry.id),
        "That was not saved.",
      );
    },
    [curate],
  );

  const takeEntryDown = useCallback(
    (entry: ApiTopOfMindEntry): void => {
      void curate(
        () => dismissTopOfMindEntry(entry.id),
        "That entry stayed up.",
        () => setTakenDown(entry),
      );
    },
    [curate],
  );

  const putEntryBack = useCallback((): void => {
    const entry = takenDown;
    if (!entry) return;
    setTakenDown(null);
    void curate(
      () => restoreTopOfMindEntry(entry.id),
      "That entry could not be put back.",
    );
  }, [takenDown, curate]);

  /**
   * Reading again is a board-level act, so it belongs to the board's name
   * rather than to a toolbar. The server answers 202 and synthesises in the
   * background, so this polls until a version newer than the one on screen is
   * live — an immediate single reload is guaranteed to re-render the old
   * version, which reads as the button doing nothing. Bounded: synthesis is
   * one model call plus queue latency, so a quiet minute means it genuinely
   * did not land, and saying so beats spinning.
   */
  const reread = useCallback((): void => {
    if (refreshing) return;
    setRefreshing(true);
    void (async () => {
      const before = topOfMind?.version ?? 0;
      try {
        await refreshTopOfMind();
        const deadline = Date.now() + 90_000;
        let seen = before;
        while (Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 3_000));
          const next = await fetchTopOfMind();
          if (next && next.version > before) {
            setTopOfMind(next);
            setEntryDrafts({});
            seen = next.version;
            break;
          }
        }
        if (seen === before) {
          setNotice("Still reading — the new version will be here on your next visit.");
        }
      } catch (err) {
        setNotice(errorMessage(err, "That reading did not start."));
      } finally {
        setRefreshing(false);
      }
    })();
  }, [refreshing, topOfMind]);

  // -------------------------------------------------------------------------
  // Signals
  // -------------------------------------------------------------------------

  const openSignalDetail = useCallback(
    (signal: ApiSignal): void => {
      if (openSignal?.id === signal.id) {
        setOpenSignal(null);
        return;
      }
      void (async () => {
        try {
          setOpenSignal(await fetchSignal(signal.id));
        } catch (err) {
          setNotice(errorMessage(err, "That signal could not be opened."));
        }
      })();
    },
    [openSignal],
  );

  /** Same rule as an entry: your words replace the generated ones and lock. */
  const rewriteSignal = useCallback((signal: ApiSignal, text: string): void => {
    setSignalDrafts((current) => ({ ...current, [signal.id]: text }));
    window.clearTimeout(autosaveTimers.current[signal.id]);
    autosaveTimers.current[signal.id] = window.setTimeout(() => {
      const statement = text.trim();
      if (!statement || statement === signal.statement) return;
      void (async () => {
        try {
          const updated = await updateSignal(signal.id, { statement });
          setSignals((current) =>
            current.map((row) => (row.id === updated.id ? updated : row)),
          );
        } catch (err) {
          setNotice(errorMessage(err, "That correction was not saved."));
        }
      })();
    }, AUTOSAVE_DELAY_MS);
  }, []);

  const removeSignal = useCallback((signal: ApiSignal): void => {
    void (async () => {
      try {
        await deleteSignal(signal.id);
        setSignals((current) => current.filter((row) => row.id !== signal.id));
        setOpenSignal((current) => (current?.id === signal.id ? null : current));
      } catch (err) {
        setNotice(errorMessage(err, "That signal is still here."));
      }
    })();
  }, []);

  // -------------------------------------------------------------------------
  // Capture
  // -------------------------------------------------------------------------

  /**
   * Keep what is in the box.
   *
   * The text is the capture; files and pasted links are its luggage, attached
   * afterwards so a failed upload costs the attachment and never the words.
   */
  const keep = useCallback((): void => {
    const text = draft.trim();
    if ((!text && files.length === 0) || keeping) return;
    setKeeping(true);
    void (async () => {
      try {
        const links = urlsIn(text);
        const kind =
          files.length > 0 && text
            ? "mixed"
            : files.length > 0
              ? "image"
              : links.length > 0
                ? "link"
                : "note";
        const inspiration = await createInspiration({ text, kind });

        for (const url of links) {
          try {
            await finalizeAttachment({
              type: "link",
              inspirationId: inspiration.id,
              url,
            });
          } catch {
            // A link that will not attach is still saved inside the text.
          }
        }

        for (const file of files) {
          try {
            const presigned = await presignAttachment({
              filename: file.name,
              contentType: file.type || "application/octet-stream",
              size: file.size,
            });
            await uploadToPresignedUrl(presigned.uploadUrl, file, presigned.headers);
            await finalizeAttachment({
              type: file.type.startsWith("image/") ? "image" : "file",
              inspirationId: inspiration.id,
              key: presigned.key,
              name: file.name,
              contentType: file.type || undefined,
              size: file.size,
            });
          } catch (err) {
            setNotice(errorMessage(err, `${file.name} did not come with it.`));
          }
        }

        setDraft("");
        setFiles([]);
        setKept("kept");
        setSavedCount((current) => (current === null ? current : current + 1));
      } catch (err) {
        setNotice(errorMessage(err, "That was not kept."));
      } finally {
        setKeeping(false);
      }
    })();
  }, [draft, files, keeping]);

  // -------------------------------------------------------------------------
  // One capture
  // -------------------------------------------------------------------------

  const addReflection = useCallback((): void => {
    const inspiration = detail;
    const question = reflectionQuestion.trim();
    if (!inspiration || !question) return;
    void (async () => {
      try {
        const reflection = await createReflection(inspiration.id, {
          question,
          answer: reflectionAnswer.trim() || undefined,
        });
        setDetail((current) =>
          current && current.id === inspiration.id
            ? { ...current, reflections: [...current.reflections, reflection] }
            : current,
        );
        setReflectionQuestion("");
        setReflectionAnswer("");
      } catch (err) {
        setNotice(errorMessage(err, "That reflection was not saved."));
      }
    })();
  }, [detail, reflectionQuestion, reflectionAnswer]);

  const removeReflection = useCallback(
    (reflectionId: string): void => {
      const inspiration = detail;
      if (!inspiration) return;
      void (async () => {
        try {
          await deleteReflection(inspiration.id, reflectionId);
          setDetail((current) =>
            current && current.id === inspiration.id
              ? {
                  ...current,
                  reflections: current.reflections.filter(
                    (reflection) => reflection.id !== reflectionId,
                  ),
                }
              : current,
          );
        } catch (err) {
          setNotice(errorMessage(err, "That reflection is still here."));
        }
      })();
    },
    [detail],
  );

  /**
   * Deleting a capture removes its evidence links too. A signal that loses all
   * of its support is retired by the server unless a human edit locked it, in
   * which case the words stay and the signal is marked unsupported — so this
   * says what it costs rather than asking twice.
   */
  const removeInspiration = useCallback((): void => {
    const inspiration = detail;
    if (!inspiration) return;
    void (async () => {
      try {
        await deleteInspiration(inspiration.id);
        setResults((current) => current.filter((row) => row.id !== inspiration.id));
        setSavedCount((current) => (current === null ? current : Math.max(0, current - 1)));
        navigateSurface("archive", { replace: true });
      } catch (err) {
        setNotice(errorMessage(err, "That capture is still here."));
      }
    })();
  }, [detail, navigateSurface]);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  const busy = view !== "wall";
  const boardName = profile?.name ? `${profile.name}'s top of mind` : "your top of mind";
  const lastRead = topOfMind
    ? `read ${whenShort(topOfMind.createdAt)} · v${topOfMind.version}`
    : boardLoading
      ? "opening…"
      : "not read yet";

  return (
    <div className="sf" data-state={view} data-busy={busy ? "true" : "false"}>
      {/*
        The board header belongs to the board. Every other view opens with its
        own head (a back link and its own name), so repeating "X's top of
        mind" above them titled the wrong page — it reads as a headline for
        whatever sits below it.
      */}
      {view === "wall" ? (
      <header className="sf-head">
        {/*
          The name, and nothing else.

          A headline above it and a line beneath both told you what you can
          already see: the entries are on the wall. A header that narrates the
          page is a header doing the page's job badly.
        */}
        <h1 className="sf-roomname">{boardName}</h1>
        {/*
          When it was last read, and a way to read it again.

          The time is a FACT, not a control — making the whole sentence
          clickable meant the only way to learn what "reading" does here was to
          do it, which is a poor trade for something that spends model budget.
          So the sentence says when, quietly, and the rotate beside it is the
          button. Icon and text, each doing one job.
        */}
        <p className="sf-lastread">
          <span>{lastRead}</span>
          <button
            type="button"
            className={`sf-reread${refreshing ? " spinning" : ""}`}
            onClick={reread}
            disabled={refreshing || boardLoading}
            title="read this again"
            aria-label="read this again"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1" />
              <path d="M20.5 3.5v4.6h-4.6" />
            </svg>
          </button>
        </p>
      </header>
      ) : null}

      <div className="sf-body">
        {notice ? (
          <p className="sf-surface-notice" role="alert">
            {notice}
          </p>
        ) : null}

        {/* ------------------------------------------------------------ WALL */}
        <section className={`sf-layer sf-layer--wall${view === "wall" ? " on" : ""}`}>
          {boardLoading ? <p className="sf-empty">reading…</p> : null}
          {!boardLoading && entries.length === 0 ? (
            <p className="sf-empty">
              Nothing is on the board yet. Keep a few things and it will have
              something to read.
            </p>
          ) : null}
          <div className="sf-wall">
            {entries.map((entry, i) => {
              const layout = NOTE_LAYOUTS[i % NOTE_LAYOUTS.length]!;
              const paper = NOTE_COLORS[i % NOTE_COLORS.length]!;
              const drag = drags[entry.id] ?? { x: 0, y: 0 };
              return (
                <article
                  key={entry.id}
                  className={`sf-postit${dragging === entry.id ? " sf-postit--dragging" : ""}${
                    entry.pinned ? " sf-postit--held" : ""
                  }`}
                  style={{
                    ["--bg" as string]: paper.hue,
                    ["--ink" as string]: paper.ink,
                    ["--tilt" as string]: `${layout.tilt}deg`,
                    ["--w" as string]: layout.w,
                    ["--dx" as string]: `${drag.x}px`,
                    ["--dy" as string]: `${drag.y}px`,
                  }}
                  onPointerDown={(event) => {
                    if ((event.target as HTMLElement).closest("button, textarea")) return;
                    event.currentTarget.setPointerCapture(event.pointerId);
                    dragFrom.current = {
                      id: entry.id,
                      x: event.clientX,
                      y: event.clientY,
                      baseX: drag.x,
                      baseY: drag.y,
                    };
                    dragMoved.current = false;
                    setDragging(entry.id);
                  }}
                  onPointerMove={(event) => {
                    const from = dragFrom.current;
                    if (!from || from.id !== entry.id) return;
                    const dx = event.clientX - from.x;
                    const dy = event.clientY - from.y;
                    if (Math.abs(dx) + Math.abs(dy) > 3) dragMoved.current = true;
                    setDrags((current) => ({
                      ...current,
                      [entry.id]: { x: from.baseX + dx, y: from.baseY + dy },
                    }));
                  }}
                  onPointerUp={() => {
                    dragFrom.current = null;
                    setDragging(null);
                  }}
                >
                  {/*
                    The sentence IS the editable thing — no button, no mode, no
                    pencil icon. You click into a reading about yourself and
                    change it, and the change is what tells the server to stop
                    rewriting this one.
                  */}
                  <textarea
                    className="sf-postit-text"
                    value={entryDrafts[entry.id] ?? entry.body}
                    rows={1}
                    spellCheck
                    aria-label="this entry — edit to correct it"
                    onPointerDown={(event) => event.stopPropagation()}
                    onChange={(event) => rewriteEntry(entry, event.target.value)}
                  />
                  {entry.prompt ? <p className="sf-question">{entry.prompt}</p> : null}
                  <footer>
                    <span className="sf-provenance">
                      {entry.type}
                      {entry.citedSignals.length > 0
                        ? ` · ${entry.citedSignals.length} signals`
                        : ""}
                      {entry.locked ? " · yours" : ""}
                    </span>
                    <span className="sf-postit-acts">
                      <button
                        type="button"
                        className={`sf-act${entry.pinned ? " on" : ""}`}
                        title={entry.pinned ? "held" : "hold this"}
                        aria-label={entry.pinned ? "held" : "hold"}
                        aria-pressed={entry.pinned}
                        disabled={entry.pinned}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={() => holdEntry(entry)}
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
                        onClick={() => takeEntryDown(entry)}
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
        </section>

        {/* --------------------------------------------------------- SIGNALS */}
        {/*
          What the captures added up to. Between the raw pile and the board:
          the patterns the board is written from, each with the captures that
          put it there.
        */}
        <section className={`sf-layer sf-layer--signals${view === "signals" ? " on" : ""}`}>
          <div className="sf-column">
            <button type="button" className="sf-back" onClick={() => navigateSurface("wall")}>
              ← back
            </button>
            <p className="sf-claim">What your captures keep saying.</p>
            <div className="sf-label">
              {signalsLoading ? "reading…" : `${signals.length} signals`}
            </div>
            <div className="sf-results">
              {!signalsLoading && signals.length === 0 ? (
                <p className="sf-empty">
                  Nothing has been distilled yet. Signals appear once there is
                  enough kept for a pattern to repeat.
                </p>
              ) : null}
              {signals.map((signal) => (
                <div key={signal.id} className="sf-result">
                  <textarea
                    className="sf-postit-text"
                    value={signalDrafts[signal.id] ?? signal.statement}
                    rows={1}
                    spellCheck
                    aria-label="this signal — edit to correct it"
                    onChange={(event) => rewriteSignal(signal, event.target.value)}
                  />
                  <button
                    type="button"
                    className="sf-provenance"
                    onClick={() => openSignalDetail(signal)}
                    aria-expanded={openSignal?.id === signal.id}
                  >
                    {/* `42%` USED TO BE HERE, AND IT HAD NO LEGEND.
                        A quantity with no unit and no scale in sight — 42% of
                        what, out of what, good or bad — sitting between two
                        things that were already states in words. The law is
                        that states render and numerals never; `confidence` is
                        the light, and a flat surface with no light channel
                        says it in a word instead. See lib/confidence.ts for
                        where the bands are cut and why they are not thirds.

                        The rest of this line was hardcoded English while the
                        surface around it was localized, so introducing one
                        translated word would have made it a mix. All of it
                        speaks the reader's language now. */}
                    {/* ONE KEY FOR THE WHOLE PHRASE, NOT A NUMBER PLUS A
                        SUFFIX. `{n} {suffix}` puts a space between them that
                        English wants and Korean does not — the first pass
                        rendered `3 개가 뒷받침`, where the counter has to
                        attach: `근거 3개`. Word order differs too, so only the
                        message can decide it. `formatMessage` already carries
                        placeholders and plurals; this line had never used
                        them. */}
                    {formatMessage(locale, "signalEvidenceBehind", {
                      count: signal.evidenceCount,
                    })}
                    {" · "}
                    {t(locale, confidenceBandKey(signal.confidence))}
                    {/* A still-forming pattern reads differently from a
                        settled one; without this an emerging signal looks
                        exactly like an active one it is not yet eligible to
                        become part of the top of mind. */}
                    {signal.status === "emerging" ? ` · ${t(locale, "signalStillForming")}` : ""}
                    {signal.status === "retired" ? ` · ${t(locale, "signalRetiredState")}` : ""}
                    {signal.locked ? ` · ${t(locale, "signalYours")}` : ""}
                    {signal.unsupported ? ` · ${t(locale, "signalUnsupported")}` : ""}
                  </button>
                  {signal.lastEvidenceAt ? (
                    <span className="sf-when">{whenShort(signal.lastEvidenceAt)}</span>
                  ) : null}
                  <button
                    type="button"
                    className="sf-act"
                    title="take it down"
                    aria-label="take it down"
                    onClick={() => removeSignal(signal)}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                      <path d="M4 7h16" />
                      <path d="M10 11v6" />
                      <path d="M14 11v6" />
                      <path d="M6.5 7 7.4 20h9.2l.9-13" />
                      <path d="M9 7V4.8h6V7" />
                    </svg>
                  </button>
                  {openSignal?.id === signal.id ? (
                    <div className="sf-evidence">
                      <div className="sf-evidence-head">what it rests on</div>
                      {openSignal.evidence.length === 0 ? (
                        <p className="sf-empty">Nothing is behind this one any more.</p>
                      ) : null}
                      {openSignal.evidence.map((evidence) => (
                        <button
                          key={evidence.inspirationId}
                          type="button"
                          className="sf-result-open"
                          onClick={() =>
                            navigateSurface("inspiration", {
                              entityId: evidence.inspirationId,
                            })
                          }
                        >
                          <p>{markQuote(evidence.preview, evidence.quote)}</p>
                          <span>{evidence.reason ?? whenShort(evidence.createdAt)}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------ PRINCIPLES */}
        {/*
          Layer 4. Deliberately NOT the wall's paper: serif statements, rank
          numbers, hairline dividers, no tilt — the wall is today's desk, this
          reads engraved. Cardinality is the first thing the surface says: the
          wall is one rewritten board, this is an accumulating ranked list.
        */}
        <section className={`sf-layer sf-layer--principles${view === "principles" ? " on" : ""}`}>
          <div className="sf-column">
            <button type="button" className="sf-back" onClick={() => navigateSurface("wall")}>
              ← back
            </button>
            <div className="pr-head">
              <div>
                <div className="pr-eyebrow">{t(locale, "principlesEyebrow")}</div>
                <h2 className="pr-title">{t(locale, "principlesTitle")}</h2>
              </div>
              <div className="pr-meta-right">
                {principlesList.length} · {t(locale, "principlesMeta")}
              </div>
            </div>

            {principlesLoaded && principlesList.length === 0 ? (
              <p className="pr-empty">{t(locale, "principlesEmpty")}</p>
            ) : null}

            <ol className="pr-list">
              {principlesList.map((principle, index) => (
                <li key={principle.id} className="pr-row">
                  <span className="pr-rank">{String(index + 1).padStart(2, "0")}</span>
                  <div className="pr-body">
                    <input
                      className="pr-statement"
                      type="text"
                      value={principleDrafts[principle.id] ?? principle.statement}
                      aria-label={principle.statement}
                      onChange={(event) => {
                        const value = event.currentTarget.value;
                        rewritePrinciple(principle, value);
                      }}
                    />
                    <div className="pr-meta">
                      <span className={`pr-state is-${principle.state}`}>
                        {t(
                          locale,
                          principle.state === "held"
                            ? "principlesStateHeld"
                            : principle.state === "aspirational"
                              ? "principlesStateAspirational"
                              : "principlesStateContested",
                        )}
                      </span>
                      {principle.origin === "declared" ? (
                        <span>{t(locale, "principlesYourWords")}</span>
                      ) : null}
                      {principle.citedSignals.length > 0 ? (
                        <span>
                          {principle.citedSignals.length}{" "}
                          {t(locale, "principlesSignalsBehind")}
                        </span>
                      ) : null}
                      {principle.heldSince ? (
                        <span>
                          {t(locale, "principlesSince")} {whenShort(principle.heldSince)}
                        </span>
                      ) : principle.state === "aspirational" ? (
                        <span>{t(locale, "principlesAwaiting")}</span>
                      ) : null}
                      {principle.state === "contested" ? (
                        <span className="pr-tension">
                          {t(locale, "principlesInTension")} —{" "}
                          {t(locale, "principlesRankDecides")}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <span className="pr-actions">
                    <button
                      type="button"
                      className="pr-action"
                      disabled={index === 0}
                      aria-label={t(locale, "principlesMoveUp")}
                      onClick={() => movePrinciple(principle, -1)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="pr-action"
                      disabled={index === principlesList.length - 1}
                      aria-label={t(locale, "principlesMoveDown")}
                      onClick={() => movePrinciple(principle, 1)}
                    >
                      ↓
                    </button>
                    {principle.state !== "contested" ? (
                      <button
                        type="button"
                        className="pr-action"
                        onClick={() => disputePrincipleRow(principle)}
                      >
                        {t(locale, "principlesDispute")}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="pr-action is-destructive"
                      onClick={() => removePrinciple(principle)}
                    >
                      {t(locale, "principlesRemove")}
                    </button>
                  </span>
                </li>
              ))}
            </ol>

            <div className="pr-declare">
              <input
                className="pr-declare-input"
                type="text"
                value={declareDraft}
                placeholder={t(locale, "principlesDeclarePlaceholder")}
                disabled={declaring}
                onChange={(event) => setDeclareDraft(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") declare();
                }}
              />
              {declareDraft.trim() || declaring ? (
                <button
                  type="button"
                  className="pr-action"
                  disabled={declaring}
                  onClick={declare}
                >
                  {declaring ? t(locale, "principlesDeclaring") : t(locale, "principlesDeclare")}
                </button>
              ) : null}
            </div>
          </div>
        </section>

        {/* ----------------------------------------------------------- ROOMS */}
        {/*
          The walls a few profiles keep together. Doors, then two quiet ways
          in: name a new room, or arrive with a code someone gave you.
        */}
        {/* THE OTHER HANDS, AND THE SHAPE OF A MIND (meeting, 2026-08-17).
            Agents are managed here — their names, their standing keys — and
            each one's door opens onto the graph of what it has come to hold.
            The graph also serves the person's own mind at /graph. */}
        <section className={`sf-layer sf-layer--agents${view === "agents" ? " on" : ""}`}>
          <AgentsScreen
            locale={locale}
            active={view === "agents"}
            onBack={() => navigateSurface("wall")}
            onSeeMind={(profileId) => navigateSurface("graph", { entityId: profileId })}
          />
        </section>
        <section className={`sf-layer sf-layer--graph${view === "graph" ? " on" : ""}`}>
          <GraphScreen
            locale={locale}
            active={view === "graph"}
            profileId={route.view === "graph" ? route.entityId : null}
            onBack={() => navigateSurface("agents")}
          />
        </section>
        <section className={`sf-layer sf-layer--rooms${view === "rooms" ? " on" : ""}`}>
          <div className="sf-column">
            <button type="button" className="sf-back" onClick={() => navigateSurface("wall")}>
              ← back
            </button>
            <div className="pr-head">
              <div>
                <div className="pr-eyebrow">{t(locale, "roomsEyebrow")}</div>
                <h2 className="pr-title">{t(locale, "roomsTitle")}</h2>
              </div>
              <div className="pr-meta-right">
                {groupsLoading ? "…" : groupsList.length}
              </div>
            </div>
            {groupsLoaded && !groupsLoading && groupsList.length === 0 ? (
              <p className="pr-empty">{t(locale, "roomsEmpty")}</p>
            ) : null}
            <div className="gr-list">
              {groupsList.map((group) => (
                <button
                  key={group.id}
                  type="button"
                  className="gr-door"
                  onClick={() => navigateSurface("room", { entityId: group.id })}
                >
                  <span className="gr-door-name">{group.name}</span>
                  <span className="gr-door-meta">
                    {formatMessage(locale, "roomsMembers", { n: group.memberCount })}
                  </span>
                </button>
              ))}
            </div>
            <div className="gr-new">
              <input
                type="text"
                className="gr-input"
                value={roomNameDraft}
                placeholder={t(locale, "roomsCreatePlaceholder")}
                disabled={roomBusy}
                onChange={(event) => setRoomNameDraft(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") createRoom();
                }}
              />
              {roomNameDraft.trim() ? (
                <button
                  type="button"
                  className="pr-action"
                  disabled={roomBusy}
                  onClick={createRoom}
                >
                  {t(locale, "roomsCreate")}
                </button>
              ) : null}
            </div>
            <div className="gr-new">
              <input
                type="text"
                className="gr-input"
                value={joinCodeDraft}
                placeholder={t(locale, "roomsJoinPlaceholder")}
                disabled={roomBusy}
                onChange={(event) => setJoinCodeDraft(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") joinRoom();
                }}
              />
              {joinCodeDraft.trim() ? (
                <button
                  type="button"
                  className="pr-action"
                  disabled={roomBusy}
                  onClick={joinRoom}
                >
                  {t(locale, "roomsJoin")}
                </button>
              ) : null}
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------------ ROOM */}
        {/*
          One room. The reading is the group's own post-its; editing one does
          not save — it PROPOSES, because a change to what a group says about
          itself is not something one person makes alone. Below the board:
          open proposals, the wall of shared signals, and the one act that
          crosses the boundary — putting up a signal of yours.
        */}
        <section className={`sf-layer sf-layer--room${view === "room" ? " on" : ""}`}>
          <div className="sf-column">
            <button type="button" className="sf-back" onClick={() => navigateSurface("rooms")}>
              ← back
            </button>
            {room ? (
              <>
                <header className="gr-head">
                  <h2 className="gr-name">{room.name}</h2>
                  <p className="gr-meta">
                    <span>
                      {formatMessage(locale, "roomsMembers", { n: room.memberCount })}
                      {roomMembers.length > 0
                        ? ` — ${roomMembers.map((member) => member.name).join(", ")}`
                        : ""}
                    </span>
                    {/* The code is how the next person gets in, so every
                        member can read it off the wall. */}
                    <span className="gr-code">
                      {t(locale, "roomCode")} · {room.joinCode}
                    </span>
                  </p>
                  <p className="sf-lastread">
                    <span>
                      {roomTom?.topOfMind
                        ? `read ${whenShort(roomTom.topOfMind.createdAt)} · v${roomTom.topOfMind.version}`
                        : roomLoading
                          ? "…"
                          : t(locale, "roomNotReadYet")}
                    </span>
                    <button
                      type="button"
                      className={`sf-reread${roomRereading ? " spinning" : ""}`}
                      onClick={rereadRoom}
                      disabled={roomRereading || roomLoading}
                      title={t(locale, "roomReadAgain")}
                      aria-label={t(locale, "roomReadAgain")}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                        <path d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1" />
                        <path d="M20.5 3.5v4.6h-4.6" />
                      </svg>
                    </button>
                  </p>
                </header>

                {roomLoading ? <p className="sf-empty">reading…</p> : null}
                {!roomLoading && (roomTom?.entries ?? []).length === 0 ? (
                  <p className="sf-empty">{t(locale, "roomBoardEmpty")}</p>
                ) : null}
                <div className="sf-wall">
                  {(roomTom?.entries ?? []).map((entry, i) => {
                    const layout = NOTE_LAYOUTS[i % NOTE_LAYOUTS.length]!;
                    const paper = NOTE_COLORS[i % NOTE_COLORS.length]!;
                    const draftBody = roomEntryDrafts[entry.id] ?? entry.body;
                    const changed =
                      draftBody.trim() !== "" && draftBody.trim() !== entry.body;
                    return (
                      <article
                        key={entry.id}
                        className="sf-postit"
                        style={{
                          ["--bg" as string]: paper.hue,
                          ["--ink" as string]: paper.ink,
                          ["--tilt" as string]: `${layout.tilt}deg`,
                          ["--w" as string]: layout.w,
                        }}
                      >
                        <textarea
                          className="sf-postit-text"
                          value={draftBody}
                          rows={1}
                          spellCheck
                          aria-label="this entry — edit to propose a change"
                          onChange={(event) =>
                            setRoomEntryDrafts((current) => ({
                              ...current,
                              [entry.id]: event.target.value,
                            }))
                          }
                        />
                        {entry.prompt ? <p className="sf-question">{entry.prompt}</p> : null}
                        <footer>
                          <span className="sf-provenance">
                            {entry.type}
                            {entry.contributors.length > 0
                              ? ` · ${t(locale, "roomFrom")} ${entry.contributors
                                  .map((c) => c.name)
                                  .join(", ")}`
                              : ""}
                          </span>
                          <span className="sf-postit-acts">
                            {changed ? (
                              <button
                                type="button"
                                className="gr-propose"
                                onClick={() => {
                                  proposeRoomChange({
                                    kind: "edit_entry",
                                    entryId: entry.id,
                                    body: draftBody.trim(),
                                  });
                                  setRoomEntryDrafts((current) => ({
                                    ...current,
                                    [entry.id]: entry.body,
                                  }));
                                }}
                              >
                                {t(locale, "roomProposeWording")}
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="sf-act"
                                title={t(locale, "roomProposeTakeDown")}
                                aria-label={t(locale, "roomProposeTakeDown")}
                                onClick={() =>
                                  proposeRoomChange({ kind: "remove_entry", entryId: entry.id })
                                }
                              >
                                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                                  <path d="M4 7h16" />
                                  <path d="M10 11v6" />
                                  <path d="M14 11v6" />
                                  <path d="M6.5 7 7.4 20h9.2l.9-13" />
                                  <path d="M9 7V4.8h6V7" />
                                </svg>
                              </button>
                            )}
                          </span>
                        </footer>
                      </article>
                    );
                  })}
                </div>

                <div className="gr-new">
                  <input
                    type="text"
                    className="gr-input"
                    value={roomProposeDraft}
                    placeholder={t(locale, "roomProposeAddPlaceholder")}
                    onChange={(event) => setRoomProposeDraft(event.currentTarget.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && roomProposeDraft.trim()) {
                        proposeRoomChange({ kind: "add_entry", body: roomProposeDraft.trim() });
                        setRoomProposeDraft("");
                      }
                    }}
                  />
                  {roomProposeDraft.trim() ? (
                    <button
                      type="button"
                      className="pr-action"
                      onClick={() => {
                        proposeRoomChange({ kind: "add_entry", body: roomProposeDraft.trim() });
                        setRoomProposeDraft("");
                      }}
                    >
                      {t(locale, "roomPropose")}
                    </button>
                  ) : null}
                </div>

                {roomProposals.some((proposal) => proposal.status === "open") ? (
                  <div className="gr-block">
                    <div className="gr-block-head">{t(locale, "roomProposalsHead")}</div>
                    {roomProposals
                      .filter((proposal) => proposal.status === "open")
                      .map((proposal) => (
                        <div key={proposal.id} className="gr-proposal">
                          <p className="gr-proposal-body">
                            <span className="gr-kind">
                              {t(
                                locale,
                                proposal.kind === "edit_entry"
                                  ? "roomKindEdit"
                                  : proposal.kind === "add_entry"
                                    ? "roomKindAdd"
                                    : "roomKindRemove",
                              )}
                            </span>
                            {proposal.body ? ` — ${proposal.body}` : ""}
                          </p>
                          <p className="gr-proposal-meta">
                            {t(locale, "roomBy")} {proposal.proposedByName}
                            {proposal.stances.some((a) => a.value === "affirmed")
                              ? ` · ${proposal.stances
                                  .filter((a) => a.value === "affirmed")
                                  .map((a) => a.name)
                                  .join(", ")}`
                              : ""}
                          </p>
                          <div className="gr-proposal-acts">
                            {proposal.viewerStance === "affirmed" ? (
                              <span className="gr-affirmed">{t(locale, "roomAffirmed")}</span>
                            ) : (
                              <button
                                type="button"
                                className="gr-propose"
                                onClick={() => affirmRoomProposal(proposal)}
                              >
                                {t(locale, "roomAffirm")}
                              </button>
                            )}
                            {proposal.viewerStance === "declined" ? null : (
                              <button
                                type="button"
                                className="gr-quiet"
                                onClick={() => declineRoomProposal(proposal)}
                              >
                                {t(locale, "roomDecline")}
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                  </div>
                ) : null}

                <div className="gr-block">
                  <div className="gr-block-head">{t(locale, "roomSharedHead")}</div>
                  {!roomLoading && roomWall.length === 0 ? (
                    <p className="sf-empty">{t(locale, "roomSharedEmpty")}</p>
                  ) : null}
                  {roomWall.map((row) => (
                    <div key={row.signalId} className="gr-shared">
                      <p className="gr-shared-statement">{row.statement}</p>
                      <span className="sf-provenance">
                        {/* a room-grown statement stands on named voices —
                            the contributors — and the room's own confidence
                            band; there is no owner and no take-down verb any
                            more (a room statement is retired by the room's
                            own lifecycle, not by one member) */}
                        {row.contributors.map((c) => c.name).join(" · ")} ·{" "}
                        {t(locale, confidenceBandKey(row.confidenceAsWritten))}
                      </span>
                    </div>
                  ))}
                  {/* No verb here any more. Statements are not handed to a
                      room; the room grows them from what its members keep
                      publicly, and says so rather than offering a control
                      that would write a row nothing reads. */}
                  {!roomLoading ? (
                    <p className="sf-empty">{t(locale, "roomGrows")}</p>
                  ) : null}
                </div>

                <button type="button" className="gr-leave" onClick={leaveOrCloseRoom}>
                  {t(locale, room.role === "owner" ? "roomClose" : "roomLeave")}
                </button>
              </>
            ) : null}
          </div>
        </section>

        {/* --------------------------------------------------------- ARCHIVE */}
        <section className={`sf-layer sf-layer--archive${view === "archive" ? " on" : ""}`}>
          <div className="sf-column">
            <button type="button" className="sf-back" onClick={() => navigateSurface("wall")}>
              ← back
            </button>
            <p className="sf-question">What were you circling?</p>
            <input
              ref={askInputRef}
              className="sf-field"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              aria-label="What were you circling?"
            />
            <div className="sf-label">
              {query.trim() ? `${results.length} of what you have kept` : "most recent"}
            </div>
            <div className="sf-results">
              {searching ? <p className="sf-empty">looking…</p> : null}
              {!searching && results.length === 0 ? (
                <p className="sf-empty">
                  {query.trim()
                    ? "Nothing you have kept matches that."
                    : "Nothing kept yet."}
                </p>
              ) : null}
              {results.map((inspiration) => (
                <div key={inspiration.id} className="sf-result">
                  <button
                    type="button"
                    className="sf-result-open"
                    onClick={() =>
                      navigateSurface("inspiration", { entityId: inspiration.id })
                    }
                  >
                    <p>{inspiration.textPreview}</p>
                    <span>
                      {whenShort(inspiration.createdAt)}
                      {inspiration.source === "agent" ? " · from an agent" : ""}
                      {inspiration.attachmentSummary.length > 0
                        ? ` · ${inspiration.attachmentSummary.length} attached`
                        : ""}
                      {/* The second beat, marked. Texture, not a todo: an
                          unreflected capture is still a capture. */}
                      {inspiration.reflectionCount > 0 ? (
                        <span className="sf-beat" title="you have sat with this one" />
                      ) : null}
                    </span>
                  </button>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ----------------------------------------------------- INSPIRATION */}
        <section
          className={`sf-layer sf-layer--inspiration${view === "inspiration" ? " on" : ""}`}
        >
          <div className="sf-column">
            <button
              type="button"
              className="sf-back"
              onClick={() => navigateSurface("archive")}
            >
              ← back
            </button>
            {detailLoading ? <p className="sf-empty">opening…</p> : null}
            {!detailLoading && detail ? (
              <>
                <div className="sf-savetext">
                  {paragraphs(detail.text).map((block, index) => (
                    <p key={index} className="sf-prose">
                      {block}
                    </p>
                  ))}
                </div>
                <p className="sf-savemeta">
                  {whenShort(detail.createdAt)}
                  {detail.source === "agent" ? " · captured by an agent" : ""}
                </p>
                {detail.attachments.length > 0 ? (
                  <ul className="sf-attached">
                    {detail.attachments.map((attachment) => (
                      <li key={attachment.id}>
                        {attachment.url ? (
                          <a href={attachment.url} target="_blank" rel="noreferrer">
                            {attachment.enrichment.link?.title ??
                              attachment.name ??
                              attachment.url}
                          </a>
                        ) : (
                          <span>{attachment.name ?? attachment.type}</span>
                        )}
                        {/* Machine-derived context, labelled as such. It is
                            what the page said, never what the person said. */}
                        {attachment.enrichment.link?.description ? (
                          <span className="sf-shared-excerpt">
                            {attachment.enrichment.link.description}
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}

                <div className="sf-reflect">
                  <div className="sf-label">why this caught you</div>
                  {detail.reflections.map((reflection) => (
                    <div key={reflection.id} className="sf-reflect-past">
                      <p className="sf-reflect-q">{reflection.question}</p>
                      <p className="sf-reflect-a">
                        {reflection.skipped ? "passed" : (reflection.answer ?? "")}
                      </p>
                      <button
                        type="button"
                        className="sf-remove"
                        onClick={() => removeReflection(reflection.id)}
                      >
                        remove
                      </button>
                    </div>
                  ))}
                  <input
                    className="sf-field"
                    value={reflectionQuestion}
                    placeholder="a question"
                    aria-label="a question"
                    onChange={(event) => setReflectionQuestion(event.currentTarget.value)}
                  />
                  <textarea
                    className="sf-reflect-field"
                    value={reflectionAnswer}
                    placeholder="your answer"
                    aria-label="your answer"
                    onChange={(event) => setReflectionAnswer(event.currentTarget.value)}
                  />
                  <div className="sf-reflect-foot">
                    <button
                      type="button"
                      className="sf-control"
                      onClick={addReflection}
                      disabled={!reflectionQuestion.trim()}
                    >
                      keep this too
                    </button>
                  </div>
                </div>

                <div className="sf-save-foot">
                  <button type="button" className="sf-remove" onClick={removeInspiration}>
                    delete this capture
                  </button>
                </div>
              </>
            ) : null}
            {!detailLoading && !detail ? (
              <p className="sf-empty">That capture is not here.</p>
            ) : null}
          </div>
        </section>

        {/* --------------------------------------------------------- CAPTURE */}
        <section className={`sf-layer sf-layer--capture${view === "capture" ? " on" : ""}`}>
          <div className="sf-column">
            <textarea
              ref={draftRef}
              className="sf-draft"
              value={draft}
              placeholder="What caught you?"
              onChange={(event) => {
                setDraft(event.currentTarget.value);
                // Typing again means moving on: the confirmation line belongs
                // to the capture before this one.
                setKept(null);
              }}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") keep();
              }}
              aria-label="What caught you?"
            />
            {/* What is coming with it. Filenames as text under the draft, not
                preview cards — the words are the capture; these are its
                luggage. */}
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
                className="sf-control sf-control--primary"
                onClick={keep}
                disabled={(!draft.trim() && files.length === 0) || keeping}
              >
                <Check className="sf-control-icon" aria-hidden="true" />
                {keeping ? "keeping…" : "keep"}
              </button>
              <button
                type="button"
                className="sf-control"
                onClick={() => fileInput.current?.click()}
              >
                <Paperclip className="sf-control-icon" aria-hidden="true" />
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
              <span className="sf-shortcut">⌘↵</span>
            </div>
            {kept ? <p className="sf-kept">{kept}</p> : null}
          </div>
        </section>
      </div>

      <nav className="sf-foot">
        <div className="sf-verbs">
          {/* THE WAY BACK, AND IT WAS MISSING.
              These routes are a parking lot: the world is where the product
              is, and these hold the few things not yet designed into it. The
              `≡` menu used to be the door — and, because it opened from the
              world, it was also the way home. Removing it took both.

              Measured 2026-08-24 on the running build: the world has ZERO
              links into any of these routes, and this footer had none back.
              Land here from a bookmark, an old link, or the terminal flow and
              the only exits were the browser's own back button and the URL
              bar. Six surfaces you could arrive at and not leave.

              First in the row and set apart, because it is the one word here
              that LEAVES rather than switching a view — everything after it
              is a door within this surface. */}
          <button
            type="button"
            className="sf-primary-verb sf-verb-world"
            onClick={() => navigate("/")}
          >
            ← the world
          </button>
          {takenDown ? (
            <button type="button" className="sf-undo" onClick={putEntryBack}>
              took it down · put it back
            </button>
          ) : null}
          <button
            type="button"
            className={`sf-primary-verb${view === "capture" ? " on" : ""}`}
            aria-pressed={view === "capture"}
            onClick={() =>
              navigateSurface(view === "capture" ? "wall" : "capture", {
                replace: view === "capture",
              })
            }
          >
            ＋ capture
            {draft.trim() && view !== "capture" ? (
              /* Something is still in the box. */
              <span className="sf-dot" aria-label="you have an unfinished capture" />
            ) : null}
          </button>
          <button
            type="button"
            className={`sf-primary-verb${view === "archive" || view === "inspiration" ? " on" : ""}`}
            aria-pressed={view === "archive" || view === "inspiration"}
            onClick={() =>
              navigateSurface(view === "archive" ? "wall" : "archive", {
                replace: view === "archive",
              })
            }
          >
            {/* Until the count lands, no number at all rather than a
                placeholder that looks like a count of nothing. */}
            {savedCount === null
              ? "inspirations"
              : `${savedCount}${savedCount >= ARCHIVE_LIMIT ? "+" : ""} inspirations`}
          </button>
          <button
            type="button"
            className={`sf-primary-verb${view === "signals" ? " on" : ""}`}
            aria-pressed={view === "signals"}
            onClick={() =>
              navigateSurface(view === "signals" ? "wall" : "signals", {
                replace: view === "signals",
              })
            }
          >
            signals
          </button>
          <button
            type="button"
            className={`sf-primary-verb${view === "wall" ? " on" : ""}`}
            aria-pressed={view === "wall"}
            aria-label="your top of mind"
            onClick={() => navigateSurface("wall")}
          >
            top of mind
          </button>
          {/* The other walls: rooms kept with other people. Sibling of
              "top of mind" because they are the same kind of thing — boards
              read from signals — held by more than one profile. */}
          <button
            type="button"
            className={`sf-primary-verb${view === "rooms" || view === "room" ? " on" : ""}`}
            aria-pressed={view === "rooms" || view === "room"}
            onClick={() =>
              navigateSurface(view === "rooms" ? "wall" : "rooms", {
                replace: view === "rooms",
              })
            }
          >
            {t(locale, "roomsVerb")}
          </button>
          {/* Always present, even at zero — the empty view is what teaches
              what a principle is, and a door that appears out of nowhere
              reads as a bug, not a reward. (Owner decision, 2026-08-21;
              replaces the earlier progressive-disclosure behavior.) */}
          <button
            type="button"
            className={`sf-primary-verb${view === "agents" || view === "graph" ? " on" : ""}`}
            aria-pressed={view === "agents" || view === "graph"}
            onClick={() =>
              navigateSurface(view === "agents" ? "wall" : "agents", {
                replace: view === "agents",
              })
            }
          >
            {t(locale, "agentsVerb")}
          </button>
          <button
            type="button"
            className={`sf-primary-verb${view === "principles" ? " on" : ""}`}
            aria-pressed={view === "principles"}
            onClick={() =>
              navigateSurface(view === "principles" ? "wall" : "principles", {
                replace: view === "principles",
              })
            }
          >
            {t(locale, "principlesVerb")}
          </button>
        </div>

        {/*
          Everything on the right edge sits in one group, so your face is at
          the edge of the page whatever else is beside it.
        */}
        <div className="sf-foot-end">
          <details className="sf-you">
            <summary aria-label="you">
              <span
                className="sf-face"
                style={{ background: contributorColor(profile?.name ?? "you") }}
              >
                {contributorInitials(profile?.name ?? "you")}
              </span>
            </summary>
            <div className="sf-you-menu">
              <a href="/profile">your profile</a>
              {/* The language switcher left with the second language (founder
                  ruling, 2026-08-22: the product speaks English only). */}
            </div>
          </details>
        </div>
      </nav>
    </div>
  );
}
