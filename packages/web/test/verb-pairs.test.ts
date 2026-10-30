/**
 * EVERY VERB THE PRODUCT OFFERS HAS A WAY BACK, OR A REASON IT DOES NOT.
 *
 * goal: one-product-one-system, audit A6. Two findings in that audit were the
 * same defect wearing different nouns, and both were found by hand:
 *
 *   F3 — a principle's verbs ignored whose sentence it was, so you were
 *   offered `not mine` about your own words and a hard delete on the
 *   machine's.
 *
 *   F6 — rewriting a signal LOCKS its wording against regeneration, and the
 *   world offered the lock without the release. The board entry one surface
 *   away had both halves all along; the signal's was wired in the same
 *   session as the lock, without it.
 *
 * A third asymmetry turned out to be correct, and it is the reason this gate
 * is a REGISTER rather than a rule. `holdTopOfMindEntry` has no inverse on
 * purpose, stated where it is implemented: "there is no un-holding, by the
 * canon's design. You either keep a statement or you say it is not you; a
 * toggle back through 'held' would be a third state that means nothing." A
 * gate that mechanically demanded an inverse for every verb would have argued
 * that ruling into exactly the third state the canon refuses.
 *
 * SO THE PROPERTY IS NOT "every verb has an inverse". It is: every verb has
 * either a partner THE PRODUCT ACTUALLY WIRES, or a written ruling. Naming a
 * partner that exists in `lib/api` but is never called fails — which is
 * precisely the state F6 was in.
 *
 * WHAT COUNTS AS A VERB, mechanically: an exported function in `lib/api` that
 * reaches a write helper (`postJson`, `patchJson`, `putJson`, `requestVoid`,
 * `deleteJson`) and that something outside an import statement calls. Reads
 * are not verbs; an uncalled writer is not a verb the product offers.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): nothing. It reads the source as text.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import ts from 'typescript';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, "../src");
const API = resolve(SRC, "lib/api");

const WRITERS = ["postJson", "patchJson", "putJson", "requestVoid", "deleteJson"];

function exportedWriters(text:string):string[]{
  const source=ts.createSourceFile('resource.ts',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
  const functions=new Map(source.statements.filter(ts.isFunctionDeclaration).filter(node=>node.name&&node.body).map(node=>[node.name!.text,node]));
  const reachesWriter=(name:string,seen=new Set<string>()):boolean=>{
    if(seen.has(name))return false;seen.add(name);const definition=functions.get(name);if(!definition?.body)return false;
    let writes=false;
    const visit=(node:ts.Node)=>{if(ts.isCallExpression(node)&&ts.isIdentifier(node.expression)){
      const target=node.expression.text;if(WRITERS.includes(target)||functions.has(target)&&reachesWriter(target,new Set(seen)))writes=true;
    }if(!writes)ts.forEachChild(node,visit);};
    visit(definition.body);return writes;
  };
  return [...functions].filter(([name,node])=>node.modifiers?.some(modifier=>modifier.kind===ts.SyntaxKind.ExportKeyword)&&reachesWriter(name)).map(([name])=>name);
}

function everyFile(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    if (statSync(full).isDirectory()) everyFile(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/** The verbs the product actually offers, discovered rather than listed. */
function verbsOffered(): string[] {
  /* imports stripped: importing a verb is not offering it */
  let blob = "";
  for (const file of everyFile(SRC)) {
    blob += readFileSync(file, "utf8").replace(/import\s+[\s\S]*?from\s+["'][^"']+["'];/g, " ");
  }
  const found: string[] = [];
  for (const entry of readdirSync(API)) {
    if (!entry.endsWith(".ts") || entry === "http.ts" || entry.endsWith(".test.ts")) continue;
    const text = readFileSync(resolve(API, entry), "utf8");
    for (const name of exportedWriters(text)) {
      if ((blob.match(new RegExp(`(?<![\\w.])${name}\\b`, "g"))?.length ?? 0) <= 1) continue;
      found.push(name);
    }
  }
  return found.sort();
}

