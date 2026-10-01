// @vitest-environment jsdom
/**
 * WHAT THIS MOCKS, AND WHY (gate G6): `lib/api` is scripted here so this suite
 * verifies that the person's words stay visible through queued follow-up,
 * failure, and a later return. The model and SQL queue have their own seams.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReflectionFlow } from "../src/components/ReflectionFlow";
import { profileStorageKey } from "../src/lib/profile-storage";
import { createReflection, deleteReflection, requestReflectionQuestion, fetchReflectionQuestionStatus, type ApiReflectionQuestionStatus } from "../src/lib/api";

vi.mock("../src/lib/api", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/lib/api")>(),
  createReflection: vi.fn(),
  deleteReflection: vi.fn(),
  requestReflectionQuestion: vi.fn(),
  fetchReflectionQuestionStatus: vi.fn(),
}));

let host: HTMLDivElement;
let root: Root;
const scrollIntoView = vi.fn();
const saved = { id: "reflection-1", inspirationId: "inspiration-1", question: "What made you want to keep this?",
  answer: "I noticed the garden felt calmer when we left a corner unfinished.", skipped: false,
  createdAt: "2026-09-27T00:00:00.000Z" };
const onSaved = vi.fn();
const onRemoved = vi.fn();
const onDone = vi.fn();

function button(label: string): HTMLButtonElement {
  const found = [...host.querySelectorAll("button")].find((item) => item.textContent?.trim() === label);
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}

async function writeAnswer(value: string) {
  const box = host.querySelector("textarea") as HTMLTextAreaElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(box, value);
    box.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  window.localStorage.clear();
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scrollIntoView });
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

describe("reflection conversation", () => {
  it("discards a pending follow-up when an earlier answer is removed", async () => {
    let finish!: (status: ApiReflectionQuestionStatus) => void;
    vi.mocked(requestReflectionQuestion).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    vi.mocked(deleteReflection).mockResolvedValue(undefined);
    await act(async () => root.render(<ReflectionFlow inspirationId="inspiration-1" initialTurns={[
      { id: "earlier", question: "First question", answer: "PRIVATE_SENTINEL earlier answer" },
      { id: "latest", question: "Second question", answer: "A remaining thought" },
    ]} locale="en-US" onSaved={onSaved} onRemoved={onRemoved} onDone={onDone} />));
    await act(async () => button("ask another question →").click());
    await act(async () => host.querySelector<HTMLElement>(".jar-reflection-turns summary")!.click());
    await act(async () => host.querySelector<HTMLButtonElement>(".jar-reflection-turn button")!.click());
    await act(async () => finish({ phase: "ready", question: "PRIVATE_SENTINEL stale follow-up" }));
    expect(host.textContent).not.toContain("PRIVATE_SENTINEL");
    expect(host.textContent).toContain("A remaining thought");
    expect(onRemoved).toHaveBeenCalledWith("earlier");
    expect(host.querySelector("textarea")).toBeNull();
  });

  it("keeps the person's unsaved draft while discarding a question based on deleted context", async () => {
    const draftKey = profileStorageKey({ accountId: "a", profileId: "p" }, "reflectionDraft:inspiration-1");
    vi.mocked(requestReflectionQuestion).mockResolvedValue({ phase: "ready", question: "PRIVATE_SENTINEL generated question" });
    vi.mocked(deleteReflection).mockResolvedValue(undefined);
    await act(async () => root.render(<ReflectionFlow inspirationId="inspiration-1" draftKey={draftKey} initialTurns={[
      { id: "latest", question: "A question", answer: "An earlier saved answer" },
    ]} locale="en-US" onSaved={onSaved} onRemoved={onRemoved} onDone={onDone} />));
    await act(async () => button("ask another question →").click());
    await writeAnswer("My unfinished words should stay.");
    await act(async () => button("take it back").click());
    expect(host.textContent).not.toContain("PRIVATE_SENTINEL");
    expect(host.querySelector("textarea")!.value).toBe("My unfinished words should stay.");
    expect(localStorage.getItem(draftKey!)).toContain("My unfinished words should stay.");
  });
  it("keeps unfinished answers with their account and leaves unscoped drafts unclaimed", async () => {
    const keyA = profileStorageKey({ accountId: "account-a", profileId: "profile-a" }, "reflectionDraft:inspiration-1");
    const keyB = profileStorageKey({ accountId: "account-b", profileId: "profile-b" }, "reflectionDraft:inspiration-1");
    const legacyKey = "waka.reflectionDraft:inspiration-1";
    window.localStorage.setItem(legacyKey, JSON.stringify({ afterId: null, answer: "unknown owner" }));
    const render = async (draftKey: string | null) => act(async () => root.render(
      <ReflectionFlow key={draftKey} draftKey={draftKey} inspirationId="inspiration-1" initialTurns={[]}
        locale="en-US" onSaved={onSaved} onRemoved={onRemoved} onDone={onDone} />,
    ));
    await render(keyA);
    expect(host.querySelector("textarea")!.value).toBe("");
    await writeAnswer("An unfinished private thought.");
    await render(keyB);
    expect(host.querySelector("textarea")!.value).toBe("");
    await render(keyA);
    expect(host.querySelector("textarea")!.value).toBe("An unfinished private thought.");
    expect(window.localStorage.getItem(legacyKey)).toContain("unknown owner");
  });
  it("saves first, then asks one grounded follow-up and waits for the person", async () => {
    vi.mocked(createReflection).mockResolvedValue(saved);
    vi.mocked(requestReflectionQuestion).mockResolvedValue({ phase: "ready", question: "What made leaving that corner unfinished feel calmer?" });
    await act(async () => root.render(<ReflectionFlow inspirationId="inspiration-1" profileId="profile-1" initialTurns={[]} locale="en-US"
      onSaved={onSaved} onRemoved={onRemoved} onDone={onDone} />));
    await writeAnswer(saved.answer!);
    expect(host.textContent).toContain("Your answer shapes the next question.");
    await act(async () => button("continue →").click());
    expect(createReflection).toHaveBeenCalledWith("inspiration-1", { question: saved.question, answer: saved.answer }, { profile: "profile-1" });
    expect(requestReflectionQuestion).toHaveBeenCalledWith("inspiration-1", saved.id, false);
    expect(host.textContent).toContain(saved.answer);
    expect(host.textContent).toContain("What made leaving that corner unfinished feel calmer?");
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(host.querySelector('textarea'));
    expect(createReflection).toHaveBeenCalledTimes(1);
    expect(button("done for now")).toBeTruthy();
  });

  it("treats the wait as part of the conversation while keeping the answer in view", async () => {
    vi.mocked(createReflection).mockResolvedValue(saved);
    vi.mocked(requestReflectionQuestion).mockReturnValue(new Promise(() => {}));
    await act(async () => root.render(<ReflectionFlow inspirationId="inspiration-1" initialTurns={[]} locale="en-US"
      onSaved={onSaved} onRemoved={onRemoved} onDone={onDone} />));
    await writeAnswer(saved.answer!);
    await act(async () => button("continue →").click());
    expect(host.querySelector('[role="status"]')?.textContent).toContain("Let’s follow that thought…");
    expect(host.textContent).toContain(saved.answer);
    expect(host.querySelectorAll(".jar-reflection-typing span")).toHaveLength(3);
    expect(button("done for now")).toBeTruthy();
  });

  it("keeps a saved answer visible when question generation fails, and permits a retry", async () => {
    vi.mocked(createReflection).mockResolvedValue(saved);
    vi.mocked(requestReflectionQuestion).mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ phase: "ready", question: "What would you leave unfinished next time?" });
    await act(async () => root.render(<ReflectionFlow inspirationId="inspiration-1" initialTurns={[]} locale="en-US"
      onSaved={onSaved} onRemoved={onRemoved} onDone={onDone} />));
    await writeAnswer(saved.answer!);
    await act(async () => button("continue →").click());
    expect(host.textContent).toContain(saved.answer);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("thought is kept");
    await act(async () => button("try again").click());
    expect(requestReflectionQuestion).toHaveBeenLastCalledWith("inspiration-1", saved.id, true);
    expect(host.textContent).toContain("What would you leave unfinished next time?");
  });

  it("does not spend on opening past reflections; go deeper is the person's choice", async () => {
    vi.mocked(requestReflectionQuestion).mockResolvedValue({ phase: "ready", question: "Which part of that memory still stays with you?" });
    await act(async () => root.render(<ReflectionFlow inspirationId="inspiration-1"
      initialTurns={[{ id: saved.id, question: saved.question, answer: saved.answer! }]} locale="en-US"
      onSaved={onSaved} onRemoved={onRemoved} onDone={onDone} />));
    expect(host.textContent).toContain(saved.answer);
    expect(requestReflectionQuestion).not.toHaveBeenCalled();
    await act(async () => button("ask another question →").click());
    expect(requestReflectionQuestion).toHaveBeenCalledWith("inspiration-1", saved.id, false);
  });

  it("keeps the answer and closes without spending on another question when asked to finish", async () => {
    vi.mocked(createReflection).mockResolvedValue(saved);
    await act(async () => root.render(<ReflectionFlow inspirationId="inspiration-1" initialTurns={[]} locale="en-US"
      onSaved={onSaved} onRemoved={onRemoved} onDone={onDone} />));
    await writeAnswer(saved.answer!);
    await act(async () => button("keep this & finish").click());
    expect(createReflection).toHaveBeenCalledOnce();
    expect(requestReflectionQuestion).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledOnce();
  });

  it("lets each answer lead directly to the next question without an intermediate save screen", async () => {
    const second = { ...saved, id: "reflection-2", question: "What made leaving that corner unfinished feel calmer?",
      answer: "It left room for someone else to add to it." };
    vi.mocked(createReflection).mockResolvedValueOnce(saved).mockResolvedValueOnce(second);
    vi.mocked(requestReflectionQuestion)
      .mockResolvedValueOnce({ phase: "ready", question: second.question })
      .mockResolvedValueOnce({ phase: "ready", question: "Who might add something you would not have imagined?" });
    await act(async () => root.render(<ReflectionFlow inspirationId="inspiration-1" initialTurns={[]} locale="en-US"
      onSaved={onSaved} onRemoved={onRemoved} onDone={onDone} />));
    await writeAnswer(saved.answer!);
    await act(async () => button("continue →").click());
    await writeAnswer(second.answer!);
    await act(async () => button("continue →").click());
    expect(createReflection).toHaveBeenCalledTimes(2);
    expect(requestReflectionQuestion).toHaveBeenCalledTimes(2);
    expect(host.textContent).toContain("Who might add something you would not have imagined?");
  });
});
