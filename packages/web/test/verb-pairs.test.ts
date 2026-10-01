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

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, "../src");
const API = resolve(SRC, "lib/api");

const WRITERS = ["postJson", "patchJson", "putJson", "requestVoid", "deleteJson"];

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
    const marks = [...text.matchAll(/export (?:async )?function (\w+)\b/g)];
    for (let i = 0; i < marks.length; i += 1) {
      const name = marks[i]![1] as string;
      const from = marks[i]!.index as number;
      const to = i + 1 < marks.length ? (marks[i + 1]!.index as number) : text.length;
      const span = text.slice(from, to);
      /* the helper may carry a generic — `postJson<{ x: Y }>(…)` */
      if (!WRITERS.some((w) => new RegExp(`(?<![\\w.])${w}\\s*[<(]`).test(span))) continue;
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
  // the archive
  createInspiration: "deleteInspiration",
  deleteInspiration: "createInspiration",
  updateInspiration: "RULED: an edit is its own inverse — edit it again",
  createReflection: "deleteReflection",
  deleteReflection: "createReflection",
  requestReflectionQuestion: "RULED: asking creates no authored content; a person can leave with Done or remove their saved answer",
  retryInspirationProcessing: "RULED: resumes failed processing of already-kept material without creating another capture or answer; existing words remain editable or removable, and opening the resulting reading is a separate choice",
  presignAttachment: "RULED: one half of a single upload, not a state a person is left in",
  finalizeAttachment: "RULED: the other half of that upload",

  // what the machine concluded, and what you may say back
  updateSignal: "releaseSignal",
  releaseSignal: "updateSignal",
  restoreSignal: "createFeedback",
  createFeedback: "RULED: a verdict is answered by giving a different one, not by withdrawing it",
  updateTopOfMindEntry: "releaseTopOfMindEntry",
  releaseTopOfMindEntry: "updateTopOfMindEntry",
  dismissTopOfMindEntry: "restoreTopOfMindEntry",
  restoreTopOfMindEntry: "dismissTopOfMindEntry",
  holdTopOfMindEntry:
    "RULED: no un-holding, by the canon's design — you either keep a statement or " +
    "you say it is not you, and a toggle back through 'held' would be a third state " +
    "that means nothing. The exit is dismissTopOfMindEntry.",
  refreshTopOfMind: "RULED: regeneration is idempotent; there is no prior state to restore",
  refreshGroupTopOfMind: "RULED: the same, for a room",
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

  // rooms
  createGroup: "deleteGroup",
  deleteGroup: "createGroup",
  joinGroup: "leaveGroup",
  leaveGroup: "joinGroup",
  removeGroupMember: "joinGroup",
  renameGroup: "RULED: an edit is its own inverse",
  createGroupProposal: "declineGroupProposal",
  affirmGroupProposal: "declineGroupProposal",
  declineGroupProposal: "affirmGroupProposal",

  // you, and what can speak as you
  signup: "RULED: the account's own end is deleteAccount, behind a typed confirmation",
  login: "endConnection",
  endConnection: "login",
  updateAuthProfile: "RULED: an edit is its own inverse",
  updateAuthPreferences: "RULED: an edit is its own inverse",
  createProfile: "deleteProfile",
  deleteProfile: "createProfile",
  renameProfile: "RULED: an edit is its own inverse",
  createAgentKey: "revokeAgentKey",
  revokeAgentKey: "createAgentKey",

  // the keeper's own keys (2026-08-29): same door, the person's hand
  createKeeperKey: "revokeKeeperKey",
  revokeKeeperKey: "createKeeperKey",

  // the sibling door (2026-08-29): opened and closed by the owner's hand
  createAgentGrant: "revokeAgentGrant",
  revokeAgentGrant: "createAgentGrant",

  // the gardener's asks (2026-08-31, waka#294): answering is deliberately
  // standing. keep_apart is a permanent answer the gardener respects — the
  // way to change your mind is that both signals still exist. A merge keeps
  // every exit open by construction: the retired signal keeps its statement,
  // its history, and its own evidence links, and the proposal row names the
  // survivor — nothing is deleted, so there is nothing an un-merge verb
  // would restore that the record does not already hold.
  resolveSignalDuplicate:
    "RULED: both answers are standing by design; a merge retires without deleting, " +
    "so the record itself is the way back",
};

describe("every verb has a way back, or a reason it does not", () => {
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
