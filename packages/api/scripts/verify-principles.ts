/**
 * The live gate for layer-4 calls: does the real model hold the phrasing
 * contract, the three-way relation, and the routing tests?
 *
 *   pnpm tsx packages/api/scripts/verify-principles.ts
 */
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
config({ path: fileURLToPath(new URL("../../../.env.local", import.meta.url)) });

const { distillPrinciples, judgePrincipleRelation, routeDeclaration } = await import(
  "../src/queue/gemini.js"
);

let failures = 0;
const check = (label: string, ok: boolean, detail: string) => {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

// 1. Distillation: three frugality-shaped signals should yield an imperative,
//    context-free candidate citing ≥3 provided ids — or honestly nothing.
const distilled = await distillPrinciples({
  profileId: "verify",
  preferredLocale: "en-US",
  signals: [
    { id: "s1", statement: "You keep choosing small tools you can rebuild in an evening.", evidenceCount: 5, firstEvidenceAt: new Date("2026-06-01"), lastEvidenceAt: new Date("2026-08-10"), tomAppearances: 6 },
    { id: "s2", statement: "You cap experiment budgets until something ships.", evidenceCount: 4, firstEvidenceAt: new Date("2026-06-10"), lastEvidenceAt: new Date("2026-08-01"), tomAppearances: 5 },
    { id: "s3", statement: "You delete what you built sooner than maintain what you doubt.", evidenceCount: 3, firstEvidenceAt: new Date("2026-06-20"), lastEvidenceAt: new Date("2026-08-12"), tomAppearances: 5 },
  ],
  currentPrinciples: [],
  currentEntries: [{ body: "Budget caps are on your mind this week." }],
});
if (distilled.candidates.length === 0) {
  check("distill: proposed nothing (allowed, but weak fixture)", true, "0 candidates");
} else {
  const c = distilled.candidates[0]!;
  check("distill: statement is bounded", c.statement.length > 0 && c.statement.length <= 200, JSON.stringify(c.statement));
  check("distill: cites ≥3 provided ids", new Set(c.citedSignalIds.filter((id) => ["s1","s2","s3"].includes(id))).size >= 3, c.citedSignalIds.join(","));
  check("distill: no numbers or project names (context test)", !/\d|\bJune\b|\bLLM\b/i.test(c.statement), c.statement);
  check("distill: not second-person description", !/^you keep\b/i.test(c.statement.trim()), c.statement);
}

// 2. Relation judge, all three directions.
const same = await judgePrincipleRelation({ preferredLocale: "en-US", candidateStatement: "Have something working before you spend more.", existingStatement: "Get a working version before further investment." });
check("relation: rewording → same", same.relation === "same", same.relation);
const conflict = await judgePrincipleRelation({ preferredLocale: "en-US", candidateStatement: "Default to the cheapest option until it hurts.", existingStatement: "Always buy the best tool available, whatever it costs." });
check("relation: opposite pulls → conflicting", conflict.relation === "conflicting", conflict.relation);
const indep = await judgePrincipleRelation({ preferredLocale: "en-US", candidateStatement: "Write the reason down before the change.", existingStatement: "Prefer tools you can hold in your head." });
check("relation: unrelated → independent", indep.relation === "independent", indep.relation);

// 3. Routing: a goal is filed as a capture; a maxim qualifies.
const goal = await routeDeclaration({ preferredLocale: "en-US", statement: "Ship the museum app by June." });
check("route: completable goal → inspiration", goal.route === "inspiration", goal.route);
const maxim = await routeDeclaration({ preferredLocale: "en-US", statement: "Have something working before you put more money in." });
check("route: context-free directive → principle", maxim.route === "principle", `${maxim.route}/${maxim.type}`);
const rule = await routeDeclaration({ preferredLocale: "en-US", statement: "Never spend more than $100 on LLM testing." });
check("route: parameterized rule → inspiration", rule.route === "inspiration", rule.route);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
