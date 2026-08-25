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
  ApiGroupSummary,
  ApiGroupTimeline,
} from "../lib/api";
import { dateWords, givenName } from "../lib/words";
import type { Space } from "./index";

export interface GroupPanelProps {
  /** the group whose panel this is */
  groupId: string;
  /** the wall you are standing on — the panel names it */
  space: Space;
  groups: ApiGroupSummary[];
  members: Map<string, ApiGroupMember[]>;
  /** every group's open proposals, keyed by group id */
  openProposals: Map<string, ApiGroupProposal[]>;
  /** the room's own becoming — version chain and door marks; null until it arrives */
  timeline: ApiGroupTimeline | null;
  /** the draft a member is writing, and whether it is in flight */
  propose: { text: string; busy: boolean } | null;
  setPropose: React.Dispatch<React.SetStateAction<{ text: string; busy: boolean } | null>>;
  sendProposal: (groupId: string) => void;
  answerProposal: (groupId: string, id: string, yes: boolean) => void;
  copied: string | null;
  copyInvite: (group: ApiGroupSummary) => void;
  /** leaving is armed here and in the settings panel, and disarmed by the
      page's own request handler — see SpaceSettings for why it lives above */
  leaving: string | null;
  setLeaving: (groupId: string | null) => void;
  leaveThisGroup: (groupId: string) => void;
  onClose: () => void;
}

