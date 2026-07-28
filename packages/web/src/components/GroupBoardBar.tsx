/**
 * Board switcher for the Top of Mind wall (US-052).
 *
 * Renders a quiet row of boards — "Mine" plus one pill per group the user
 * belongs to — with inline affordances to create a new group and to join one by
 * code. When a group board is active it surfaces the shareable join link so the
 * owner can invite others.
 *
 * The component is presentational: it owns only transient form state. Creating,
 * joining, and selecting are delegated to the parent so Home stays the single
 * source of truth for board data.
 */

import { useState } from "react";

import type { ApiGroupSummary } from "../lib/api";

export const MINE_BOARD_ID = "mine";

export interface GroupBoardBarProps {
  boards: ApiGroupSummary[];
  activeBoard: string;
  onSelect: (board: string) => void;
  onCreateGroup: (name: string) => Promise<void>;
  onJoinGroup: (code: string) => Promise<void>;
  onRefresh?: () => Promise<void> | void;
  refreshing?: boolean;
  loading?: boolean;
  error?: string | null;
}

function joinLinkFor(code: string): string {
  if (typeof window === "undefined") return `?join=${code}`;
  return `${window.location.origin}/?join=${encodeURIComponent(code)}`;
}

export function GroupBoardBar({
  boards,
  activeBoard,
  onSelect,
  onCreateGroup,
  onJoinGroup,
  onRefresh,
  refreshing = false,
  loading = false,
  error = null,
}: GroupBoardBarProps): JSX.Element {
  const [openForm, setOpenForm] = useState<null | "create" | "join">(null);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const activeGroup = boards.find((b) => b.id === activeBoard) ?? null;

  const submitCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      await onCreateGroup(trimmed);
      setName("");
      setOpenForm(null);
    } finally {
      setBusy(false);
    }
  };

  const submitJoin = async () => {
    const trimmed = code.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      await onJoinGroup(trimmed);
      setCode("");
      setOpenForm(null);
    } finally {
      setBusy(false);
    }
  };

  const copyLink = async () => {
    if (!activeGroup) return;
    const link = joinLinkFor(activeGroup.joinCode);
    try {
      await navigator.clipboard?.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard blocked (e.g. insecure context): leave the link visible so
      // the user can copy it manually.
      setCopied(false);
    }
  };

  return (
    <nav className="nc-board-switcher" aria-label="Top of Mind boards">
      <div className="nc-board-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={activeBoard === MINE_BOARD_ID}
          className={`nc-board-tab${activeBoard === MINE_BOARD_ID ? " nc-board-tab--active" : ""}`}
          onClick={() => onSelect(MINE_BOARD_ID)}
        >
          Mine
        </button>
        {boards.map((board) => (
          <button
            key={board.id}
            type="button"
            role="tab"
            aria-selected={activeBoard === board.id}
            className={`nc-board-tab${activeBoard === board.id ? " nc-board-tab--active" : ""}`}
            onClick={() => onSelect(board.id)}
            title={`${board.memberCount} member${board.memberCount === 1 ? "" : "s"}`}
          >
            {board.name}
            <span className="nc-board-tab-count">{board.memberCount}</span>
          </button>
        ))}
        <button
          type="button"
          className="nc-board-tab nc-board-tab--ghost"
          onClick={() => setOpenForm((f) => (f === "create" ? null : "create"))}
          aria-expanded={openForm === "create"}
        >
          ＋ New
        </button>
        <button
          type="button"
          className="nc-board-tab nc-board-tab--ghost"
          onClick={() => setOpenForm((f) => (f === "join" ? null : "join"))}
          aria-expanded={openForm === "join"}
        >
          Join
        </button>
      </div>

      {loading ? <span className="nc-board-hint">Loading boards…</span> : null}
      {error ? <span className="nc-board-hint nc-board-hint--error">{error}</span> : null}

      {openForm === "create" ? (
        <form
          className="nc-board-form"
          onSubmit={(e) => {
            e.preventDefault();
            void submitCreate();
          }}
        >
          <input
            className="nc-board-input"
            placeholder="Name your group"
            aria-label="Group name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            maxLength={120}
          />
          <button type="submit" className="nc-board-go" disabled={busy || !name.trim()}>
            Create
          </button>
        </form>
      ) : null}

      {openForm === "join" ? (
        <form
          className="nc-board-form"
          onSubmit={(e) => {
            e.preventDefault();
            void submitJoin();
          }}
        >
          <input
            className="nc-board-input"
            placeholder="Paste a join code or link"
            aria-label="Join code"
            value={code}
            onChange={(e) => setCode(extractJoinCode(e.target.value))}
            autoFocus
            maxLength={200}
          />
          <button type="submit" className="nc-board-go" disabled={busy || !code.trim()}>
            Join
          </button>
        </form>
      ) : null}

      {activeGroup ? (
        <div className="nc-board-share">
          <span className="nc-board-share-label">Invite to “{activeGroup.name}”:</span>
          <code className="nc-board-share-code">{joinLinkFor(activeGroup.joinCode)}</code>
          <button type="button" className="nc-board-go" onClick={() => void copyLink()}>
            {copied ? "Copied" : "Copy"}
          </button>
          {onRefresh ? (
            <button
              type="button"
              className="nc-board-tab nc-board-tab--ghost"
              onClick={() => void onRefresh()}
              disabled={refreshing}
              title="Re-synthesize this board from everyone's shared inspirations"
            >
              {refreshing ? "Synthesizing…" : "↻ Refresh"}
            </button>
          ) : null}
        </div>
      ) : null}
    </nav>
  );
}

/**
 * Accept either a bare code or a full `?join=CODE` link and return the code.
 * Exported for reuse by the URL auto-join path.
 */
export function extractJoinCode(raw: string): string {
  const value = raw.trim();
  const match = value.match(/[?&]join=([^&\s]+)/i);
  if (match) return decodeURIComponent(match[1]!);
  return value;
}
