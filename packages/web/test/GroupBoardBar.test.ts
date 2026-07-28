// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GroupBoardBar, MINE_BOARD_ID, extractJoinCode } from "../src/components/GroupBoardBar";
import type { ApiGroupSummary } from "../src/lib/api";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const boards: ApiGroupSummary[] = [
  {
    id: "g1",
    name: "builders",
    role: "owner",
    joinCode: "ABCD2345",
    memberCount: 3,
    createdAt: "2026-07-07T00:00:00.000Z",
  },
  {
    id: "g2",
    name: "close friends",
    role: "member",
    joinCode: "WXYZ6789",
    memberCount: 2,
    createdAt: "2026-07-06T00:00:00.000Z",
  },
];

interface Handlers {
  onSelect?: (board: string) => void;
  onCreateGroup?: (name: string) => Promise<void>;
  onJoinGroup?: (code: string) => Promise<void>;
  activeBoard?: string;
}

async function renderBar(handlers: Handlers = {}): Promise<HTMLDivElement> {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      createElement(GroupBoardBar, {
        boards,
        activeBoard: handlers.activeBoard ?? MINE_BOARD_ID,
        onSelect: handlers.onSelect ?? (() => {}),
        onCreateGroup: handlers.onCreateGroup ?? (async () => {}),
        onJoinGroup: handlers.onJoinGroup ?? (async () => {}),
      }),
    );
  });
  return container!;
}

afterEach(() => {
  if (root) {
    act(() => {
      root?.unmount();
    });
  }
  container?.remove();
  root = null;
  container = null;
});

function tabByText(el: HTMLElement, text: string): HTMLButtonElement | undefined {
  return Array.from(el.querySelectorAll<HTMLButtonElement>("button.nc-board-tab")).find(
    (b) => b.textContent?.includes(text),
  );
}

describe("GroupBoardBar", () => {
  it("renders a Mine tab plus one tab per group", async () => {
    const el = await renderBar();
    expect(tabByText(el, "Mine")).toBeTruthy();
    expect(tabByText(el, "builders")).toBeTruthy();
    expect(tabByText(el, "close friends")).toBeTruthy();
  });

  it("marks the active board", async () => {
    const el = await renderBar({ activeBoard: "g1" });
    expect(tabByText(el, "builders")?.getAttribute("aria-selected")).toBe("true");
    expect(tabByText(el, "Mine")?.getAttribute("aria-selected")).toBe("false");
  });

  it("calls onSelect when a group tab is clicked", async () => {
    const onSelect = vi.fn();
    const el = await renderBar({ onSelect });
    await act(async () => {
      tabByText(el, "close friends")?.click();
    });
    expect(onSelect).toHaveBeenCalledWith("g2");
  });

  it("submits a new group name", async () => {
    const onCreateGroup = vi.fn(async () => {});
    const el = await renderBar({ onCreateGroup });
    await act(async () => {
      tabByText(el, "New")?.click();
    });
    const input = el.querySelector<HTMLInputElement>(".nc-board-input")!;
    const setValue = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      setValue?.call(input, "work peers");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const form = el.querySelector<HTMLFormElement>(".nc-board-form")!;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(onCreateGroup).toHaveBeenCalledWith("work peers");
  });

  it("shows the shareable invite link for the active group", async () => {
    const el = await renderBar({ activeBoard: "g1" });
    const share = el.querySelector(".nc-board-share-code");
    expect(share?.textContent).toContain("join=ABCD2345");
  });
});

describe("extractJoinCode", () => {
  it("returns a bare code unchanged", () => {
    expect(extractJoinCode("ABCD2345")).toBe("ABCD2345");
  });

  it("pulls the code out of a full invite link", () => {
    expect(extractJoinCode("https://waka.app/?join=ABCD2345")).toBe("ABCD2345");
  });
});
