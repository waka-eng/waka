import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, fetchTopOfMindRefresh, refreshTopOfMind, type ApiTopOfMindRefreshResult, type ApiTopOfMindRefreshStatus } from "./api";

type Phase = "idle" | "starting" | "pending" | "running" | "waiting" | "delayed" | "error" | "failed" | "unknown" | "changed" | "unchanged" | "empty";
type Complete = (result: ApiTopOfMindRefreshResult, current: () => boolean) => Promise<ApiTopOfMindRefreshResult["outcome"] | void>;
// A missing version is only for resuming an older browser's stored job ID.
type SavedRequest = { jobId: string; requestVersion?: string };

async function readStep(receipt: SavedRequest, run: AbortSignal, current: () => boolean, complete: Complete): Promise<ApiTopOfMindRefreshStatus> {
  const request = new AbortController();
  const abort = () => request.abort();
  run.addEventListener("abort", abort, { once: true });
  const valid = () => current() && !request.signal.aborted;
  let timer = 0;
  try {
    return await Promise.race([
      (async () => {
        const state = await fetchTopOfMindRefresh(receipt.jobId, request.signal, receipt.requestVersion);
        if (receipt.requestVersion && (typeof state.requestVersion !== "string" || !/^\d+$/.test(state.requestVersion) ||
          BigInt(state.requestVersion) < BigInt(receipt.requestVersion) ||
          (state.status === "succeeded" && (typeof state.completedVersion !== "string" || !/^\d+$/.test(state.completedVersion) ||
            BigInt(state.completedVersion) < BigInt(receipt.requestVersion))))) {
          throw new Error("Reading status belongs to an older request");
        }
        if (valid() && state.status === "succeeded" && state.result) {
          const outcome = await complete(state.result, valid);
          return { ...state, result: { ...state.result, outcome: outcome ?? state.result.outcome } };
        }
        return state;
      })(),
      new Promise<never>((_resolve, reject) => {
        timer = window.setTimeout(() => { abort(); reject(new Error("Reading status timed out")); }, 15_000);
      }),
    ]);
  } finally {
    window.clearTimeout(timer); run.removeEventListener("abort", abort); abort();
  }
}

/** One resumable request, not a new generation for every failed status read. */
export function useTopOfMindRefresh(options: {
  storageKey: string | null;
  onComplete: Complete;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [canResume, setCanResume] = useState(false);
  const job = useRef<SavedRequest | null>(null);
  const controller = useRef<AbortController | null>(null);
  const accepting = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const completion = useRef(options.onComplete);
  const key = useRef(options.storageKey);
  completion.current = options.onComplete;
  key.current = options.storageKey;

  const remember = (receipt: SavedRequest | null) => {
    job.current = receipt; setCanResume(receipt !== null);
    try {
      if (key.current) {
        if (receipt) sessionStorage.setItem(key.current, JSON.stringify(receipt));
        else sessionStorage.removeItem(key.current);
      }
    } catch { /* an unavailable browser store does not cancel server work */ }
  };

  const start = useCallback(async () => {
    if (accepting.current && !controller.current?.signal.aborted) return;
    controller.current?.abort();
    window.clearTimeout(timer.current);
    const run = new AbortController();
    controller.current = run;
    const scope = key.current;
    const current = () => key.current === scope && controller.current === run && !run.signal.aborted;
    const began = Date.now();
    let errors = 0;
    let polls = 0;
    if (!job.current) {
      accepting.current = true;
      setPhase("starting");
      try {
        const receipt = await refreshTopOfMind();
        if (!current()) return;
        remember(receipt);
      } catch {
        if (current()) setPhase("error");
        return;
      } finally {
        if (current()) accepting.current = false;
      }
    }
    const receipt = job.current!;
    const poll = async () => {
      if (!current() || document.hidden) return;
      try {
        const state = await readStep(receipt, run.signal, current, (...args) => completion.current(...args));
        if (!current()) return;
        if (state.status === "succeeded" && state.result) {
          remember(null); setPhase(state.result.outcome);
          timer.current = window.setTimeout(() => { if (current()) setPhase("idle"); }, 6000);
          return;
        }
        if (state.status === "failed" || state.status === "unknown" || state.status === "succeeded") {
          remember(null); setPhase(state.status === "failed" ? "failed" : "unknown");
          return;
        }
        errors = 0;
        setPhase(state.status === "pending" && state.runAfter && Date.parse(state.runAfter) > Date.now() + 1000
          ? "waiting" : state.status);
        polls += 1;
        if (Date.now() - began >= 120_000 || polls >= 30) { setPhase("delayed"); return; }
        timer.current = window.setTimeout(() => void poll(), Math.min(10_000, 1000 * Math.pow(1.5, polls)));
      } catch (error) {
        if (!current()) return;
        if (error instanceof ApiError && (error.status === 404 || error.status === 400)) {
          remember(null); setPhase("unknown"); return;
        }
        errors += 1;
        if (errors >= 3) { setPhase("error"); return; }
        timer.current = window.setTimeout(() => void poll(), errors * 1000);
      }
    };
    setPhase("pending");
    await poll();
  }, []);

  useEffect(() => {
    job.current = null;
    setPhase("idle");
    try {
      const saved = options.storageKey && sessionStorage.getItem(options.storageKey);
      if (saved) {
        if (saved.startsWith("{")) {
          const parsed = JSON.parse(saved) as SavedRequest;
          if (typeof parsed.jobId === "string" && typeof parsed.requestVersion === "string" && /^[1-9]\d*$/.test(parsed.requestVersion)) job.current = parsed;
        } else job.current = { jobId: saved };
      }
    } catch { /* malformed/unavailable storage is not proof of server work */ }
    setCanResume(job.current !== null);
    if (job.current) void start();
    const resume = () => { if (job.current && !document.hidden) void start(); };
    window.addEventListener("focus", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      controller.current?.abort(); window.clearTimeout(timer.current);
      window.removeEventListener("focus", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [options.storageKey, start]);

  return { phase, canResume, start, busy: ["starting", "pending", "running", "waiting"].includes(phase) };
}
