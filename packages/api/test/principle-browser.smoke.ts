/** Browser proof using a disposable schema and real APIs. No model calls. */
import { serve } from "@hono/node-server";
import { resolve } from "node:path";
import { createTestDatabase } from "./helpers/index.js";
import { launchChromium } from "../../../tools/e2e/browser.js";

process.env.WAKA_BACKGROUND_JOB_AUTODRAIN = "0";
const t = await createTestDatabase();
const url = new URL(process.env.DB_CONNECTION_URL!);
url.searchParams.set("options", `-c search_path=${t.schemaName}`);
process.env.DB_CONNECTION_URL = url.toString();
const { app } = await import("../src/index.js");
const { createLocalWebApp } = await import("../src/local-web.js");
const { createGroupForProfile } = await import("../src/routes/groups-membership.js");
const web = createLocalWebApp(app, resolve(process.cwd(), "../web/dist"));
const server = serve({ fetch: web.fetch, port: 0, hostname: "127.0.0.1" });
await new Promise<void>((done) => server.once("listening", done));
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
const browser = await launchChromium({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const signup = await context.request.post(`${base}/api/auth/signup`, { data: {
    email: "principle-browser@example.test", password: "PrincipleBrowser123!", name: "Browser Owner",
  } });
  if (signup.status() !== 201) throw new Error(await signup.text());
  const owner = (await signup.json()).profile.id as string;
  const otherResponse = await fetch(`${base}/api/auth/signup`, { method: "POST",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({
      email: "principle-other@example.test", password: "PrincipleBrowser123!", name: "Other Member",
    }) });
  const other = (await otherResponse.json()).profile.id as string;
  const group = await createGroupForProfile(t.db as never, { profileId: owner, name: "Principle room" });
  await t.sql`INSERT INTO group_members(group_id,profile_id) VALUES (${group.id},${other})`;
  const [mind] = await t.sql`SELECT id FROM profiles WHERE group_id=${group.id}`;
  for (const target of [owner, mind.id as string]) {
    const ids: string[] = [];
    for (let n = 0; n < 3; n++) {
      const [s] = await t.sql`INSERT INTO signals(profile_id,statement) VALUES (${target},${`Pattern ${n}: testing small experiments`}) RETURNING id`;
      for (let i = 0; i < 3; i++) {
        const author = target === owner || i % 2 === 0 ? owner : other;
        const [inspirationRow] = await t.sql`INSERT INTO inspirations(profile_id,text,visibility)
          VALUES (${author},'A repeated choice to test something small.','public') RETURNING id`;
        await t.sql`INSERT INTO signal_evidence(profile_id,owner_profile_id,signal_id,inspiration_id)
          VALUES (${target},${author},${s.id},${inspirationRow.id})`;
      }
      await t.sql`UPDATE signals SET status='active' WHERE id=${s.id}`;
      ids.push(s.id as string);
    }
    const [tom] = target === owner
      ? await t.sql`INSERT INTO top_of_minds(profile_id) VALUES (${target}) RETURNING id`
      : await t.sql`INSERT INTO top_of_minds(group_id) VALUES (${group.id}) RETURNING id`;
    const [entry] = await t.sql`INSERT INTO top_of_mind_entries(top_of_mind_id,type,body)
      VALUES (${tom.id},'pattern','Making room for experiments.') RETURNING id`;
    const [principle] = await t.sql`INSERT INTO principles(profile_id,statement,rank)
      VALUES (${target},${target === owner ? "Prefer small, reversible experiments." : "Make experiments safe to share together."},1) RETURNING id`;
    for (const id of ids) {
      await t.sql`INSERT INTO top_of_mind_entry_signals(entry_id,signal_id) VALUES (${entry.id},${id})`;
      await t.sql`INSERT INTO principle_signals(profile_id,principle_id,signal_id) VALUES (${target},${principle.id},${id})`;
    }
    const more = target === owner
      ? ["Leave space to change your mind.", "Make something useful before making it bigger."]
      : ["Let different perspectives shape the next step.", "Keep the work ambitious and the process humane."];
    for (const [index, statement] of more.entries()) {
      const [extra] = await t.sql`INSERT INTO principles(profile_id,statement,rank)
        VALUES (${target},${statement},${index + 2}) RETURNING id`;
      for (const id of ids) await t.sql`INSERT INTO principle_signals(profile_id,principle_id,signal_id)
        VALUES (${target},${extra.id},${id})`;
    }
  }
  const page = await context.newPage();
  await page.goto(base);
  await page.locator(".jar-values").waitFor({ state: "visible" });
  await page.waitForTimeout(1000); // Allow the world's initial camera setup to settle.
  await page.locator(".jar-values").press("Enter");
  await page.locator(".jar-values").waitFor({ state: "hidden" });
  const personal = page.locator('.jar-wallcol[data-kind="self"] .jar-values-held');
  await personal.filter({ hasText: "Prefer small, reversible experiments." }).waitFor({ state: "visible" });
  await page.waitForTimeout(1000); // Capture the settled list, not the camera transition.
  const firstPrinciple = personal.filter({ hasText: "Prefer small, reversible experiments." });
  await firstPrinciple.locator("button.jar-values-value").click();
  await firstPrinciple.getByRole("button", { name: "Edit wording", exact: true }).waitFor({ state: "visible" });
  await firstPrinciple.getByRole("button", { name: "Why this fits", exact: true }).click();
  await firstPrinciple.locator(".jar-principle-evidence").waitFor({ state: "visible" });
  await firstPrinciple.getByText("Saved inspiration", { exact: false }).first().waitFor({ state: "visible" });
  if (await firstPrinciple.getByRole("button", { name: "Doesn’t describe me", exact: true }).isVisible()) {
    throw new Error("Secondary principle actions should be collapsed initially");
  }
  await firstPrinciple.locator("summary").click();
  await firstPrinciple.getByRole("button", { name: "Doesn’t describe me", exact: true }).waitFor({ state: "visible" });
  await firstPrinciple.getByRole("button", { name: "Move down", exact: true }).waitFor({ state: "visible" });
  await firstPrinciple.locator("summary").press("Escape");
  if (await firstPrinciple.getByRole("button", { name: "Doesn’t describe me", exact: true }).isVisible()) {
    throw new Error("Escape must close the secondary actions");
  }
  await firstPrinciple.locator("summary").click();
  await firstPrinciple.getByRole("button", { name: "Doesn’t describe me", exact: true }).click();
  await firstPrinciple.getByText("You marked this as inaccurate", { exact: true }).waitFor({ state: "visible" });
  await firstPrinciple.getByRole("button", { name: "Keep this", exact: true }).waitFor({ state: "visible" });
  await page.screenshot({ path: "/tmp/waka-principles-restore.png" });
  await firstPrinciple.getByRole("button", { name: "Keep this", exact: true }).click();
  await firstPrinciple.getByRole("button", { name: "Keep this", exact: true }).waitFor({ state: "hidden" });
  await page.screenshot({ path: "/tmp/waka-principles-personal.png" });
  await page.goto(`${base}/w/principle-room`);
  await page.locator(".jar-values").waitFor({ state: "visible" });
  await page.waitForTimeout(1500); // Direct room URLs travel horizontally first.
  await page.locator(".jar-values").press("Enter");
  await page.locator(".jar-values").waitFor({ state: "hidden" });
  const groupView = page.locator('.jar-wallcol[data-kind="group"] .jar-values-room');
  await groupView.getByText("Make experiments safe to share together.", { exact: true }).waitFor({ state: "visible" });
  await page.waitForTimeout(1000); // Let the vertical camera animation finish before opening evidence.
  if (await groupView.locator(".jar-principles-list > li").count() !== 3) throw new Error("Expected three principle rows");
  await groupView.getByText("Patterns behind this", { exact: true }).first().click();
  await groupView.getByText("Pattern 0: testing small experiments", { exact: true }).first().waitFor({ state: "visible" });
  const box = await groupView.boundingBox();
  if (!box || box.y < 0 || box.y + box.height > 900) throw new Error("Room principles are outside the viewport");
  await page.screenshot({ path: "/tmp/waka-principles-room.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: "/tmp/waka-principles-room-mobile.png" });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.route("**/principles/status", (route) => route.fulfill({ status: 500, body: "{}" }));
  await page.reload();
  await page.locator(".jar-values").waitFor({ state: "visible" });
  await page.waitForTimeout(1500);
  await page.locator(".jar-values").press("Enter");
  await page.locator(".jar-values").waitFor({ state: "hidden" });
  await groupView.getByRole("alert").waitFor({ state: "visible" });
  await page.unroute("**/principles/status");
  await groupView.getByRole("button", { name: "Try again" }).click();
  await groupView.getByText("Make experiments safe to share together.", { exact: true }).waitFor({ state: "visible" });
  console.log("PASS: personal principles, room principles, room citations, visible failure and retry");
} finally {
  await browser.close();
  server.close();
  await t.cleanup();
}
process.exit(0);
