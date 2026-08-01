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
import { extractJoinCode, looksLikeInvite } from "./rooms";

export const MINE_BOARD_ID = "__mine__";

export interface RoomMember {
  userId: string;
  name: string;
}

export interface RoomTitleProps {
  /** Rendered name of the current room. Your own wall styles part of it. */
  title: ReactNode;
  /** Who is in this room. One entry on your own wall: you. */
  members: RoomMember[];
  currentUserId?: string;
  /** Invite link for the active room, when it is a group. */
  inviteLink?: string | null;
  onRefresh?: () => Promise<void> | void;
  refreshing?: boolean;
  faceColor: (name: string) => string;
  faceInitials: (name: string) => string;
  /** Surfaced quietly rather than dropped: rooms failing to load is worth saying. */
  error?: string | null;
  /**
   * The room you are standing in, when it is a group. Settings act on this and
   * only this — the switcher stays a switcher.
   */
  activeRoomSummary?: ApiGroupSummary | null;
  /**
   * Making a room and joining one. Here rather than in the rail because the
   * rail is absent when you have nowhere to go — which is exactly when you
   * most need a way to make your first room.
   */
  onCreateRoom?: (name: string) => Promise<void>;
  onJoinRoom?: (code: string) => Promise<void>;
  onRenameRoom?: (roomId: string, name: string) => Promise<void>;
  onRemoveMember?: (roomId: string, memberUserId: string) => Promise<void>;
  /** Owner-only. Omit and the delete row does not render. */
  onDeleteRoom?: (roomId: string) => Promise<void>;
  /** For rooms you are in but do not own. */
  onLeaveRoom?: (roomId: string) => Promise<void>;
}

type OpenPanel = null | "invite" | "settings";

