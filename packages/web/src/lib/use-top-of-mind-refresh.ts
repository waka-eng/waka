import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, fetchTopOfMindRefresh, refreshTopOfMind, type ApiTopOfMindRefreshResult, type ApiTopOfMindRefreshStatus } from "./api";

type Phase = "idle" | "starting" | "pending" | "running" | "waiting" | "delayed" | "error" | "failed" | "unknown" | "changed" | "unchanged" | "empty";
type Complete = (result: ApiTopOfMindRefreshResult, current: () => boolean) => Promise<ApiTopOfMindRefreshResult["outcome"] | void>;

async function readStep(id: string, run: AbortSignal, current: () => boolean, complete: Complete): Promise<ApiTopOfMindRefreshStatus> {
  const request = new AbortController();
  const abort = () => request.abort();
  run.addEventListener("abort", abort, { once: true });
  const valid = () => current() && !request.signal.aborted;
  let timer = 0;
  try {
    return await Promise.race([
      (async () => {
        const state = await fetchTopOfMindRefresh(id, request.signal);
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
  const job = useRef<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const accepting = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const completion = useRef(options.onComplete);
  const key = useRef(options.storageKey);
  completion.current = options.onComplete;
  key.current = options.storageKey;

  const remember = (id: string | null) => {
    job.current = id; setCanResume(id !== null);
    try {
      if (key.current) {
        if (id) sessionStorage.setItem(key.current, id);
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
        remember(receipt.jobId);
      } catch {
        if (current()) setPhase("error");
        return;
      } finally {
        if (current()) accepting.current = false;
      }
    }
    const id = job.current!;
    const poll = async () => {
      if (!current() || document.hidden) return;
      try {
        const state = await readStep(id, run.signal, current, (...args) => completion.current(...args));
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
    try { if (options.storageKey) job.current = sessionStorage.getItem(options.storageKey); } catch { /* memory only */ }
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
