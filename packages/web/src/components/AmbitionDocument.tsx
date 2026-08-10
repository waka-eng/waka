/**
 * The ambition's own space: one page, three depths.
 *
 * DEPTH 0 — the poster. The statement, one meta line (version + mode), and
 * the page's one primary act: the press, which is publish consent. Two quiet
 * doors beneath. Nothing else — this frame is the future public page,
 * rehearsing. When a draft is waiting, the room's one urgent decision
 * surfaces as a third line, because a pending decision outranks browsing.
 *
 * DEPTH 1a — "how this formed": the lineage (pulls → their pulses), the
 * span/profile sentence, past versions. Provenance on demand.
 *
 * DEPTH 1b — "takes": the working room. The unsettled prompt, the voices
 * with stand-behind, the composer, and the draft action — the act lives
 * beside the material it is written from. Opening one door closes the
 * other: one view holds one thing.
 *
 * A re-skin of the existing direction machinery (contributions,
 * one-open-proposal, accept/keep-current responses) plus the acts layer
 * (press, stand-behind). Nobody edits the wording — the room steers.
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

/**
 * A key ambition has two modes: DRAFT (the room collaborates) and PUBLIC
 * (unlocked when most of the room consents). The press is the consent act.
 * "Cleared" is the honest in-between: the room said go, the public page
 * arrives with the publish build.
 */
export function publicConsent(input: {
  agreedCount: number;
  requiredResponses: number;
}): { cleared: boolean; modeLabel: string } {
  const cleared =
    input.requiredResponses > 0 && input.agreedCount >= input.requiredResponses;
  return {
    cleared,
    modeLabel: cleared ? "cleared to go public" : "draft — room only",
  };
}

/**
 * The button explains itself in plain words — the stranger test. The
 * freshness fact lives here too, beside the act it motivates, instead of
 * as a floating line nobody could parse.
 */
export function askCopy(input: {
  contributorCount: number;
  requiredContributors: number;
  newPulseCount: number;
  asking: boolean;
}): { label: string; note: string | null; ready: boolean } {
  if (input.asking) return { label: "Writing a new draft…", note: null, ready: false };
  const missing = Math.max(0, input.requiredContributors - input.contributorCount);
  if (missing > 0) {
    return {
      label: "Draft a new version",
      note: `Drafts are written from takes — ${missing} more ${
        missing === 1 ? "person needs" : "people need"
      } to add one first.`,
      ready: false,
    };
  }
  const fresh =
    input.newPulseCount > 0
      ? input.newPulseCount === 1
        ? " and the 1 new pulse"
        : ` and the ${input.newPulseCount} new pulses`
      : "";
  return {
    label: "Draft a new version",
    note: `A fresh draft is written from everyone's takes${fresh} — the room approves it before anything changes.`,
    ready: true,
  };
}

