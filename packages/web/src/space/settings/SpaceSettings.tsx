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

import type { ApiAgentKey, ApiGroupMember, ApiGroupSummary, ApiMintedKey } from "../../lib/api";
import type { Space } from "../../space-kinds";

/**
 * WHICH OF THIS PANEL'S FOUR DESTRUCTIVE WORDS REFUSED.
 *
 * Keyed rather than a single string because the panel offers four of them at
 * once. One error line at the top would say "something went wrong" to a person
 * looking at `rename`, `leave`, `close this room` and a roll of members with a
 * `remove` beside each — which is a sentence that makes them check all four.
 */
export type GroupVerb = "rename" | "leave" | "close" | "remove";

export interface GroupTrouble {
  verb: GroupVerb;
  /** already run through the page's `whyFailed`, so it names the status */
  text: string;
}

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
  /**
   * WHAT THE SERVER REFUSED, IF IT REFUSED. Owned by the page for the same
   * reason the four confirmations are: the handler that learns about the
   * failure lives there. Cleared by the page when a verb is pressed again, and
   * here when one is armed — arming is a fresh intention and the last
   * refusal's sentence is no longer about it.
   */
  trouble: GroupTrouble | null;
  clearTrouble: () => void;
  /**
   * AN AGENT'S CREDENTIALS, WHICH USED TO HAVE NO ADDRESS IN THE WORLD.
   *
   * `createAgentKey` / `fetchAgentKeys` / `revokeAgentKey` existed only on the
   * flat `/agents` screen — three of the twelve verbs `one-product-one-system.md`
   * counted as missing here. They belong on the agent's own wall: a key is a
   * fact about THIS agent, and the sheet opened by its name is where its facts
   * already live.
   *
   * They are not deferred to `/profile` like renaming and deleting are. That
   * deferral is about flat work needing focus traps and plain confirmations;
   * issuing a key is one press with one consequence, and revoking is the same
   * two-step this panel already runs four times.
   */
  agentKeys: ApiAgentKey[];
  /** shown ONCE, never retrievable again — see `ApiMintedKey.secret` */
  minted: ApiMintedKey | null;
  setMinted: (key: ApiMintedKey | null) => void;
  issueKey: (profileId: string) => void;
  revoking: string | null;
  setRevoking: (keyId: string | null) => void;
  revokeKey: (keyId: string) => void;
  keysBusy: boolean;
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
  trouble,
  clearTrouble,
  viewerProfileId,
  copied,
  copyInvite,
  onClose,
  leaveThisGroup,
  renameThisGroup,
  closeThisGroup,
  removeMember,
  agentKeys,
  minted,
  setMinted,
  issueKey,
  revoking,
  setRevoking,
  revokeKey,
  keysBusy,
}: SpaceSettingsProps): JSX.Element {
  const auth = { profile: { id: viewerProfileId } };
  const setSettingsFor = (_: string | null) => onClose();
  /**
   * PROSE BESIDE THE VERB THAT REFUSED — the shape the memory panel's delete
   * already proved reads. `role="status"` because it appears after a press
   * rather than with the panel, so a screen reader that has already read this
   * surface is told without being dragged back to the top of it.
   */
  const troubleAt = (verb: GroupVerb): JSX.Element | null =>
    trouble?.verb === verb ? (
      <span className="jar-settings-warn" role="status">
        {trouble.text}
      </span>
    ) : null;

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
              {troubleAt("rename")}
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
                  ) : trouble?.verb === "remove" ? (
                    /* beside the person it refused about, not beside the roll */
                    <>
                      {troubleAt("remove")}
                      <button
                        type="button"
                        className="jar-settings-verb"
                        onClick={() => {
                          clearTrouble();
                          setRemoving(m.profileId);
                        }}
                      >
                        remove
                      </button>
                    </>
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
              <>
                {troubleAt("leave")}
                <button
                  type="button"
                  onClick={() => {
                    clearTrouble();
                    setLeaving(gid);
                  }}
                >
                  leave this room
                </button>
              </>
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
                    close it for everyone — what the room decided goes too
                  </button>
                  <span aria-hidden="true"> · </span>
                  <button type="button" onClick={() => setClosing(null)}>
                    keep it
                  </button>
                </>
              ) : (
                <>
                {troubleAt("close")}
                <button
                  type="button"
                  className="jar-settings-verb"
                  onClick={() => {
                    clearTrouble();
                    setClosing(gid);
                  }}
                >
                  close this room
                </button>
                </>
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
      {/* ═══ WHAT CAN SPEAK AS THIS AGENT ═══
          Only on an agent's wall: your own wall has no keys, and a room's
          credentials would be a different thing entirely. Live keys only —
          a revoked key is not a fact about the agent any more, it is a fact
          about its past, and this sheet says what IS. */}
      {atWall.kind === "agent" ? (
        <>
          <p className="jar-settings-sub jar-label">what can speak as it</p>
          {(() => {
            const live = agentKeys.filter(
              (k) => k.profileId === atWall.id && k.revokedAt === null,
            );
            if (live.length === 0) {
              return (
                <p className="jar-settings-note">
                  Nothing yet. A key lets this agent keep things here on its own.
                </p>
              );
            }
            return live.map((k) => (
              <p key={k.id} className="jar-settings-key">
                <span className="jar-settings-key-name">
                  {k.label ?? "a key"} · {k.prefix}…
                </span>
                {/* THE TWO-STEP, the same shape as the four above it: a
                    destructive word is never beside its own yes. */}
                {revoking === k.id ? (
                  <span className="jar-ask">
                    <button type="button" disabled={keysBusy} onClick={() => revokeKey(k.id)}>
                      {keysBusy ? "revoking…" : "yes, revoke it"}
                    </button>
                    <span aria-hidden="true"> · </span>
                    <button type="button" onClick={() => setRevoking(null)}>
                      keep it
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    className="jar-settings-verb"
                    onClick={() => setRevoking(k.id)}
                  >
                    revoke
                  </button>
                )}
              </p>
            ));
          })()}

          {/* SHOWN ONCE AND NEVER AGAIN, and it says so. The server returns the
              secret in the minting response alone; there is no route that can
              hand it back. A person who closes this without copying it has to
              issue another, so the sentence has to be unmistakable BEFORE they
              close it rather than an apology afterwards. */}
          {minted && minted.profileId === atWall.id ? (
            <p className="jar-settings-minted">
              <span className="jar-settings-sub jar-label">copy it now</span>
              <code className="jar-settings-secret">{minted.secret}</code>
              <span className="jar-settings-note">
                This is the only time it is shown. Close this and it is gone for good.
              </span>
              <button
                type="button"
                className="jar-settings-verb"
                onClick={() => setMinted(null)}
              >
                I have it
              </button>
            </p>
          ) : (
            <p className="jar-ask">
              <button
                type="button"
                className="jar-settings-verb"
                disabled={keysBusy}
                onClick={() => issueKey(atWall.id)}
              >
                {keysBusy ? "issuing…" : "issue a key"}
              </button>
            </p>
          )}
        </>
      ) : null}

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
