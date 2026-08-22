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
import type { ApiGroupMember, ApiGroupProposal, ApiGroupSummary } from "../lib/api";
import { givenName } from "../lib/words";
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
  <p className="jar-neb-ask" style={{ marginTop: 14 }}>
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
        {givenName(p.proposedByName)}
        {" put this to the room"}
      </p>
      <p className="jar-proposal-body">{p.body}</p>
      {/* THE WHOLE ROOM, NOT THE PART THAT AGREED.
          This listed only the people who had affirmed, which reads as
          a growing list with no end — you could not tell whether one
          more was needed or three. A proposal carries on a MAJORITY,
          so the useful thing is the room itself: everyone in it, those
          who agreed at full strength and those who have not yet dimmed
          beside them.

          Still no tally. The count is legible because the PEOPLE are,
          which is the only way this layout is allowed to say a number —
          and you can see at a glance whether the missing one is you. */}
      <p className="jar-proposal-who jar-label">
        {(members.get(groupPanel) ?? []).map((m, i) => {
          const said = p.affirmations.some((a) => a.profileId === m.profileId);
          return (
            <span
              key={m.profileId}
              className={said ? "jar-said" : "jar-not-said"}
              title={said ? "agreed" : "has not answered yet"}
            >
              {i > 0 ? " · " : ""}
              {givenName(m.name)}
            </span>
          );
        })}
      </p>
      {p.viewerAffirmed ? (
        <p className="jar-neb-ask">
          <span>you agreed</span>
        </p>
      ) : (
        <p className="jar-neb-ask">
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
      <p className="jar-neb-ask">
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
    <p className="jar-neb-ask">
      <button type="button" onClick={() => setPropose({ text: "", busy: false })}>
        put something to this group
      </button>
    </p>
  )}

  <p className="jar-neb-ask jar-neb-ask--after">
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
  <p className="jar-neb-ask" style={{ marginTop: 10 }}>
    <button type="button" onClick={() => setGroupPanel(null)}>
      close
    </button>
  </p>
</div>
  );
}
