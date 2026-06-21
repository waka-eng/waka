// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchInspirationScoreBreakdown, fetchWowStatus } from "../src/lib/api";
import type { ApiWowStatusRow } from "../src/lib/api";
import { ADMIN_HOME_COPY } from "../src/pages/AdminHome";
import {
  ADMIN_WOW_STATUS_COPY,
  formatWowDebugReasonDetail,
  formatWowDebugReasonLabel,
} from "../src/pages/AdminWowStatus";
import AdminWowStatusPage from "../src/pages/AdminWowStatus";

const mockAuthState = vi.hoisted(() => ({
  value: {
    user: {
      id: "admin-1",
      email: "admin@example.com",
      name: "Admin",
      preferredLocale: "ko-KR" as "en-US" | "ko-KR",
      onboardingCompletedAt: "2026-05-01T00:00:00.000Z",
      isAdmin: true,
    },
    isLoading: false,
    isAuthenticated: true,
    login: vi.fn(),
    signup: vi.fn(),
    logout: vi.fn(async () => undefined),
    refresh: vi.fn(async () => null),
    updatePreferredLocale: vi.fn(async () => ({
      id: "admin-1",
      email: "admin@example.com",
      name: "Admin",
      preferredLocale: "ko-KR" as "en-US" | "ko-KR",
      onboardingCompletedAt: "2026-05-01T00:00:00.000Z",
      isAdmin: true,
    })),
  },
}));

vi.mock("../src/lib/auth-context", () => ({
  useAuth: () => mockAuthState.value,
  useOptionalAuth: () => mockAuthState.value,
}));

vi.mock("../src/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/api")>();
  return {
    ...actual,
    fetchWowStatus: vi.fn(async () => []),
    fetchInspirationScoreBreakdown: vi.fn(async () => {
      throw new Error("fetchInspirationScoreBreakdown mock not configured");
    }),
  };
});

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let mountedRoot: Root | null = null;
let mountedContainer: HTMLDivElement | null = null;

beforeEach(() => {
  mockAuthState.value.user.preferredLocale = "ko-KR";
  vi.mocked(fetchWowStatus).mockReset();
  vi.mocked(fetchWowStatus).mockResolvedValue([]);
  vi.mocked(fetchInspirationScoreBreakdown).mockReset();
});

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

async function flushReactWork(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function renderAdminWowStatus(): Promise<HTMLDivElement> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mountedRoot = root;
  mountedContainer = container;

  await act(async () => {
    root.render(createElement(MemoryRouter, null, createElement(AdminWowStatusPage)));
  });
  await flushReactWork();
  return container;
}

function wowStatusRow(input: Partial<ApiWowStatusRow> = {}): ApiWowStatusRow {
  return {
    inspiration: {
      id: "signal-1",
      textPreview: "A saved signal about quiet workrooms.",
      kind: "note",
      category: null,
      cluster: null,
      classifiedAt: null,
      importanceScore: 44,
      wowScore: 71,
      createdAt: "2026-05-30T20:00:00.000Z",
      updatedAt: "2026-05-30T20:00:00.000Z",
    },
    job: null,
    embedded: false,
    generatedWowMomentCount: 2,
    debugReason: {
      code: "linked_wow_ready",
      label: "generated 2",
      detail: "2 linked WOW moments found for this inspiration.",
    },
    ...input,
  };
}

