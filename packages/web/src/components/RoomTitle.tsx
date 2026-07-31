/**
 * The room's title, which is also how you change rooms.
 *
 * Replaces the board rail. A wall previously stated which room you were in
 * four times over — a title, a row of faces, a row of names, and a highlighted
 * pill in a rail — and put room-scoped actions (invite, refresh) beside
 * rooms-scoped ones (new, join) as though they were peers. They are not: one
 * acts on the room you are in, the other on the set of rooms you have.
 *
 * So identity is stated once, and the two scopes separate by depth rather than
 * by position. The title names the room and opens the list of rooms. The cast
 * shows who is here and is also how you invite someone, because inviting is
 * adding a face to it.
 *
 * Your own wall is a room with one member. Treating it as a special case is
 * what made switching jump: "Mine" had no cast, so everything below moved when
 * you left it.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";

import type { ApiGroupSummary } from "../lib/api";

export const MINE_BOARD_ID = "__mine__";

export interface RoomMember {
  userId: string;
  name: string;
}

export interface RoomTitleProps {
  /** Rendered name of the current room. Your own wall styles part of it. */
  title: ReactNode;
  /** Every room you can move to, yours included. */
  rooms: ApiGroupSummary[];
  activeRoom: string;
  onSelect: (room: string) => void;
  /** Who is in this room. One entry on your own wall: you. */
  members: RoomMember[];
  currentUserId?: string;
  /** Invite link for the active room, when it is a group. */
  inviteLink?: string | null;
  onCreateRoom: (name: string) => Promise<void>;
  onJoinRoom: (code: string) => Promise<void>;
  onRefresh?: () => Promise<void> | void;
  refreshing?: boolean;
  faceColor: (name: string) => string;
  faceInitials: (name: string) => string;
  /** Surfaced quietly rather than dropped: rooms failing to load is worth saying. */
  error?: string | null;
}

type OpenPanel = null | "rooms" | "invite";

export function RoomTitle({
  title,
  rooms,
  activeRoom,
  onSelect,
  members,
  currentUserId,
  inviteLink,
  onCreateRoom,
  onJoinRoom,
  onRefresh,
  refreshing,
  faceColor,
  faceInitials,
  error,
}: RoomTitleProps): JSX.Element {
  const [open, setOpen] = useState<OpenPanel>(null);
  const [entry, setEntry] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Anything opened from the title closes on outside click or Escape, so the
  // wall is never left wearing a panel the user has moved on from.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(null);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  /**
   * One field for both. Telling "make a room" from "join a room" is the
   * product's problem, not the user's: two unlabelled inputs stacked in a
   * panel read as a rendering fault, and asking which mode you meant before
   * you have typed anything is a question nobody needs.
   */
  const submitEntry = async () => {
    const trimmed = entry.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      if (looksLikeInvite(trimmed)) {
        await onJoinRoom(extractJoinCode(trimmed));
      } else {
        await onCreateRoom(trimmed);
      }
      setEntry("");
      setOpen(null);
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard refusal is not worth interrupting anyone over */
    }
  };

  return (
    <div className="nc-room" ref={rootRef}>
      <button
        type="button"
        className="nc-room-title"
        onClick={() => setOpen((p) => (p === "rooms" ? null : "rooms"))}
        aria-expanded={open === "rooms"}
        aria-haspopup="menu"
      >
        <span className="nc-room-title-text">{title}</span>
        <span className="nc-room-caret" aria-hidden="true">
          ⌄
        </span>
      </button>

      {/* The cast, and the way to add to it. Inviting is adding a face here,
          so it lives here rather than beside the list of rooms. */}
      <div className="nc-room-cast">
        <span className="nc-note-faces" aria-hidden="true">
          {members.map((member) => (
            <span
              key={member.userId}
              className={`nc-note-face nc-room-face${
                member.userId === currentUserId ? " nc-room-face--me" : ""
              }`}
              style={{ background: faceColor(member.name) }}
              title={member.name}
            >
              {faceInitials(member.name)}
            </span>
          ))}
        </span>
        {inviteLink ? (
          <button
            type="button"
            className="nc-room-invite"
            onClick={() => setOpen((p) => (p === "invite" ? null : "invite"))}
            aria-expanded={open === "invite"}
            aria-label="invite someone to this room"
            title="Invite someone"
          >
            ＋
          </button>
        ) : null}
      </div>

      {open === "rooms" ? (
        <div className="nc-room-panel" role="menu">
          {error ? <p className="nc-room-error">{error}</p> : null}
          {rooms.map((room) => (
            <button
              key={room.id}
              type="button"
              role="menuitem"
              className={`nc-room-item${room.id === activeRoom ? " nc-room-item--active" : ""}`}
              onClick={() => {
                onSelect(room.id);
                setOpen(null);
              }}
            >
              <span className="nc-room-item-name">{room.name}</span>
              {room.memberCount > 1 ? (
                <span className="nc-room-item-count">{room.memberCount}</span>
              ) : null}
            </button>
          ))}

          <form
            className="nc-room-new"
            onSubmit={(event) => {
              event.preventDefault();
              void submitEntry();
            }}
          >
            {/* Naming it is the whole act of making one, so the field is the
                control: no separate button, no second row, no mode to pick. */}
            <input
              className="nc-room-new-input"
              value={entry}
              onChange={(event) => setEntry(event.target.value)}
              placeholder="name a room, or paste an invite…"
              maxLength={200}
              disabled={busy}
              aria-label="name a room, or paste an invite"
            />
          </form>
        </div>
      ) : null}

      {open === "invite" && inviteLink ? (
        <div className="nc-room-panel nc-room-panel--invite">
          <code className="nc-room-invite-link">{inviteLink}</code>
          <button type="button" className="nc-room-invite-copy" onClick={() => void copy()}>
            {copied ? "copied" : "copy link"}
          </button>
          {onRefresh ? (
            <button
              type="button"
              className="nc-room-refresh"
              onClick={() => void onRefresh()}
              disabled={refreshing}
              title="Re-read everyone's signals together"
            >
              {refreshing ? "reading…" : "re-read this room"}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Does this look like an invitation rather than a name?
 *
 * Deliberately conservative: a full join link, or a single bare token that
 * looks like a code. Anything with a space is a name, because room names have
 * spaces and codes do not. Guessing wrong toward "create" is recoverable --
 * you get a room you did not want and can leave it -- while guessing wrong
 * toward "join" fails loudly against a code that does not exist.
 */
export function looksLikeInvite(raw: string): boolean {
  const trimmed = raw.trim();
  if (/[?&]join=/i.test(trimmed)) return true;
  if (/\s/.test(trimmed)) return false;
  return /^[A-Z0-9-]{6,32}$/i.test(trimmed);
}

/** Accept either a bare code or a full `?join=CODE` link and return the code. */
export function extractJoinCode(raw: string): string {
  const trimmed = raw.trim();
  const match = trimmed.match(/[?&]join=([^&\s]+)/i);
  if (match?.[1]) {
    try {
      return decodeURIComponent(match[1]);
    } catch {
      return match[1];
    }
  }
  return trimmed;
}