/**
 * A partner, or a ruling. A bare name means "this is the way back, and the
 * product wires it". `RULED:` means there is no way back and here is why.
 */
const REGISTER: Record<string, string> = {
  createProfileKey: "revokeProfileKey",
  revokeProfileKey: "RULED: revocation is permanent; create a new key for the same profile to reconnect",
  revokeSession: "RULED: disconnect ends a credential without deleting memory; reconnect requires fresh consent through the login instructions in Settings",
  // the archive
  createInspiration: "deleteInspiration",
  deleteInspiration: "restoreInspiration",
  /* THE DELETED SHELF (2026-10-15). Deleting now has a real way back: the
     shelf holds the words for a month and `restoreInspiration` puts them
     back under the same id and date. */
  restoreInspiration: "deleteInspiration",
  forgetDeletedInspiration: "RULED: the shelf's own exit — a copy the person asked to be rid of before the month is up; the confirm is a second press in the shelf row, and the inspiration itself was already deleted",
  reviewInspiration: "RULED: relevance is reversible from the original in the archive using the same verb; confirmation and Later only schedule the next check, and neither deletes the original",
  updateInspiration: "RULED: an edit is its own inverse — edit it again",
  /* THE REFLECTION PAIR IS GONE, AND THIS IS THE COMMIT IT GOES IN
     (2026-10-10). `createReflection` / `deleteReflection` was a whole and
     honest pair — write an answer, remove that answer — and
     `requestReflectionQuestion` was ruled beside them. All three went with
     `components/ReflectionFlow.tsx`, their only caller, when the founder
     folded the writing-based review into one correction field: *"Typing
     happens in one place only: when you correct."*
     The entries could not outlive the verbs by even one commit. A register
     naming a partner nobody wires is finding F6 in this file's own header,
     and a register naming a verb that no longer exists is "a description of a
     product that is gone" — the words of the third test below.
     AN ANSWER IS STILL WRITTEN, by `createInspiration`: a photo moment's
     "why" travels as `input.reflections` on the capture it belongs to. Its
     way back is `deleteInspiration`, already on this register above, which
     removes the capture and the answer together — which is right, because an
     answer given at capture time is part of that capture rather than a second
     thing the person has to find and undo. */
  retryPausedReading: "RULED: restarts a reading that failed (out of credit, a provider outage) over material already kept; it writes no words of anyone's, and the reading it produces is reviewed like any other",
  retryInspirationProcessing: "RULED: resumes failed processing of already-kept material without creating another capture or answer; existing words remain editable or removable, and opening the resulting reading is a separate choice",
  presignAttachment: "RULED: one half of a single upload, not a state a person is left in",
  uploadMessageAttachment: "discardMessageAttachment",
  discardMessageAttachment: "RULED: discards a staged upload the person just removed with ×; picking the file again through ＋ is the way back, and nothing sent can be discarded (409)",
  finalizeAttachment: "RULED: the other half of that upload",
  correctAttachmentTranscript: "RULED: edit again or use original wording (a null correction); neither operation changes the recording or the retained machine transcript",
  retryAttachmentTranscript: "RULED: resumes analysis of an existing recording without creating authored content; corrections stay authoritative and the recording remains removable",
  retryAttachmentAnalysis: "RULED: retries only failed attachment analysis, preserves the original, and never duplicates the capture; the original remains removable",
  /* EIGHT REVIEW VERBS, ALL GONE IN THE SAME COMMIT (2026-10-10):
     `startReviewSession`, `advanceReviewSession`, `chooseReviewInspiration`,
     `finishReviewSession`, `requestReviewQuestion`, `saveReviewAnswer`,
     `editReviewAnswer`, `removeReviewAnswer`, and `retryReviewProcessing`
     above them. Eight doors into the fourth product — 84 of the app's 847
     user-facing strings — which the founder's workflow design collapsed into
     one text field behind "not quite".
     Worth keeping from their rulings, because it is the argument that
     survives them: a review session created only PRIVATE metadata and
     deleting one never touched an inspiration. That is still true of what
     replaced them. A correction rides `createFeedback`, whose own entry says
     a verdict is answered by giving a different one — and the saves the
     claim was read from are not touched by any of it. */

  // what the machine concluded, and what you may say back
  updateSignal: "releaseSignal",
  releaseSignal: "updateSignal",
  /* `restoreSignal` LEFT THE REGISTER with its client wrapper (2026-10-11).
     It was a dismissal's undo, and the only surface listing dismissed
     signals was the antechamber — one of three machinery doors on the
     settings page the founder folded into the gear's dropdown. The ROUTE
     stands; what is gone is the verb this product offers. */
  createFeedback: "RULED: a verdict is answered by giving a different one, not by withdrawing it",
  keepHarvest: "RULED: keeping makes an ordinary inspiration, and that inspiration is deleted like any other; the basket's copy of the words is gone by design",
  declineHarvest: "RULED: letting a candidate go deletes its words at once (the Harvest design), so there is nothing to restore; the same sentence is not proposed again",
  updateTopOfMindEntry: "releaseTopOfMindEntry",
  releaseTopOfMindEntry: "updateTopOfMindEntry",
  dismissTopOfMindEntry: "restoreTopOfMindEntry",
  restoreTopOfMindEntry: "dismissTopOfMindEntry",
  holdTopOfMindEntry:
    "RULED: no un-holding, by the canon's design — you either keep a statement or " +
    "you say it is not you, and a toggle back through 'held' would be a third state " +
    "that means nothing. The exit is dismissTopOfMindEntry.",
  refreshTopOfMind: "RULED: regeneration is idempotent; there is no prior state to restore",
  requestPrincipleRead: "RULED: requests deduplicated background generation; existing words remain editable or removable",

  // what the machine concluded you hold to. NOTHING DECLARES ONE (founder,
  // 2026-09-08: "You cannot declare your own values. This can only be
  // generated. So remove this option."), so `declarePrinciple` is no longer a
  // verb the product offers and is not on this register. That makes removal
  // the one act here with no verb facing it, which is a ruling rather than an
  // omission: what a principle rests on is its evidence, and the evidence
  // survives removal untouched, so the way back is the next generation
  // drawing the same conclusion from the same kept memories. A verb that
  // re-declared it by hand would be exactly the door that was just closed.
  deletePrinciple:
    "RULED: a principle is earned, not written — the way back is the evidence " +
    "it rested on, which removal does not touch, and the next generation over it",
  updatePrinciple: "RULED: an edit is its own inverse",
  disputePrinciple: "undoPrincipleDispute",
  undoPrincipleDispute: "disputePrinciple",
  reorderPrinciples: "RULED: an ordering is its own inverse — move it back",

  /* ═══ ROOMS HAD A SECTION HERE, AND IT IS THE BEST CASE THIS GATE EVER
     CAUGHT ═══════════════════════════════════════════════════════════════
     Founder, 2026-10-12: "방 없애" — remove rooms.

     NINE VERBS STOOD HERE: `createGroup` and `deleteGroup`, `joinGroup` and
     `leaveGroup`, `removeGroupMember`, `renameGroup`, the three proposal
     verbs, and `refreshGroupTopOfMind`. Every client wrapper behind them is
     deleted and the nine route files that answered them are gone.

     WHY IT MATTERS THAT THIS SECTION EXISTED. `createGroup` had already left
     it, and the reason is the argument the whole room removal rests on: the
     pair READ as satisfied — create a room, delete a room — but the create
     half was reachable only from a form NOTHING OPENED, so this register was
     describing a verb the product did not offer and passing because
     unreachable code named it. That is the exact shape this gate exists to
     catch, and it was hiding inside the gate.

     Then `deleteGroup` stood alone with a ruling that read: "a room is
     joined, never made — the way back into one you left is the invite link
     that put you in it, which `?join=<code>` still honours." That sentence
     was true and it was the problem. Joining was the only door left; you
     could not leave, rename, invite, or close, because `SpaceSettings` — the
     panel holding all four — could not mount. Shown that, the founder cut
     rooms rather than rebuild the exits, and `?join=` honours nothing now. */
  // TALKING, AFTER THE SURFACE WAS CUT BACK (2026-10-10). Founder: "So the
  // talk with Waka experience is the most confusing chat experience ever with
  // so many different buttons that I have no idea what its supposed to do."
  // Three wrappers went with the controls that called them, so three entries
  // changed shape here. This gate is why they could not go quietly: a
  // register naming a partner nobody wires is the F6 shape all over again.
  /* ERASING ONE IS BACK, AND IT IS BACK WHERE THE NOTE SAID TO PUT IT.
     `deleteConversation` was removed with the `···` menu inside the
     conversation you were reading — the only thing calling it, and a place
     where "delete" sat one slip from "send". Its tombstone said it belonged
     beside the row in the LIST of conversations, and that list now exists:
     `components/ConversationsOverlay`, one of the three things the left
     corner opens over the world. So the pair is whole again rather than
     RULED, which is the outcome this gate was holding the question open
     for. */
  createConversation: "deleteConversation",
  deleteConversation: "createConversation",
  requestConversationReply: "stopConversationReply",
  stopConversationReply: "RULED: stops an in-flight reply. Retry reply is available only for failed attempts; a stopped reply stays stopped and the composer remains available.",
  saveConversationMessage: "RULED: authored conversation messages are immutable; confirm deletion of the conversation to erase them, never automatically create a belief",
  /* EIGHT ROOM VERBS LEFT THIS REGISTER ON 2026-10-12. Founder: "방 없애" —
     remove rooms. `joinGroup`/`leaveGroup` were each other's way back,
     `removeGroupMember` pointed at `joinGroup`, `renameGroup` was ruled its
     own inverse, `createGroupProposal`/`affirmGroupProposal` both faced
     `declineGroupProposal`, and `refreshGroupTopOfMind` was ruled
     idempotent "the same, for a room". Every one of those pairings was
     honest and every client wrapper behind them is deleted.

     THE REGISTER'S OWN LESSON ABOUT ROOMS, worth keeping because it is why
     this gate exists: `createGroup` once satisfied its pairing with
     `deleteGroup` only because an UNREACHABLE sheet referenced it — a
     register describing a verb the product did not offer, passing because
     dead code named it. A pairing is only as true as the door in front of
     it, which is the whole argument the room removal rests on. */

  // you, and what can speak as you
  signup: "RULED: the account's own end is deleteAccount, behind a typed confirmation",
  /* `endConnection` WENT WITH THE CONNECTIONS LIST (2026-10-11), and that
     leaves `login` without the partner it named. The honest reading is not
     that signing in has no way back — it is that ending a SESSION FROM
     ANOTHER DEVICE is no longer a thing this product offers, so the way
     back from signing in is signing out, which `logout` is. Founder, on
     the settings page: "remove anything that is not absolutely necessary";
     connections govern people-to-people reading and the product has had no
     people-to-people surface since rooms were removed. */
  login:
    "RULED: the way back is signing out. `logout` in `lib/api/auth.ts` is " +
    "wired through the auth context and reachable from the gear on every " +
    "screen — it is not NAMED here as the partner because this file " +
    "discovers verbs by the shared write helpers (`postJson` and friends) " +
    "and `logout` reaches the network through `apiFetch` directly. That is " +
    "a blind spot in the discovery, not a missing exit, and it is written " +
    "down rather than worked around so the next person does not read the " +
    "ruling as a claim that signing in has no inverse.",
  updateAuthProfile: "RULED: an edit is its own inverse",
  updateAuthPreferences: "RULED: an edit is its own inverse",
  /* `pinConversationInspiration` LEFT THE REGISTER with its client
     wrapper. Founder: "let's get rid of the side part and referencing
     inspiration ... it's too complicated right now." The ROUTE is live
     and tested; this register watches the verbs the PRODUCT offers, and
     the product offers none that reaches it. If the panel comes back, so
     does the entry — its ruling was that the same call with `null` is its
     own way back. */
  createProfile: "deleteProfile",
  deleteProfile: "createProfile",
  renameProfile: "RULED: an edit is its own inverse",

  /* THE KEEPER'S KEYS AND THE SIBLING GRANTS left the register together
     (2026-10-11). Both were tables of credentials on the settings page — a
     developer surface on a consumer product's account screen — and the
     founder's instruction was "remove anything that is not absolutely
     necessary". `createAgentKey` AND `revokeAgentKey` HAVE NOW LEFT TOO
     (2026-10-12), and this paragraph said the opposite until today: it
     claimed the mint "STAYS, and is still minted when an agent is made".

     It stopped being minted when the secret it produced was found to be
     discarded by the line that produced it, while listing and revoking
     lived on a panel that could never mount — a credential nobody could
     hold, see or revoke, that the middleware nonetheless honoured. With
     no caller left, `verbsOffered` skips both (their only occurrence is
     their own declaration), so the pair leaves the register the same way
     `pinConversationInspiration` did. The ROUTES are live and tested, and
     `DELETE` is the only way to retire the rows minted while the secret
     WAS displayed; what went is the
     client wrappers that only that UI called. */


  /* THE GARDENER'S ASKS went with the third machinery door (2026-10-11).
     `resolveSignalDuplicate`'s ruling is kept here in spirit because it is
     the best of the three and would be true again if the surface returns:
     both answers are standing by design, a merge retires without deleting,
     and the record itself is the way back. */
};