describe("Korean admin copy", () => {
  it("localizes admin landing strings that previously leaked English", () => {
    const copy = ADMIN_HOME_COPY["ko-KR"];
    const visibleCopy = [
      copy.eyebrow,
      copy.title,
      copy.intro,
      copy.toolsAriaLabel,
      ...copy.tools.flatMap((tool) => [tool.label, tool.description]),
    ].join(" ");

    expect(visibleCopy).not.toMatch(
      /INTERNAL TOOLS|Admin inspection|Developer-only surfaces|Context graph|Inspect promoted context nodes|Top-of-mind pipeline status|Review classifier/i,
    );
    expect(visibleCopy).toContain("관리자 점검");
    expect(visibleCopy).toContain("맥락 그래프");
    expect(ADMIN_HOME_COPY["en-US"].title).toBe("Admin inspection");
  });

  it("localizes top-of-mind status headings, summary labels, table headers, and empty state", () => {
    const copy = ADMIN_WOW_STATUS_COPY["ko-KR"];
    const visibleCopy = [
      copy.backLink,
      copy.eyebrow,
      copy.title,
      copy.intro,
      copy.refresh,
      copy.refreshing,
      copy.summaryAriaLabel,
      copy.summarySignals(3),
      copy.summaryReady(1),
      copy.summaryWaiting(1),
      copy.summaryFailed(1),
      copy.tableAriaLabel,
      ...Object.values(copy.headers),
      copy.loadingStatus,
      copy.noRecentSignals,
    ].join(" ");

    expect(visibleCopy).not.toMatch(
      /\b(ADMIN|INTERNAL DIAGNOSTICS|Top-of-mind pipeline status|REFRESH|SIGNALS|READY|WAITING|FAILED|SAVED|SIGNAL|CLUSTER|SCORES|EMBEDDING|JOB|GENERATED|WHY|RAW JUDGE LOG|No recent signals)\b/i,
    );
    expect(visibleCopy).toContain("마음속 노트 처리 상태");
    expect(visibleCopy).toContain("최근 신호가 없습니다.");
  });

  it("localizes row status helpers instead of rendering API debug English in Korean mode", () => {
    const ready = wowStatusRow();
    const waiting = wowStatusRow({
      debugReason: {
        code: "waiting_for_job",
        label: "waiting for job",
        detail: "Processing job is still pending.",
      },
    });
    const failed = wowStatusRow({
      job: {
        id: "job-1",
        status: "failed",
        attempts: 1,
        maxAttempts: 3,
        updatedAt: "2026-05-30T20:00:00.000Z",
        lastError: "redacted",
      },
      debugReason: {
        code: "job_failed",
        label: "job failed",
        detail: "The processing job failed; retry or inspect the redacted admin job error.",
      },
    });

    const localized = [
      formatWowDebugReasonLabel(ready, "ko-KR"),
      formatWowDebugReasonDetail(ready, "ko-KR"),
      formatWowDebugReasonLabel(waiting, "ko-KR"),
      formatWowDebugReasonDetail(waiting, "ko-KR"),
      formatWowDebugReasonLabel(failed, "ko-KR"),
      formatWowDebugReasonDetail(failed, "ko-KR"),
    ].join(" ");

    expect(localized).not.toMatch(/generated|linked WOW moments|waiting for job|Processing job|job failed|retry or inspect/i);
    expect(localized).toContain("생성됨 2개");
    expect(localized).toContain("작업 대기 중");
    expect(localized).toContain("작업 실패");
    expect(formatWowDebugReasonLabel(ready, "en-US")).toBe("generated 2");
  });

  it("renders the top-level Korean status load error without English API fallback copy", async () => {
    vi.mocked(fetchWowStatus).mockRejectedValue(
      new Error("Failed to load top-of-mind status: network unreachable"),
    );

    const view = await renderAdminWowStatus();
    const visibleText = view.textContent ?? "";

    expect(visibleText).toContain("마음속 노트 처리 상태를 불러오지 못했습니다.");
    expect(visibleText).not.toMatch(/Failed to load top-of-mind status|network unreachable|Please try again/i);
  });

  it("renders Korean score-breakdown errors without English API fallback copy", async () => {
    vi.mocked(fetchWowStatus).mockResolvedValue([wowStatusRow()]);
    vi.mocked(fetchInspirationScoreBreakdown).mockRejectedValue(
      new Error("Failed to load score breakdown (HTTP 500). Please try again."),
    );

    const view = await renderAdminWowStatus();
    const scoreButton = Array.from(view.querySelectorAll("button")).find(
      (button) => button.textContent === ADMIN_WOW_STATUS_COPY["ko-KR"].scoreBreakdown,
    );
    expect(scoreButton).toBeTruthy();

    await act(async () => {
      scoreButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushReactWork();

    const visibleText = view.textContent ?? "";
    expect(visibleText).toContain("세부 점수를 불러오지 못했습니다.");
    expect(visibleText).not.toMatch(/Failed to load score breakdown|Please try again/i);
  });
});
