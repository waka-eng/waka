/**
 * WHAT THIS SPACE IS, AND EVERYTHING YOU CAN DO TO IT.
 *
 * Opened by the space's own name in the top left. One surface per kind: a
 * group gets its roll, its invite, and the three destructive verbs; your own
 * wall and an agent's get a sentence about what they hold and a door to the
 * account screen — because renaming yourself, changing your language and
 * ending sessions is flat work that wants focus traps and plain
 * confirmations, which in-layout UI cannot give. This does not reimplement
 * the account screen badly.
 *
 * WHY THE CONFIRMATIONS LIVE HERE.
 *
 * Leaving, renaming, removing someone and closing a group are each two-step:
 * a destructive word is never beside its own yes. That state — which of the
 * four is armed, and for which group — is read by nothing else in the world,
 * so it belongs to this component. Holding it in the page meant four more
 * `useState`s in a file that already had seventy, and four more things a
 * reader had to prove were unrelated to the simulation.
 */
import { Link } from "react-router-dom";

import type { ApiGroupMember, ApiGroupSummary } from "../../lib/api";
import type { Space } from "../../space-kinds";

export interface SpaceSettingsProps {
  /** the space whose settings these are — the one you are standing on */
  space: Space;
  /** every group's roll, keyed by group id */
  members: Map<string, ApiGroupMember[]>;
  /** the groups this account is in — the panel reads this one's name and code */
  groups: ApiGroupSummary[];
  /**
   * THE FOUR CONFIRMATIONS STAY ABOVE THIS PANEL, and that is not an oversight.
   *
   * Each is armed here and disarmed somewhere else: the page's own
   * `leaveThisGroup`, `closeThisGroup`, `removeMember` and `renameThisGroup`
   * clear their flag when the request lands, and the group panel arms
   * `leaving` too. Two readers and an async writer means one source of truth,
   * and it has to sit above both — so this is a pure move, and pretending
   * otherwise would have made the panel's own state disagree with the page's.
   */
  leaving: string | null;
  setLeaving: (groupId: string | null) => void;
  closing: string | null;
  setClosing: (groupId: string | null) => void;
  removing: string | null;
  setRemoving: (memberId: string | null) => void;
  renaming: { id: string; text: string; busy: boolean } | null;
  setRenaming: (next: { id: string; text: string; busy: boolean } | null) => void;
  /** who is reading, so the panel knows whether they own this group */
  viewerProfileId: string | null;
  /** the invite link's copied-just-now flash, which the page owns because the
      clipboard write is the page's */
  copied: string | null;
  copyInvite: (group: ApiGroupSummary) => void;
  onClose: () => void;
  leaveThisGroup: (groupId: string) => void;
  renameThisGroup: (groupId: string, name: string) => void;
  closeThisGroup: (groupId: string) => void;
  removeMember: (groupId: string, profileId: string) => void;
}