export function RoomTitle({
  title,
  members,
  currentUserId,
  inviteLink,
  onRefresh,
  refreshing,
  faceColor,
  faceInitials,
  error,
  activeRoomSummary,
  onCreateRoom,
  onJoinRoom,
  onRenameRoom,
  onRemoveMember,
  onDeleteRoom,
  onLeaveRoom,
}: RoomTitleProps): JSX.Element {
  const [open, setOpen] = useState<OpenPanel>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [entry, setEntry] = useState("");
  // Destroying the room asks a second time. Nothing else in settings does,
  // because nothing else is unrecoverable.
  const [confirmingDestroy, setConfirmingDestroy] = useState(false);
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

  const owns = activeRoomSummary?.role === "owner";

  const submitEntry = async () => {
    const trimmed = entry.trim();
    if (!trimmed) return;
    await run(async () => {
      if (looksLikeInvite(trimmed)) await onJoinRoom?.(extractJoinCode(trimmed));
      else await onCreateRoom?.(trimmed);
      setEntry("");
    });
  };

  const openSettings = () => {
    setNameDraft(activeRoomSummary?.name ?? "");
    setEntry("");
    setConfirmingDestroy(false);
    setOpen((p) => (p === "settings" ? null : "settings"));
  };

  /** Runs a settings action, keeping the panel open so errors stay in context. */
  const run = async (fn: () => Promise<void>, closeAfter = false) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      if (closeAfter) setOpen(null);
    } catch {
      // The caller surfaces the message above the panel.
    } finally {
      setBusy(false);
    }
  };

  const submitRename = async () => {
    const next = nameDraft.trim();
    if (!activeRoomSummary || !onRenameRoom || !next || next === activeRoomSummary.name) return;
    await run(() => onRenameRoom(activeRoomSummary.id, next));
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
      {/* A title, not a menu. Switching rooms is the rail's job now — it can
          say "there are other places" without being clicked, which is the one
          thing this could never do. */}
      <h1 className="nc-room-title">
        <span className="nc-room-title-text">{title}</span>
      </h1>

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
        {activeRoomSummary || onCreateRoom || onJoinRoom ? (
          <button
            type="button"
            className="nc-room-settings-open"
            onClick={openSettings}
            aria-expanded={open === "settings"}
            aria-label={activeRoomSummary ? "room settings" : "rooms"}
            title={activeRoomSummary ? "Room settings" : "Rooms"}
          >
            ⚙
          </button>
        ) : null}
      </div>

      {open === "settings" ? (
        /* Settings belong to the room you are in, not to the list of rooms:
           putting them in the switcher made every row carry a destructive
           control you had to pass over just to change rooms.

           Making a room is here too. It is the one thing you can need when
           there is no room to have settings for, so the panel opens on your
           own wall as well — with the field and nothing else. */
        <div
          className="nc-room-panel nc-room-settings"
          role="dialog"
          aria-label={activeRoomSummary ? "Room settings" : "Rooms"}
        >
          {error ? <p className="nc-room-error">{error}</p> : null}

          {activeRoomSummary ? (
          <>
          <label className="nc-room-settings-label" htmlFor="nc-room-name">
            Name
          </label>
          <form
            className="nc-room-settings-name"
            onSubmit={(event) => {
              event.preventDefault();
              void submitRename();
            }}
          >
            <input
              id="nc-room-name"
              className="nc-room-new-input"
              value={nameDraft}
              onChange={(event) => setNameDraft(event.target.value)}
              disabled={!owns || busy}
              maxLength={120}
            />
            {owns && nameDraft.trim() && nameDraft.trim() !== activeRoomSummary.name ? (
              <button type="submit" className="nc-room-settings-save" disabled={busy}>
                save
              </button>
            ) : null}
          </form>

          <p className="nc-room-settings-label">
            Members <span className="nc-room-item-count">{members.length}</span>
          </p>
          <ul className="nc-room-settings-members">
            {members.map((member) => (
              <li key={member.userId} className="nc-room-settings-member">
                <span
                  className="nc-note-face nc-room-face"
                  style={{ background: faceColor(member.name) }}
                  aria-hidden="true"
                >
                  {faceInitials(member.name)}
                </span>
                <span className="nc-room-settings-member-name">
                  {member.name}
                  {member.userId === currentUserId ? " (you)" : ""}
                </span>
                {owns && onRemoveMember && member.userId !== currentUserId ? (
                  <button
                    type="button"
                    className="nc-room-settings-remove"
                    disabled={busy}
                    aria-label={`Remove ${member.name}`}
                    onClick={() =>
                      void run(() => onRemoveMember(activeRoomSummary.id, member.userId))
                    }
                  >
                    remove
                  </button>
                ) : null}
              </li>
            ))}
          </ul>

          {inviteLink ? (
            <>
              <p className="nc-room-settings-label">Invite link</p>
              <div className="nc-room-settings-invite">
                <code className="nc-room-invite-link">{inviteLink}</code>
                <button type="button" className="nc-room-invite-copy" onClick={() => void copy()}>
                  {copied ? "copied" : "copy"}
                </button>
              </div>
            </>
          ) : null}

          </>
          ) : null}

          {onCreateRoom || onJoinRoom ? (
            <>
              <p className="nc-room-settings-label">
                {activeRoomSummary ? "Another room" : "Rooms"}
              </p>
              <form
                className="nc-room-settings-name"
                onSubmit={(event) => {
                  event.preventDefault();
                  void submitEntry();
                }}
              >
                {/* Still one field for both. Telling a name from a code is the
                    product's problem, not the user's. */}
                <input
                  className="nc-room-new-input"
                  value={entry}
                  onChange={(event) => setEntry(event.target.value)}
                  placeholder="name a room, or paste an invite…"
                  maxLength={200}
                  disabled={busy}
                />
              </form>
            </>
          ) : null}

          {/* The one irreversible thing here, kept apart and asked twice. */}
          {activeRoomSummary && ((owns && onDeleteRoom) || (!owns && onLeaveRoom)) ? (
            <div className="nc-room-settings-danger">
              {confirmingDestroy ? (
                <>
                  <span className="nc-room-settings-danger-q">
                    {owns ? "Delete this room for everyone?" : "Leave this room?"}
                  </span>
                  <button
                    type="button"
                    className="nc-room-item-confirm-yes"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () =>
                          owns
                            ? onDeleteRoom!(activeRoomSummary.id)
                            : onLeaveRoom!(activeRoomSummary.id),
                        true,
                      )
                    }
                  >
                    {owns ? "delete" : "leave"}
                  </button>
                  <button
                    type="button"
                    className="nc-room-item-confirm-no"
                    disabled={busy}
                    onClick={() => setConfirmingDestroy(false)}
                  >
                    cancel
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="nc-room-settings-danger-open"
                  onClick={() => setConfirmingDestroy(true)}
                >
                  {owns ? "Delete room" : "Leave room"}
                </button>
              )}
            </div>
          ) : null}
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
