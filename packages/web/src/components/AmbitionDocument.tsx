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

import type {
  ApiGroupDirection,
  ApiGroupDirectionResponseValue,
} from "../lib/api";
import { contributorColor, contributorInitials } from "./faces";

function settledOn(iso: string): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "";
  return then.toLocaleDateString(undefined, { month: "long", day: "numeric" });
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
        </>
      ) : (
        <p className="ad-forming">
          Still forming — the room's first ambition arrives once enough hearts
          have shaped it.
        </p>
      )}

      {/* ② the voices */}
      <div className="ad-margin">
        {voices.map((voice) => (
          <div key={voice.id} className="ad-voice">
            <span
              className="ad-voice-dot"
              style={{ background: contributorColor(voice.memberName) }}
              title={voice.memberName}
            />
            <span className="ad-voice-name">{voice.memberName}</span>
            <span className="ad-voice-body">{voice.body}</span>
          </div>
        ))}
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
        {current?.evidence?.length ? (
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