export function SpaceSettings({
  space: atWall,
  members,
  groups,
  leaving,
  setLeaving,
  closing,
  setClosing,
  removing,
  setRemoving,
  renaming,
  setRenaming,
  viewerProfileId,
  copied,
  copyInvite,
  onClose,
  leaveThisGroup,
  renameThisGroup,
  closeThisGroup,
  removeMember,
}: SpaceSettingsProps): JSX.Element {
  const auth = { profile: { id: viewerProfileId } };
  const setSettingsFor = (_: string | null) => onClose();

  return (
<div className="jar-settings" data-jar-chrome="1" role="dialog" aria-label="Space settings">
  <div className="jar-settings-head">
    <span className="jar-label">
      {atWall.kind === "group" ? "This room" : atWall.kind === "agent" ? "This agent" : "You"}
    </span>
    <button type="button" className="jar-settings-x" onClick={() => setSettingsFor(null)}>
      close
    </button>
  </div>

  {atWall.kind === "group" ? (
    (() => {
      const gid = atWall.id;
      const roll = members.get(gid) ?? [];
      const mine = roll.find((m) => m.profileId === auth?.profile?.id);
      const iOwnIt = mine?.role === "owner";
      return (
        <>
          {/* THE NAME. Owners can change it; everyone else reads it. */}
          {renaming?.id === gid ? (
            <form
              className="jar-settings-rename"
              onSubmit={(e) => {
                e.preventDefault();
                renameThisGroup(gid, renaming.text);
              }}
            >
              <input
                className="jar-roomform-box"
                autoFocus
                value={renaming.text}
                onChange={(e) => setRenaming({ ...renaming, text: e.target.value })}
              />
              <p className="jar-ask">
                <button type="submit" disabled={renaming.busy}>
                  {renaming.busy ? "…" : "rename it"}
                </button>
                <span aria-hidden="true"> · </span>
                <button type="button" onClick={() => setRenaming(null)}>
                  keep the old name
                </button>
              </p>
            </form>
          ) : (
            <p className="jar-settings-name">
              {groups.find((g) => g.id === gid)?.name ?? atWall.name}
              {iOwnIt ? (
                <button
                  type="button"
                  className="jar-settings-verb"
                  onClick={() =>
                    setRenaming({
                      id: gid,
                      text: groups.find((g) => g.id === gid)?.name ?? "",
                      busy: false,
                    })
                  }
                >
                  rename
                </button>
              ) : null}
            </p>
          )}

          {/* WHO IS HERE — the same people the field's hues stand for,
              named, with the one verb an owner has over them. */}
          <ul className="jar-settings-roll">
            {roll.map((m) => (
              <li key={m.profileId} className="jar-settings-member">
                <span>{m.name}</span>
                {m.role === "owner" ? (
                  <span className="jar-share-hint">made it</span>
                ) : null}
                {iOwnIt && m.profileId !== auth?.profile?.id ? (
                  removing === m.profileId ? (
                    <span className="jar-ask">
                      <button type="button" onClick={() => removeMember(gid, m.profileId)}>
                        take them out
                      </button>
                      <span aria-hidden="true"> · </span>
                      <button type="button" onClick={() => setRemoving(null)}>
                        keep them
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="jar-settings-verb"
                      onClick={() => setRemoving(m.profileId)}
                    >
                      remove
                    </button>
                  )
                ) : null}
              </li>
            ))}
          </ul>

          <p className="jar-ask">
            <button
              type="button"
              onClick={() => {
                const g = groups.find((x) => x.id === gid);
                if (g) copyInvite(g);
              }}
            >
              {copied === gid ? "link copied" : "copy the invite link"}
            </button>
          </p>

          {/* THE TWO WAYS OUT, and they are not the same act. Leaving
              takes your statements down and leaves the room standing.
              Closing it ends the room for everyone, and takes the top
              of mind the room built together — which nobody else can
              get back, so it says so. */}
          <p className="jar-ask jar-ask--after">
            {leaving === gid ? (
              <>
                <button type="button" onClick={() => leaveThisGroup(gid)}>
                  leave — your statements come down
                </button>
                <span aria-hidden="true"> · </span>
                <button type="button" onClick={() => setLeaving(null)}>
                  stay
                </button>
              </>
            ) : (
              <button type="button" onClick={() => setLeaving(gid)}>
                leave this group
              </button>
            )}
          </p>

          {iOwnIt ? (
            <p className="jar-ask">
              {closing === gid ? (
                <>
                  <button
                    type="button"
                    className="jar-settings-danger"
                    onClick={() => closeThisGroup(gid)}
                  >
                    close it for everyone — what the group decided goes too
                  </button>
                  <span aria-hidden="true"> · </span>
                  <button type="button" onClick={() => setClosing(null)}>
                    keep it
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="jar-settings-verb"
                  onClick={() => setClosing(gid)}
                >
                  close this group
                </button>
              )}
            </p>
          ) : null}
        </>
      );
    })()
  ) : (
    /* YOUR OWN SPACE AND AN AGENT'S both belong to the account, and
       everything you can change about them — your name, your language,
       your sessions, the agent's name, deleting either — is flat work
       with focus traps and plain confirmations that in-layout UI cannot
       give. So this does not reimplement the account screen badly; it
       says what this space is and opens the door to it. */
    <>
      <p className="jar-settings-name">{atWall.name}</p>
      <p className="jar-settings-note">
        {atWall.kind === "agent"
          ? "Its memory is its own — what it keeps here is not mixed into yours."
          : "Everything you keep, and what WAKA has read out of it."}
      </p>
      <p className="jar-ask">
        <Link className="jar-settings-verb" to="/profile">
          open your account
        </Link>
      </p>
    </>
  )}
</div>
  );
}
