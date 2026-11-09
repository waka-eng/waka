/** WHAT THIS MOCKS, AND WHY: nothing. `validatePublicHandle` is a pure rule.
 * A public page lives at `/<handle>`, and the web's own top-level pages are
 * matched before it — so a handle spelled like one of those pages would make
 * its owner's public page unreachable. Each must be reserved. */
import { expect, it } from "vitest";

import { validatePublicHandle } from "./public-handles.js";

/* The web's static top-level paths (packages/web/src/main.tsx) that a handle
   could spell — 3 to 24 letters, digits, hyphens or underscores. */
const WEB_PAGES = ["login", "share", "onboarding", "inspirations", "principles", "days", "chat", "mobile-check"];

it.each(WEB_PAGES)("reserves %s, a page of the web app", (page) => {
  expect(validatePublicHandle(page)).toBe("That handle is reserved");
  expect(validatePublicHandle(`@${page.toUpperCase()}`)).toBe("That handle is reserved");
});

it("still lets an ordinary handle through", () => {
  expect(validatePublicHandle("mina_kim")).toBeNull();
});

it("lets a profile keep a handle that was reserved after it claimed it", () => {
  expect(validatePublicHandle("share", { keeping: "share" })).toBeNull();
  expect(validatePublicHandle("@SHARE", { keeping: "share" })).toBeNull();
  expect(validatePublicHandle("share", { keeping: "mina" })).toBe("That handle is reserved");
});
