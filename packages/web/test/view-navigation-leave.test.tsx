// @vitest-environment jsdom
/**
 * A COLD-LINK CLOSE'S SECOND STEP IS SPENT ON ITS OWN LANDING (review).
 *
 * `closeOpen` arms `archiveLeaving.thenReplace` and steps back over an open
 * note's entry; the landing turns the list's entry into the world. Armed and
 * never consumed — a step back that went somewhere else, or came late — it
 * used to wait and rewrite whatever location came next.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): nothing. A real `MemoryRouter` and the
 * real hook; the arming is set by hand because the archive it belongs to is
 * not the subject here.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, expect, it } from "vitest";
import { archiveLeaving, useViewNavigation } from "../src/lib/use-view-navigation";

let host: HTMLDivElement, root: Root;
let go: ReturnType<typeof useNavigate>, where: ReturnType<typeof useLocation>;
function Probe() { useViewNavigation("scope"); go = useNavigate(); where = useLocation(); return null; }
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  archiveLeaving.thenReplace = null;
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); archiveLeaving.thenReplace = null; });

it("acts on the landing it was armed for, then is spent", async () => {
  await act(async () => root.render(<MemoryRouter initialEntries={["/?open=saves"]}><Probe /></MemoryRouter>));
  archiveLeaving.thenReplace = { to: "/", from: where.key, at: Date.now() };
  await act(async () => { go("/?open=saves", { state: { other: 1 } }); });
  expect(where.search).toBe("");
  expect(archiveLeaving.thenReplace).toBeNull();
  await act(async () => { go("/?open=saves"); });
  expect(where.search, "a spent arming rewrote a later location").toBe("?open=saves");
});

it("does nothing, and is spent, when the landing is not the archive or came too late", async () => {
  await act(async () => root.render(<MemoryRouter initialEntries={["/?open=saves"]}><Probe /></MemoryRouter>));
  archiveLeaving.thenReplace = { to: "/", from: where.key, at: Date.now() };
  await act(async () => { go("/chat/new"); });
  expect(where.pathname).toBe("/chat/new");
  expect(archiveLeaving.thenReplace).toBeNull();
  archiveLeaving.thenReplace = { to: "/", from: where.key, at: Date.now() - 60_000 };
  await act(async () => { go("/?open=saves"); });
  expect(where.search, "a stale arming rewrote the location").toBe("?open=saves");
  expect(archiveLeaving.thenReplace).toBeNull();
});

it("ends the leave with its arming, so a later note may pop its own entry again (round 7)", async () => {
  await act(async () => root.render(<MemoryRouter initialEntries={["/?open=saves"]}><Probe /></MemoryRouter>));
  archiveLeaving.now = true;
  archiveLeaving.thenReplace = { to: "/", from: where.key, at: Date.now() - 60_000 };
  await act(async () => { go("/?open=saves"); });
  expect(archiveLeaving.now).toBe(false);
});
