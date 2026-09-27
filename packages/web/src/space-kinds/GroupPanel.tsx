/**
 * A GROUP'S OWN PANEL: what it decided, what it is deciding, and who is here.
 *
 * Opened by tapping a group's wall. This is the surface where a group's
 * artifact can be read against the proposal that would replace it, where a
 * member agrees or disagrees, and where the invite lives — the three things a
 * group does that a person's own wall has no equivalent of.
 *
 * It sits beside `group.ts` in `space-kinds/` for the same reason that file
 * does: the subject is a KIND of space, and everything specific to groups
 * belongs together rather than scattered through a page that also draws
 * agents and your own wall.
 */
import type {
  ApiGroupMember,
  ApiGroupProposal,
  ApiGroupTimeline,
} from "../lib/api";
import { useOptionalAuth } from "../lib/auth-context";
import { formatMessage, normalizeSupportedLocale, t } from "../lib/locales";
import type { MessageKey } from "../lib/locales";
import { dateWords, givenName } from "../lib/words";
import { groupHistoryEvents } from "./group-history";
import type { GroupHistoryStop } from "./group-history";
import { GroupMoment } from "./GroupMoment";
import type { Space } from "./index";

export interface GroupPanelProps {
  /** the group whose panel this is */
  groupId: string;
  /** the wall you are standing on — the panel names it */
  space: Space;
  members: Map<string, ApiGroupMember[]>;
  /** every group's open proposals, keyed by group id */
  openProposals: Map<string, ApiGroupProposal[]>;
  /** the room's own becoming — version chain and door marks; null until it arrives */
  timeline: ApiGroupTimeline | null;
  /** The date the viewer wound this room to, if any. */
  selectedStop: GroupHistoryStop | null;
  proposalState: "loading" | "ready" | "failed";
  onRetryProposals: () => void;
  pendingProposalId: string | null;
  receipt: string | null;
  trouble: string | null;
  /** the draft a member is writing, and whether it is in flight */
  propose: { text: string; busy: boolean } | null;
  setPropose: React.Dispatch<React.SetStateAction<{ text: string; busy: boolean } | null>>;
  sendProposal: (groupId: string) => void;
  answerProposal: (groupId: string, id: string, yes: boolean) => void;
  onClose: () => void;
}

