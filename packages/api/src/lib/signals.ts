import type { Cluster } from "../db/index.js";

export type SignalKind = "note" | "link" | "image" | "mixed";

export type SignalScoreName =
  | "resonance"
  | "recurrence"
  | "agency"
  | "identitySignal"
  | "decisionRelevance";

export type SignalScores = Record<SignalScoreName, number>;

export interface SignalPersistenceShape {
  id: string;
  userId: string;
  text: string;
  kind: string | null;
  category: number | null;
  importanceScore: number;
  wowScore: number;
  cluster: Cluster | null;
  classifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Signal {
  id: string;
  userId: string;
  text: string;
  kind: SignalKind | null;
  category: number | null;
  scores: SignalScores;
  capturedAt: Date;
  updatedAt: Date;
  interpretation: {
    cluster: Cluster | null;
    classifiedAt: Date | null;
  };
  legacy: {
    inspirationId: string;
    importanceScore: number;
    wowScore: number;
  };
}

function score(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(Math.round(value), 0), 100);
}

export function signalScoresFromInspiration(
  row: Pick<SignalPersistenceShape, "importanceScore" | "wowScore">,
): SignalScores {
  const importance = score(row.importanceScore);
  const resonance = score(row.wowScore);

  return {
    resonance,
    recurrence: resonance,
    agency: importance,
    identitySignal: importance,
    decisionRelevance: importance,
  };
}

export function signalFromInspiration(row: SignalPersistenceShape): Signal {
  return {
    id: row.id,
    userId: row.userId,
    text: row.text,
    kind:
      row.kind === "note" || row.kind === "link" || row.kind === "image" || row.kind === "mixed"
        ? row.kind
        : null,
    category: row.category,
    scores: signalScoresFromInspiration(row),
    capturedAt: row.createdAt,
    updatedAt: row.updatedAt,
    interpretation: {
      cluster: row.cluster,
      classifiedAt: row.classifiedAt,
    },
    legacy: {
      inspirationId: row.id,
      importanceScore: row.importanceScore,
      wowScore: row.wowScore,
    },
  };
}

export function withSignalLayer<T extends SignalPersistenceShape>(row: T): T & {
  signal: Signal;
  signalScores: SignalScores;
} {
  const signal = signalFromInspiration(row);
  return {
    ...row,
    signal,
    signalScores: signal.scores,
  };
}
