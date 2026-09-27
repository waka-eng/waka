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
import { createReflection, requestReflectionQuestion, fetchReflectionQuestionStatus } from "../src/lib/api";

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
  it("saves first, then asks one grounded follow-up and waits for the person", async () => {
    vi.mocked(createReflection).mockResolvedValue(saved);
    vi.mocked(requestReflectionQuestion).mockResolvedValue({ phase: "ready", question: "What made leaving that corner unfinished feel calmer?" });
    await act(async () => root.render(<ReflectionFlow inspirationId="inspiration-1" initialTurns={[]} locale="en-US"
      onSaved={onSaved} onRemoved={onRemoved} onDone={onDone} />));
    await writeAnswer(saved.answer!);
    expect(host.textContent).toContain("Your answer shapes the next question.");
    await act(async () => button("continue →").click());
    expect(createReflection).toHaveBeenCalledWith("inspiration-1", { question: saved.question, answer: saved.answer });
    expect(requestReflectionQuestion).toHaveBeenCalledWith("inspiration-1", saved.id, false);
    expect(host.textContent).toContain(saved.answer);
    expect(host.textContent).toContain("What made leaving that corner unfinished feel calmer?");
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "start" });
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
