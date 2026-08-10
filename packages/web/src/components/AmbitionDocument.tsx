/**
 * The ambition's own space, reduced: one screen, three layers, one action.
 *
 * 1. THE STATEMENT — the adopted ambition, large and alone. No page title,
 *    no explainer: the door you came through already named this place.
 * 2. THE VOICES — the margin. Attributed lines under the statement, oldest
 *    first, a member's hue on each. One composer: "say how this sits with
 *    you…". Nobody edits the wording — the room steers, WAKA writes.
 * 3. THE ONE ACTION — state-dependent, never plural. No open proposal:
 *    ask WAKA for a new version (the half-the-room rule lives inside the
 *    disabled state, not as a progress meter). Proposal open: the page
 *    becomes the decision — candidate beside current, adopt or keep.
 *
 * Everything else folds into two quiet doors at the foot: past versions,
 * and the pulses the current version is grounded in.
 *
 * This is a re-skin of the existing direction machinery (contributions,
 * one-open-proposal, accept/keep-current responses) — slice B1 of the
 * two-modes goal. It adds no API surface; threads and attach-a-pull are B2.
 */

import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";

import {
  setGroupDirectionAffirmation,
  setGroupDirectionTakeSupport,
  type ApiGroupDirection,
  type ApiGroupDirectionFace,
  type ApiGroupDirectionPulseProfile,
  type ApiGroupDirectionResponseValue,
} from "../lib/api";
import { useAuth } from "../lib/auth-context";
import { parseSurfacePath } from "../lib/surface-route";
import { contributorColor, contributorInitials } from "./faces";

function settledOn(iso: string): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "";
  return then.toLocaleDateString(undefined, { month: "long", day: "numeric" });
}

function dayOf(iso: string): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "";
  return then.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** "formed from pulses between June 12 and August 3" — dates, never counts. */
export function formedSpanCopy(start: string | null, end: string | null): string | null {
  if (!start || !end) return null;
  const from = settledOn(start);
  const to = settledOn(end);
  if (!from || !to) return null;
  if (from === to) return `formed from pulses on ${from}`;
  return `formed from pulses between ${from} and ${to}`;
}

/**
 * The manifesto as data: how much of this was a quickened pulse versus a
 * composed thought. Says nothing when the mix is unknown or unremarkable.
 */
export function pulseProfileCopy(profile: ApiGroupDirectionPulseProfile | null): string | null {
  if (!profile) return null;
  const known = profile.reactionCount + profile.compositionCount;
  if (known === 0) return null;
  if (profile.reactionCount >= known * 0.65) return "mostly quickened pulses — saved before thinking";
  if (profile.compositionCount >= known * 0.65) return "mostly composed — written slowly, on purpose";
  return "part quickened pulse, part composition";
}

/** The disabled ask-button explains itself; nothing else counts anything. */
export function askCopy(input: {
  contributorCount: number;
  requiredContributors: number;
  asking: boolean;
}): { label: string; note: string | null; ready: boolean } {
  if (input.asking) return { label: "WAKA is reading…", note: null, ready: false };
  const missing = Math.max(0, input.requiredContributors - input.contributorCount);
  if (missing > 0) {
    return {
      label: "Ask WAKA for a new version",
      note: `needs ${missing} more voice${missing === 1 ? "" : "s"} first`,
      ready: false,
    };
  }
  return { label: "Ask WAKA for a new version", note: null, ready: true };
}

