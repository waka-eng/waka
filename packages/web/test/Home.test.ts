// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { InspirationsBoard } from "../src/components/InspirationsBoard";
import {
  HomePage,
  HomeViewToggle,
  nextHomeCaptureHandoffState,
} from "../src/pages/Home";

vi.mock("../src/lib/auth-context", () => ({
  useAuth: () => ({
    user: {
      id: "user-1",
      email: "river@example.com",
      name: "River",
    },
    isLoading: false,
    isAuthenticated: true,
    login: vi.fn(),
    signup: vi.fn(),
    logout: vi.fn(async () => undefined),
    refresh: vi.fn(async () => null),
  }),
}));

vi.mock("../src/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/api")>();
  return {
    ...actual,
    fetchInspirations: vi.fn(async () => []),
    fetchWowMoments: vi.fn(async () => []),
  };
});

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let mountedRoot: Root | null = null;
let mountedContainer: HTMLDivElement | null = null;

afterEach(() => {
  if (mountedRoot) {
    act(() => {
      mountedRoot?.unmount();
    });
  }
  mountedRoot = null;
  mountedContainer?.remove();
  mountedContainer = null;
  vi.clearAllMocks();
});

async function renderHomePage(): Promise<HTMLDivElement> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mountedRoot = root;
  mountedContainer = container;

  await act(async () => {
    root.render(createElement(HomePage));
  });

  return container;
}

async function flushReactWork(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("HomePage view model", () => {
  it("defaults to Wow Moment First and does not render the inspiration grid above it", () => {
    const html = renderToStaticMarkup(createElement(HomePage));

    expect(html).toContain("data-active-view=\"wow\"");
    expect(html).toContain("Wow Moment First");
    expect(html).toContain("WAKA <em>— wow moments</em>");
    expect(html).toContain("WOW moments");
    expect(html).toContain("Loading WOW moments");
    expect(html).toContain("Default home");
    expect(html).not.toContain("WAKA <em>— your inspirations</em>");
    expect(html).not.toContain("grid home-grid");
    expect(html).not.toContain("cell capture");
  });

  it("clicking the Wow header Capture button switches to Inspiration First and focuses capture", async () => {
    const container = await renderHomePage();

    const initialSwitcher = container.querySelector<HTMLElement>(
      ".home-view-switcher",
    );
    expect(initialSwitcher?.dataset.activeView).toBe("wow");
    expect(container.textContent).toContain("WAKA — wow moments");
    expect(container.querySelector("#capNote")).toBeNull();

    const captureButton = container.querySelector<HTMLButtonElement>(
      "#captureTrigger",
    );
    expect(captureButton).not.toBeNull();

    await act(async () => {
      captureButton?.click();
    });
    await flushReactWork();

    const nextSwitcher = container.querySelector<HTMLElement>(
      ".home-view-switcher",
    );
    const inspirationButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>(
        ".home-view-switcher button",
      ),
    ).find((button) => button.textContent === "Inspiration First");
    const captureCell = container.querySelector<HTMLDivElement>("#capture");
    const captureTextarea = container.querySelector<HTMLTextAreaElement>(
      '#capNote[placeholder="A link, a note, an image — whatever\'s inspiring you right now…"]',
    );

    expect(nextSwitcher?.dataset.activeView).toBe("inspiration");
    expect(inspirationButton?.getAttribute("aria-pressed")).toBe("true");
    expect(captureTextarea).not.toBeNull();
    expect(captureCell?.classList.contains("focused")).toBe(true);
    expect(document.activeElement).toBe(captureTextarea);
  });

  it("can render the switcher in Inspiration First state", () => {
    const html = renderToStaticMarkup(
      createElement(HomeViewToggle, {
        activeView: "inspiration",
        onChange: () => undefined,
      }),
    );

    expect(html).toContain("data-active-view=\"inspiration\"");
    expect(html).toContain("Wow Moment First");
    expect(html).toContain("Inspiration First");
    expect(html).toContain("aria-pressed=\"true\">Inspiration First</button>");
  });

  it("hands off Wow header Capture to Inspiration First with a focus request", () => {
    expect(nextHomeCaptureHandoffState(0)).toEqual({
      activeView: "inspiration",
      autoFocusCaptureRequest: 1,
    });
    expect(nextHomeCaptureHandoffState(7)).toEqual({
      activeView: "inspiration",
      autoFocusCaptureRequest: 8,
    });
  });

  it("keeps the inspiration tagline for the Inspiration First board", () => {
    const html = renderToStaticMarkup(createElement(InspirationsBoard));

    expect(html).toContain("WAKA <em>— your inspirations</em>");
  });
});