describe("every verb has a way back, or a reason it does not", () => {
  it('discovers delegated writes without treating delegated reads or cycles as writes',()=>{
    expect(exportedWriters('async function writeWindow(){return postJson<number>("owned");} async function readWindow(){return getJson("owned");} function cycle(){return cycle();} export async function save(){return writeWindow();} export async function read(){return readWindow();} export function empty(){return cycle();}')).toEqual(['save']);
  });
  it("has no verb missing from the register", () => {
    const missing = verbsOffered().filter((v) => !(v in REGISTER));
    expect(
      missing,
      "these verbs change something and are not on the register. A verb is a " +
        "door; before it ships, somebody has to decide whether it swings both " +
        "ways. Add the partner the product wires, or a `RULED:` line saying why " +
        "there is none and where the other exit is.",
    ).toEqual([]);
  });

  it("names no partner the product does not actually wire", () => {
    /* THE ONE THAT WOULD HAVE CAUGHT F6. `releaseSignal` existed in `lib/api`
       and nothing called it, so the signal's lock had a partner on paper and
       no way back on screen. A partner has to be a verb the product OFFERS,
       not one that merely exists. */
    const offered = new Set(verbsOffered());
    const broken: string[] = [];
    for (const [verb, partner] of Object.entries(REGISTER)) {
      if (partner.startsWith("RULED:")) continue;
      if (!offered.has(verb)) continue;
      if (!offered.has(partner)) broken.push(`${verb} → ${partner}`);
    }
    expect(
      broken,
      "these name a way back that the product does not wire. The verb ships and " +
        "its partner does not, which is how a person gets locked into a state " +
        "with no exit — exactly the shape of finding F6.",
    ).toEqual([]);
  });

  it("keeps no entry for a verb that no longer exists", () => {
    const offered = new Set(verbsOffered());
    const stale = Object.keys(REGISTER).filter((v) => !offered.has(v));
    expect(
      stale,
      "these are on the register and the product no longer offers them. A " +
        "register describing verbs that are gone is a description of a product " +
        "that is gone.",
    ).toEqual([]);
  });
});