type OpenSection = "formed" | "takes" | null;

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
  /* One door open at a time — one view holds one thing. */
  const [openSection, setOpenSection] = useState<OpenSection>(null);
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
  /* Oldest first: the takes read as the room's conversation, not a feed. */
  const voices = [...(direction?.contributions ?? [])].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );

  const ask = askCopy({
    contributorCount: direction?.contributorCount ?? 0,
    requiredContributors: direction?.requiredContributors ?? 0,
    newPulseCount: direction?.newInspirationCount ?? 0,
    asking,
  });

  const affirmations = press?.affirmations ?? current?.affirmations ?? [];
  const viewerAffirmed = press?.viewerAffirmed ?? direction?.viewerAffirmed ?? false;
  const consent = publicConsent({
    agreedCount: affirmations.length,
    requiredResponses: direction?.requiredResponses ?? 0,
  });

  const hasFormed = Boolean(
    current &&
      (current.groundedNotes.length > 0 ||
        formedSpanCopy(current.evidenceSpanStart, current.evidenceSpanEnd) ||
        pulseProfileCopy(current.pulseProfile) ||
        (current.evidence?.length ?? 0) > 0 ||
        (direction?.history?.length ?? 0) > 0),
  );

  const toggle = (section: Exclude<OpenSection, null>) =>
    setOpenSection((open) => (open === section ? null : section));

  return (
    <div className={`ad${openSection ? " ad--open" : ""}`}>
      {/* -------------------------------------------- depth 0: the poster */}
      <div className="ad-hero">
        {current ? (
          <>
            <p className="ad-statement">{current.ambition}</p>
            <p className="ad-meta">
              v{current.versionNumber} · adopted {settledOn(current.createdAt)} ·{" "}
              {consent.modeLabel}
            </p>
            <div className="ad-press">
              {affirmations.length > 0 ? (
                <span className="sf-faces">
                  {affirmations.map((face) => (
                    <span
                      key={face.userId}
                      className="sf-face"
                      style={{ background: contributorColor(face.memberName) }}
                      title={`${face.memberName} said go public`}
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
                    if (!roomId || actBusy || !current) return;
                    setActBusy(true);
                    setGroupDirectionAffirmation(roomId, current.id, !viewerAffirmed)
                      .then((result) => setPress(result))
                      .catch(() => undefined)
                      .finally(() => setActBusy(false));
                  }}
                >
                  {viewerAffirmed ? "You said go public — undo" : "Good to go public"}
                </button>
              ) : null}
              {/* Feedforward until the first face; after that, the faces
                  and the mode in the meta line say it. */}
              {affirmations.length === 0 ? (
                <span className="ad-press-why">goes public once most of the room says so</span>
              ) : consent.cleared ? (
                <span className="ad-press-why">most of the room agreed — the public page is next</span>
              ) : null}
            </div>
          </>
        ) : (
          <p className="ad-forming">
            Still forming — the room's first ambition arrives once enough hearts
            have shaped it.
          </p>
        )}
      </div>

      {/* A pending decision outranks browsing: the one urgent line. */}
      {proposal && openSection !== "takes" ? (
        <button type="button" className="ad-urgent" onClick={() => setOpenSection("takes")}>
          a new draft is waiting for the room — decide
        </button>
      ) : null}

      {/* the two doors */}
      {current ? (
        <div className="ad-doors">
          {hasFormed ? (
            <button
              type="button"
              aria-expanded={openSection === "formed"}
              onClick={() => toggle("formed")}
            >
              {openSection === "formed" ? "close" : "how this formed"}
            </button>
          ) : null}
          <button
            type="button"
            aria-expanded={openSection === "takes"}
            onClick={() => toggle("takes")}
          >
            {openSection === "takes"
              ? "close"
              : `takes${voices.length > 0 ? ` (${voices.length})` : ""}`}
          </button>
        </div>
      ) : null}

      {/* --------------------------------- depth 1a: how this formed */}
      {openSection === "formed" && current ? (
        <div className="ad-section">
          {current.groundedNotes.length > 0 ? (
            <div className="ad-formed">
              <p className="ad-formed-label">formed from</p>
              {current.groundedNotes.map((pull) => {
                const open = openPullId === pull.id;
                const hands = Array.from(
                  new Set(pull.pulses.map((pulse) => pulse.memberName)),
                );
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
            </div>
          ) : null}
          {current.evidence?.length && current.groundedNotes.length === 0 ? (
            /* Older readings may predate grounded-note linkage; the flat
               quotes remain their only lineage. */
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
          ) : null}
          {(() => {
            const span = formedSpanCopy(current.evidenceSpanStart, current.evidenceSpanEnd);
            const profile = pulseProfileCopy(current.pulseProfile);
            const line = [span, profile].filter(Boolean).join(" · ");
            return line ? <p className="ad-formed-meta">{line}</p> : null;
          })()}
          {direction?.history?.length ? (
            <div className="ad-history-block">
              <p className="ad-formed-label">past versions</p>
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
            </div>
          ) : null}
        </div>
      ) : null}

      {/* --------------------------------------- depth 1b: the takes */}
      {openSection === "takes" ? (
        <div className="ad-section">
          {current?.tension ? (
            <div className="ad-unsettled">
              <span className="ad-unsettled-label">not settled in this room yet</span>
              {current.tension}
            </div>
          ) : null}
          <div className="ad-margin">
            {voices.map((voice) => {
              const supporters = supportsByTake[voice.id] ?? voice.supporters;
              const standing = Boolean(
                user && supporters.some((face) => face.userId === user.id),
              );
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
                      title="add your face to this take — the next draft leans on what the room stands behind"
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
            <p className="ad-margin-why">
              Takes written here shape the next draft
              {current?.tension ? " — the unsettled line above is a good place to start" : ""}.
            </p>
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
                placeholder="Add your take — what should change, or what's right as is"
                aria-label="add your take on this ambition"
                onChange={(event) => props.onDraft(event.target.value)}
                disabled={saving}
              />
              {draft.trim() ? (
                <button type="submit" disabled={saving}>
                  {saving ? "…" : "add your take"}
                </button>
              ) : null}
            </form>
          </div>

          {/* the draft action lives beside the material it is written from */}
          {proposal ? (
            <div className="ad-decision" role="group" aria-label="a new draft for the room to decide">
              <p className="ad-decision-label">a new draft for the room to decide</p>
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
                  adopt this draft
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
              <button type="button" disabled={!ask.ready} onClick={props.onAskNewVersion}>
                {ask.label}
              </button>
              {ask.note ? <p className="ad-ask-note">{ask.note}</p> : null}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