export function AmbitionDocument(props: {
  direction: ApiGroupDirection | null;
  draft: string;
  saving: boolean;
  reviewing: boolean;
  asking: boolean;
  onDraft: (value: string) => void;
  onSubmitVoice: () => void;
  onReview: (value: ApiGroupDirectionResponseValue) => void;
  onAskNewVersion: () => void;
}) {
  const { direction, draft, saving, reviewing, asking } = props;
  const [openPullId, setOpenPullId] = useState<string | null>(null);
  /*
    The acts live here, not in Surface: this component knows which room it
    stands in from the URL and who is looking from the session, and keeps a
    thin overlay of act results over the direction it was handed — so
    pressing never waits for a full refetch, and a fresh fetch resets the
    overlay.
  */
  const { user } = useAuth();
  const roomId = parseSurfacePath(useLocation().pathname).roomId;
  const [press, setPress] = useState<
    { affirmations: ApiGroupDirectionFace[]; viewerAffirmed: boolean } | null
  >(null);
  const [supportsByTake, setSupportsByTake] = useState<
    Record<string, ApiGroupDirectionFace[]>
  >({});
  const [actBusy, setActBusy] = useState(false);
  useEffect(() => {
    setPress(null);
    setSupportsByTake({});
  }, [direction]);

  const current = direction?.current ?? null;
  const proposal = direction?.proposal ?? null;
  /* Oldest first: the margin reads as the room's conversation, not a feed. */
  const voices = [...(direction?.contributions ?? [])].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );

  const ask = askCopy({
    contributorCount: direction?.contributorCount ?? 0,
    requiredContributors: direction?.requiredContributors ?? 0,
    asking,
  });

  return (
    <div className="ad">
      {/* ① the statement */}
      {current ? (
        <>
          <p className="ad-statement">{current.ambition}</p>
          <p className="ad-meta">
            v{current.versionNumber} · settled {settledOn(current.createdAt)}
          </p>
          {(() => {
            const affirmations = press?.affirmations ?? current.affirmations;
            const viewerAffirmed = press?.viewerAffirmed ?? direction?.viewerAffirmed ?? false;
            return (
              <div className="ad-press">
                {affirmations.length > 0 ? (
                  <span className="sf-faces">
                    {affirmations.map((face) => (
                      <span
                        key={face.userId}
                        className="sf-face"
                        style={{ background: contributorColor(face.memberName) }}
                        title={`holds for ${face.memberName}`}
                      >
                        {contributorInitials(face.memberName)}
                      </span>
                    ))}
                  </span>
                ) : null}
                {roomId ? (
                  <button
                    type="button"
                    disabled={actBusy}
                    aria-pressed={viewerAffirmed}
                    onClick={() => {
                      if (!roomId || actBusy) return;
                      setActBusy(true);
                      setGroupDirectionAffirmation(roomId, current.id, !viewerAffirmed)
                        .then((result) => setPress(result))
                        .catch(() => undefined)
                        .finally(() => setActBusy(false));
                    }}
                  >
                    {viewerAffirmed ? "take it back" : "holds for me — this is me too"}
                  </button>
                ) : null}
              </div>
            );
          })()}
          {current.tension ? <p className="ad-tension">{current.tension}</p> : null}
        </>
      ) : (
        <p className="ad-forming">
          Still forming — the room's first ambition arrives once enough hearts
          have shaped it.
        </p>
      )}

      {/* ①b — how it formed: the lineage, one disclosure level per layer.
          The pulls are always visible (the things themselves, never counts);
          each unfolds into its own pulses; a pulse links to nothing yet —
          the save view is a later door. */}
      {current &&
      (current.groundedNotes.length > 0 ||
        formedSpanCopy(current.evidenceSpanStart, current.evidenceSpanEnd) ||
        pulseProfileCopy(current.pulseProfile)) ? (
        <div className="ad-formed">
          <p className="ad-formed-label">formed from</p>
          {current.groundedNotes.map((pull) => {
            const open = openPullId === pull.id;
            const hands = Array.from(new Set(pull.pulses.map((pulse) => pulse.memberName)));
            return (
              <div key={pull.id} className="ad-pull">
                <button
                  type="button"
                  className="ad-pull-line"
                  aria-expanded={open}
                  onClick={() => setOpenPullId(open ? null : pull.id)}
                >
                  <span className="ad-pull-mark" aria-hidden="true">{open ? "▾" : "▸"}</span>
                  <span className="ad-pull-text">{pull.text}</span>
                  <span className="sf-faces">
                    {hands.map((name) => (
                      <span
                        key={name}
                        className="sf-face"
                        style={{ background: contributorColor(name) }}
                      >
                        {contributorInitials(name)}
                      </span>
                    ))}
                  </span>
                </button>
                {open ? (
                  <ul className="ad-pulses">
                    {pull.pulses.map((pulse) => (
                      <li key={`${pull.id}-${pulse.signalId}`}>
                        <span
                          className="ad-voice-dot"
                          style={{ background: contributorColor(pulse.memberName) }}
                          title={pulse.memberName}
                        />
                        <span className="ad-pulse-quote">“{pulse.textPreview}”</span>
                        <span className="ad-pulse-when">{dayOf(pulse.createdAt)}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            );
          })}
          {(() => {
            const span = formedSpanCopy(current.evidenceSpanStart, current.evidenceSpanEnd);
            const profile = pulseProfileCopy(current.pulseProfile);
            const line = [span, profile].filter(Boolean).join(" · ");
            return line ? <p className="ad-formed-meta">{line}</p> : null;
          })()}
          {direction?.newInspirationCount ? (
            <p className="ad-formed-meta">
              {direction.newInspirationCount} new pulse
              {direction.newInspirationCount === 1 ? "" : "s"} since this settled
            </p>
          ) : null}
        </div>
      ) : null}

      {/* ② the voices */}
      <div className="ad-margin">
        {voices.map((voice) => {
          const supporters = supportsByTake[voice.id] ?? voice.supporters;
          const standing = Boolean(user && supporters.some((face) => face.userId === user.id));
          const own = user?.id === voice.userId;
          return (
            <div key={voice.id} className="ad-voice">
              <span
                className="ad-voice-dot"
                style={{ background: contributorColor(voice.memberName) }}
                title={voice.memberName}
              />
              <span className="ad-voice-name">{voice.memberName}</span>
              <span className="ad-voice-body">{voice.body}</span>
              {supporters.length > 0 ? (
                <span className="sf-faces ad-voice-supporters" title="standing behind this">
                  {supporters.map((face) => (
                    <span
                      key={face.userId}
                      className="sf-face"
                      style={{ background: contributorColor(face.memberName) }}
                    >
                      {contributorInitials(face.memberName)}
                    </span>
                  ))}
                </span>
              ) : null}
              {!own && roomId ? (
                <button
                  type="button"
                  className="ad-voice-act"
                  disabled={actBusy}
                  onClick={() => {
                    if (!roomId || actBusy) return;
                    setActBusy(true);
                    setGroupDirectionTakeSupport(roomId, voice.id, !standing)
                      .then((result) =>
                        setSupportsByTake((currentMap) => ({
                          ...currentMap,
                          [voice.id]: result.supporters,
                        })),
                      )
                      .catch(() => undefined)
                      .finally(() => setActBusy(false));
                  }}
                >
                  {standing ? "step back" : "stand behind"}
                </button>
              ) : null}
            </div>
          );
        })}
        <form
          className="ad-composer"
          onSubmit={(event) => {
            event.preventDefault();
            props.onSubmitVoice();
          }}
        >
          <input
            type="text"
            value={draft}
            placeholder="say how this sits with you…"
            aria-label="say how this ambition sits with you"
            onChange={(event) => props.onDraft(event.target.value)}
            disabled={saving}
          />
          {draft.trim() ? (
            <button type="submit" disabled={saving}>
              {saving ? "…" : "add your voice"}
            </button>
          ) : null}
        </form>
      </div>

      {/* ③ the one action */}
      {proposal ? (
        <div className="ad-decision" role="group" aria-label="a possible next version">
          <p className="ad-decision-label">a possible next version</p>
          <p className="ad-candidate">{proposal.ambition}</p>
          {proposal.changeSummary ? (
            <p className="ad-change">{proposal.changeSummary}</p>
          ) : null}
          <div className="ad-decision-acts">
            <button
              type="button"
              className={direction?.viewerResponse === "accept" ? "on" : ""}
              disabled={reviewing}
              onClick={() => props.onReview("accept")}
            >
              adopt this version
            </button>
            <button
              type="button"
              className={direction?.viewerResponse === "keep_current" ? "on" : ""}
              disabled={reviewing}
              onClick={() => props.onReview("keep_current")}
            >
              keep the current one
            </button>
          </div>
        </div>
      ) : (
        <div className="ad-ask">
          <button
            type="button"
            disabled={!ask.ready}
            onClick={props.onAskNewVersion}
          >
            {ask.label}
          </button>
          {ask.note ? <p className="ad-ask-note">{ask.note}</p> : null}
        </div>
      )}

      {/* the foot: two quiet doors */}
      <div className="ad-foot">
        {direction?.history?.length ? (
          <details>
            <summary>past versions</summary>
            <ol className="ad-history">
              {direction.history.map((version) => (
                <li key={version.id}>
                  <span className="ad-history-v">v{version.versionNumber}</span>
                  <span className="ad-history-when">{settledOn(version.createdAt)}</span>
                  <span className="ad-history-what">
                    {version.changeSummary ??
                      (version.versionNumber === 1 ? "First ambition" : version.ambition)}
                  </span>
                </li>
              ))}
            </ol>
          </details>
        ) : null}
        {current?.evidence?.length && current.groundedNotes.length === 0 ? (
          /* Older readings may predate grounded-note linkage; the flat
             quotes remain their only lineage. */
          <details>
            <summary>
              grounded in {current.evidence.length} pulse
              {current.evidence.length === 1 ? "" : "s"}
            </summary>
            <ul className="ad-evidence">
              {current.evidence.map((item) => (
                <li key={`${item.signalId}-${item.quote}`}>
                  <span
                    className="sf-face"
                    style={{ background: contributorColor(item.memberName) }}
                  >
                    {contributorInitials(item.memberName)}
                  </span>
                  <span className="ad-evidence-quote">“{item.quote || item.textPreview}”</span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
    </div>
  );
}