export function GroupPanel(props: GroupPanelProps): JSX.Element {
  const {
    groupId: groupPanel,
    space: atWall,
    groups,
    members,
    openProposals,
    timeline,
    propose,
    setPropose,
    sendProposal,
    answerProposal,
    copied,
    copyInvite,
    leaving,
    setLeaving,
    leaveThisGroup,
    onClose,
  } = props;
  const setGroupPanel = (_: string | null) => onClose();

  return (
<div className="jar-roomform" data-jar-chrome="1">
  <div className="jar-label" style={{ marginBottom: 14 }}>
    {atWall.name}
  </div>
  <div className="jar-share">
    {(members.get(groupPanel) ?? []).map((m) => (
      <span key={m.profileId} className="jar-share-row">
        {m.name}
        {m.role === "owner" ? <span className="jar-share-hint">made it</span> : null}
      </span>
    ))}
  </div>
  <p className="jar-ask" style={{ marginTop: 14 }}>
    <button
      type="button"
      onClick={() => {
        const g = groups.find((x) => x.id === groupPanel);
        if (g) copyInvite(g);
      }}
    >
      {copied === groupPanel ? "link copied" : "copy the invite link"}
    </button>
  </p>

  {/* WHAT IS BEING ASKED OF THIS ROOM. Each one is somebody's sentence
      waiting on the rest of you — read it, say yes or say no, and the
      board moves when the room agrees rather than when you press. */}
  {(openProposals.get(groupPanel) ?? []).map((p) => (
    <div key={p.id} className="jar-proposal">
      {/* WHOSE SENTENCE THIS IS. A proposal is somebody asking the room to
          believe a thing — reading it without knowing who is asking is
          reading a petition with the signature torn off. */}
      <p className="jar-label">
        {p.proposedByName ? givenName(p.proposedByName) : "someone"}
        {" put this to the room"}
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
                  ? "agreed"
                  : said === "declined"
                    ? "said not us"
                    : "has not answered yet"
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
          <span>you agreed</span>
          <span aria-hidden="true"> · </span>
          <button type="button" onClick={() => answerProposal(groupPanel, p.id, false)}>
            not us after all
          </button>
        </p>
      ) : p.viewerStance === "declined" ? (
        <p className="jar-ask">
          <span>you said not us</span>
          <span aria-hidden="true"> · </span>
          <button type="button" onClick={() => answerProposal(groupPanel, p.id, true)}>
            yes, that is us after all
          </button>
        </p>
      ) : (
        <p className="jar-ask">
          <button type="button" onClick={() => answerProposal(groupPanel, p.id, true)}>
            yes, that is us
          </button>
          <span aria-hidden="true"> · </span>
          <button type="button" onClick={() => answerProposal(groupPanel, p.id, false)}>
            not us
          </button>
          <span aria-hidden="true"> · </span>
          {/* THE COUNTER. Saying no kills the sentence; saying it differently
              keeps the conversation — the proposal's words arrive in your
              draft box to be reshaped and put back to the room as your own. */}
          <button
            type="button"
            onClick={() => setPropose({ text: p.body ?? "", busy: false })}
          >
            say it differently
          </button>
        </p>
      )}
    </div>
  ))}

  {/* THE ROOM SO FAR. The artifact's chain and the door's marks, told as
      one story, newest first: every version the room's reading has moved
      through (the honest no_change passes stay off the surface — a pass
      where nothing moved is not an event in the room's life), and every
      arrival and departure, named. Dates arrive as words, reasons as
      sentences — the timeline keeps the numerals law by construction. */}
  {timeline &&
  (timeline.versions.length > 0 || timeline.doorMarks.length > 0) ? (
    <div className="jar-prov" style={{ marginTop: 14 }}>
      <p className="jar-prov-lead jar-label">the room so far</p>
      {[
        ...timeline.versions
          .filter((v) => v.reason !== "no_change")
          .map((v) => ({
            key: `v:${v.id}`,
            at: Date.parse(v.createdAt) || 0,
            line:
              v.reason === "initial"
                ? "the room first spoke"
                : v.reason === "member_proposal"
                  ? "a proposal carried"
                  : v.reason === "human_edit"
                    ? "a sentence was reworded"
                    : "the room re-read itself",
          })),
        ...timeline.doorMarks.map((m) => ({
          key: `d:${m.profileId ?? "departed"}:${m.kind}:${m.occurredAt}`,
          at: Date.parse(m.occurredAt) || 0,
          /* a mark whose person has since erased their account keeps its
             place in the story as "someone" — the name is what erasure
             removes, the fact that someone was here is the room's */
          line: `${m.name ? givenName(m.name) : "someone"} ${
            m.kind === "joined" ? "arrived" : m.kind === "left" ? "left" : "was removed"
          }`,
        })),
      ]
        .sort((a, b) => b.at - a.at)
        .slice(0, 10)
        .map((event) => (
          <p key={event.key} className="jar-was">
            {event.line}
            {" · "}
            {dateWords(event.at, Date.now())}
          </p>
        ))}
    </div>
  ) : null}

  {/* PUT SOMETHING TO THEM. A room's board is proposed to and
      affirmed, never edited — one member rewriting what a group
      believes would be editing other people's minds. */}
  {propose ? (
    <div className="jar-reflect" style={{ marginTop: 14 }}>
      <textarea
        className="jar-reflect-box"
        rows={3}
        autoFocus
        placeholder="What do you think this room believes?"
        value={propose.text}
        onChange={(e) => setPropose({ ...propose, text: e.target.value })}
      />
      <p className="jar-ask">
        <button type="button" disabled={propose.busy} onClick={() => sendProposal(groupPanel)}>
          {propose.busy ? "…" : "put it to them"}
        </button>
        <span aria-hidden="true"> · </span>
        <button type="button" onClick={() => setPropose(null)}>
          not now
        </button>
      </p>
    </div>
  ) : (
    <p className="jar-ask">
      <button type="button" onClick={() => setPropose({ text: "", busy: false })}>
        put something to this group
      </button>
    </p>
  )}

  <p className="jar-ask jar-ask--after">
    {leaving === groupPanel ? (
      <>
        <button type="button" onClick={() => leaveThisGroup(groupPanel)}>
          leave — your statements come down
        </button>
        <span aria-hidden="true"> · </span>
        <button type="button" onClick={() => setLeaving(null)}>
          stay
        </button>
      </>
    ) : (
      <button type="button" onClick={() => setLeaving(groupPanel)}>
        leave this group
      </button>
    )}
  </p>
  <p className="jar-ask" style={{ marginTop: 10 }}>
    <button type="button" onClick={() => setGroupPanel(null)}>
      close
    </button>
  </p>
</div>
  );
}