export function GroupPanel(props: GroupPanelProps): JSX.Element {
  const {
    groupId: groupPanel,
    space: atWall,
    members,
    openProposals,
    timeline,
    selectedStop,
    proposalState,
    onRetryProposals,
    pendingProposalId,
    receipt,
    trouble,
    propose,
    setPropose,
    sendProposal,
    answerProposal,
    onClose,
  } = props;
  const locale = normalizeSupportedLocale(useOptionalAuth()?.profile?.preferredLocale);
  const say = (key: MessageKey) => t(locale, key);

  return (
<div className="jar-roomform jar-roomform--group" data-jar-chrome="1">
  <div className="jar-group-panel-heading">
    <p className="jar-label">{selectedStop ? atWall.name : say("worldShapeTogether")}</p>
    <button type="button" onClick={onClose}>{say("worldClose")}</button>
  </div>
  {timeline && selectedStop ? <GroupMoment
    groupId={groupPanel} timeline={timeline} stop={selectedStop} locale={locale}
  /> : null}

  {!selectedStop ? <>
    <p className="jar-room-shape-note">{say("worldRoomProposalHow")}</p>
    {proposalState === "loading" ? <p className="jar-was" role="status">{say("worldRoomProposalsLoading")}</p> : null}
    {proposalState === "failed" ? <p className="jar-was" role="alert">
      {say("worldRoomProposalsFailed")}{" "}
      <button type="button" onClick={onRetryProposals}>{say("worldRoomHistoryRetry")}</button>
    </p> : null}
    {receipt ? <p className="jar-was" role="status">{receipt}</p> : null}
    {trouble ? <p className="jar-settings-warn" role="alert">{trouble}</p> : null}

  {/* WHAT IS BEING ASKED OF THIS ROOM. Each one is somebody's sentence
      waiting on the rest of you — read it, say yes or say no, and the
      board moves when the room agrees rather than when you press. */}
  {proposalState === "ready" ? (openProposals.get(groupPanel) ?? []).map((p) => (
    <div key={p.id} className="jar-proposal">
      {/* WHOSE SENTENCE THIS IS. A proposal is somebody asking the room to
          believe a thing — reading it without knowing who is asking is
          reading a petition with the signature torn off. */}
      <p className="jar-label">
        {formatMessage(locale, "worldPutThisToRoom", {
          name: p.proposedByName ? givenName(p.proposedByName) : say("worldSomeoneWord"),
        })}
      </p>
      <p className="jar-proposal-body">{p.body}</p>
      {/* THE WHOLE ROOM, NOT THE PART THAT AGREED.
          This listed only the people who had affirmed, which reads as
          a growing list with no end — you could not tell whether one
          more was needed or three. A proposal carries on a MAJORITY,
          so the useful thing is the room itself: everyone in it, those
          who agreed at full strength, those who said no in the layout's
          dimmest ink and struck through — still there, because a
          recorded no is an answer, not an absence (the counted-stance
          ruling) — and those who have not answered dimmed beside them.

          Still no tally. The count is legible because the PEOPLE are,
          which is the only way this layout is allowed to say a number —
          and you can see at a glance whether the missing one is you. */}
      <p className="jar-proposal-who jar-label">
        {(members.get(groupPanel) ?? []).map((m, i) => {
          const said =
            p.stances.find((a) => a.profileId === m.profileId)?.value ?? null;
          return (
            <span
              key={m.profileId}
              className={
                said === "affirmed"
                  ? "jar-said"
                  : said === "declined"
                    ? "jar-said-no"
                    : "jar-not-said"
              }
              title={
                said === "affirmed"
                  ? say("worldAgreedTitle")
                  : said === "declined"
                    ? say("worldSaidNotUsTitle")
                    : say("worldNotAnsweredTitle")
              }
            >
              {i > 0 ? " · " : ""}
              {givenName(m.name)}
            </span>
          );
        })}
      </p>
      {/* AN ANSWER IS NOT A DOOR THAT LOCKS BEHIND YOU. While the question
          is open, either answer shows itself and offers the other — changing
          your mind is answering again, and the record keeps only the latest. */}
      {p.viewerStance === "affirmed" ? (
        <p className="jar-ask">
          <span>{say("worldYouAgreed")}</span>
          <span aria-hidden="true"> · </span>
          <button type="button" disabled={pendingProposalId === p.id} onClick={() => answerProposal(groupPanel, p.id, false)}>
            {say("worldNotUsAfterAll")}
          </button>
        </p>
      ) : p.viewerStance === "declined" ? (
        <p className="jar-ask">
          <span>{say("worldYouSaidNotUs")}</span>
          <span aria-hidden="true"> · </span>
          <button type="button" disabled={pendingProposalId === p.id} onClick={() => answerProposal(groupPanel, p.id, true)}>
            {say("worldYesUsAfterAll")}
          </button>
        </p>
      ) : (
        <p className="jar-ask">
          <button type="button" disabled={pendingProposalId === p.id} onClick={() => answerProposal(groupPanel, p.id, true)}>
            {say("worldYesThatIsUs")}
          </button>
          <span aria-hidden="true"> · </span>
          <button type="button" disabled={pendingProposalId === p.id} onClick={() => answerProposal(groupPanel, p.id, false)}>
            {say("worldNotUs")}
          </button>
          <span aria-hidden="true"> · </span>
          {/* THE COUNTER. Saying no kills the sentence; saying it differently
              keeps the conversation — the proposal's words arrive in your
              draft box to be reshaped and put back to the room as your own. */}
          <button
            type="button"
            onClick={() => setPropose({ text: p.body ?? "", busy: false })}
          >
            {say("worldSayItDifferently")}
          </button>
        </p>
      )}
    </div>
  )) : null}

  {/* PUT SOMETHING TO THEM. A room's board is proposed to and
      affirmed, never edited — one member rewriting what a group
      believes would be editing other people's minds. */}
  {proposalState !== "ready" ? null : propose ? (
    <div className="jar-reflect" style={{ marginTop: 14 }}>
      <textarea
        className="jar-reflect-box"
        rows={3}
        autoFocus
        placeholder={say("worldProposePlaceholder")}
        value={propose.text}
        onChange={(e) => setPropose({ ...propose, text: e.target.value })}
      />
      <p className="jar-ask">
        <button type="button" className="jar-room-primary" disabled={propose.busy || propose.text.trim() === ""}
          onClick={() => sendProposal(groupPanel)}>
          {propose.busy ? "…" : say("worldPutItToThem")}
        </button>
        <span aria-hidden="true"> · </span>
        <button type="button" onClick={() => setPropose(null)}>
          {say("worldNotNow")}
        </button>
      </p>
    </div>
  ) : (
    <p className="jar-ask">
      <button type="button" className="jar-room-primary" onClick={() => setPropose({ text: "", busy: false })}>
        {say("worldPutSomethingToRoom")}
      </button>
    </p>
  )}
  {proposalState === "ready" && timeline &&
  (timeline.versions.length > 0 || timeline.doorMarks.length > 0) ? (
    <div className="jar-prov" style={{ marginTop: 14 }}>
      <p className="jar-prov-lead jar-label">{say("worldRoomSoFar")}</p>
      {groupHistoryEvents(timeline, locale).slice(0, 10).map((event) => (
        <p key={event.key} className="jar-was">
          {event.line}{" · "}{dateWords(event.at, Date.now(), locale)}
        </p>
      ))}
    </div>
  ) : null}
  </> : null}
</div>
  );
}
