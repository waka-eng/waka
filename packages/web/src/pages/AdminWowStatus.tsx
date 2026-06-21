import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import {
  ApiError,
  fetchInspirationScoreBreakdown,
  fetchWowStatus,
  type ApiInspirationScoreBreakdown,
  type ApiWowStatusRow,
} from "../lib/api";
import { useAuth } from "../lib/auth-context";
import { normalizeSupportedLocale, readStoredLocale, type SupportedLocale } from "../lib/locales";

type AdminWowStatusCopy = {
  backLink: string;
  eyebrow: string;
  title: string;
  intro: string;
  refresh: string;
  refreshing: string;
  failedToLoad: string;
  notSet: string;
  notAvailable: string;
  rawJudgeFallback: string;
  rawJudgeRawPrefix: string;
  rawJudgeStagePrefix: string;
  rawJudgeFinishPrefix: string;
  rawJudgeSchemaPrefix: string;
  scoreDisplayedResonance: string;
  scoreStoredCoreResonance: string;
  scoreStoredImportance: string;
  scoreFreshnessAdjustment: string;
  scoreContentTextContext: string;
  scoreProcessingReflection: string;
  scoreRevisit: string;
  scoreRelationship: string;
  scoreContextCounts: string;
  scoreRelationshipNote: string;
  scoreLinks: string;
  scoreAttachments: string;
  scoreReflectionChars: string;
  summaryAriaLabel: string;
  summarySignals: (count: number) => string;
  summaryReady: (count: number) => string;
  summaryWaiting: (count: number) => string;
  summaryFailed: (count: number) => string;
  tableAriaLabel: string;
  headers: {
    saved: string;
    signal: string;
    cluster: string;
    scores: string;
    embedding: string;
    job: string;
    generated: string;
    why: string;
    rawJudgeLog: string;
  };
  loadingStatus: string;
  noRecentSignals: string;
  unclassified: string;
  resonance: string;
  importance: string;
  hideBreakdown: string;
  scoreBreakdown: string;
  embedded: string;
  missing: string;
  noJob: string;
  loadingScoreBreakdown: string;
  failedToLoadScoreBreakdown: string;
  jobStatuses: Record<string, string>;
  debugReasonLabels: Record<string, (row: ApiWowStatusRow) => string>;
  debugReasonDetails: Record<string, (row: ApiWowStatusRow) => string>;
};

export const ADMIN_WOW_STATUS_COPY: Record<SupportedLocale, AdminWowStatusCopy> = {
  "en-US": {
    backLink: "Admin",
    eyebrow: "internal diagnostics",
    title: "Top-of-mind pipeline status",
    intro:
      "Internal visibility into the legacy note-generation pipeline. This page keeps scores, debug labels, jobs, and judge diagnostics out of the user-facing product surface.",
    refresh: "Refresh",
    refreshing: "Refreshing...",
    failedToLoad: "Failed to load top-of-mind status",
    notSet: "not set",
    notAvailable: "not available",
    rawJudgeFallback: "No raw judge diagnostics.",
    rawJudgeRawPrefix: "raw",
    rawJudgeStagePrefix: "stage",
    rawJudgeFinishPrefix: "finish",
    rawJudgeSchemaPrefix: "schema",
    scoreDisplayedResonance: "Displayed resonance",
    scoreStoredCoreResonance: "Stored/core resonance",
    scoreStoredImportance: "Stored importance",
    scoreFreshnessAdjustment: "Freshness adjustment",
    scoreContentTextContext: "Content/text/context",
    scoreProcessingReflection: "Processing/reflection",
    scoreRevisit: "Revisit",
    scoreRelationship: "Relationship",
    scoreContextCounts: "Context counts",
    scoreRelationshipNote: "Relationship note",
    scoreLinks: "links",
    scoreAttachments: "attachments",
    scoreReflectionChars: "reflection chars",
    summaryAriaLabel: "top-of-mind status summary",
    summarySignals: (count) => `${count} signals`,
    summaryReady: (count) => `${count} ready`,
    summaryWaiting: (count) => `${count} waiting`,
    summaryFailed: (count) => `${count} failed`,
    tableAriaLabel: "Top-of-mind pipeline rows",
    headers: {
      saved: "Saved",
      signal: "Signal",
      cluster: "Cluster",
      scores: "Scores",
      embedding: "Embedding",
      job: "Job",
      generated: "Generated",
      why: "Why",
      rawJudgeLog: "Raw judge log",
    },
    loadingStatus: "Loading status...",
    noRecentSignals: "No recent signals.",
    unclassified: "unclassified",
    resonance: "Resonance",
    importance: "Importance",
    hideBreakdown: "Hide breakdown",
    scoreBreakdown: "Score breakdown",
    embedded: "embedded",
    missing: "missing",
    noJob: "no job",
    loadingScoreBreakdown: "Loading score breakdown...",
    failedToLoadScoreBreakdown: "Failed to load score breakdown",
    jobStatuses: {},
    debugReasonLabels: {},
    debugReasonDetails: {},
  },
  "ko-KR": {
    backLink: "관리자",
    eyebrow: "내부 진단",
    title: "마음속 노트 처리 상태",
    intro:
      "이전 노트 생성 흐름의 내부 상태를 확인합니다. 점수, 디버그 라벨, 작업, 판정 진단은 사용자 화면에 노출되지 않습니다.",
    refresh: "새로고침",
    refreshing: "새로고침 중...",
    failedToLoad: "마음속 노트 처리 상태를 불러오지 못했습니다.",
    notSet: "설정되지 않음",
    notAvailable: "사용할 수 없음",
    rawJudgeFallback: "원본 판정 진단이 없습니다.",
    rawJudgeRawPrefix: "원본",
    rawJudgeStagePrefix: "단계",
    rawJudgeFinishPrefix: "종료",
    rawJudgeSchemaPrefix: "스키마",
    scoreDisplayedResonance: "표시된 공명도",
    scoreStoredCoreResonance: "저장된 핵심 공명도",
    scoreStoredImportance: "저장된 중요도",
    scoreFreshnessAdjustment: "최신성 보정",
    scoreContentTextContext: "내용/텍스트/맥락",
    scoreProcessingReflection: "처리/성찰",
    scoreRevisit: "다시 보기",
    scoreRelationship: "관계",
    scoreContextCounts: "맥락 수",
    scoreRelationshipNote: "관계 메모",
    scoreLinks: "연결",
    scoreAttachments: "첨부",
    scoreReflectionChars: "성찰 글자",
    summaryAriaLabel: "마음속 노트 처리 상태 요약",
    summarySignals: (count) => `신호 ${count}개`,
    summaryReady: (count) => `준비 ${count}개`,
    summaryWaiting: (count) => `대기 ${count}개`,
    summaryFailed: (count) => `실패 ${count}개`,
    tableAriaLabel: "마음속 노트 처리 행",
    headers: {
      saved: "저장됨",
      signal: "신호",
      cluster: "클러스터",
      scores: "점수",
      embedding: "임베딩",
      job: "작업",
      generated: "생성됨",
      why: "이유",
      rawJudgeLog: "원본 판정 기록",
    },
    loadingStatus: "상태를 불러오는 중...",
    noRecentSignals: "최근 신호가 없습니다.",
    unclassified: "분류되지 않음",
    resonance: "공명도",
    importance: "중요도",
    hideBreakdown: "세부 점수 숨기기",
    scoreBreakdown: "세부 점수",
    embedded: "임베딩됨",
    missing: "없음",
    noJob: "작업 없음",
    loadingScoreBreakdown: "세부 점수를 불러오는 중...",
    failedToLoadScoreBreakdown: "세부 점수를 불러오지 못했습니다.",
    jobStatuses: {
      pending: "대기 중",
      running: "실행 중",
      succeeded: "성공",
      failed: "실패",
    },
    debugReasonLabels: {
      linked_wow_ready: (row) => `생성됨 ${row.generatedWowMomentCount}개`,
      waiting_for_job: () => "작업 대기 중",
      missing_embedding: () => "임베딩 없음",
      job_failed: () => "작업 실패",
      no_generated_wow: () => "생성된 노트 없음",
      not_wow_judgment: () => "판정 결과 제외",
    },
    debugReasonDetails: {
      linked_wow_ready: (row) => `이 신호에 연결된 마음속 노트 ${row.generatedWowMomentCount}개가 있습니다.`,
      waiting_for_job: (row) => (row.job ? "처리 작업이 아직 완료되지 않았습니다." : "처리 작업이 아직 만들어지지 않았습니다."),
      missing_embedding: () => "이 신호의 임베딩이 아직 준비되지 않았습니다.",
      job_failed: () => "처리 작업이 실패했습니다. 다시 시도하거나 관리자 작업 오류를 확인하세요.",
      no_generated_wow: () => "이 신호에서 생성된 마음속 노트를 찾지 못했습니다.",
      not_wow_judgment: () => "판정 결과가 마음속 노트로 사용할 수 없는 형식입니다.",
    },
  },
};

function currentAdminLocale(preferredLocale: unknown): SupportedLocale {
  return normalizeSupportedLocale(preferredLocale ?? readStoredLocale());
}

function localizedErrorMessage(err: unknown, locale: SupportedLocale, fallback: string): string {
  if (locale === "en-US" && err instanceof Error) return err.message;
  if (err instanceof ApiError && err.status > 0) return `${fallback} (HTTP ${err.status})`;
  return fallback;
}

function formatDate(value: string | null | undefined, locale: SupportedLocale, copy: AdminWowStatusCopy): string {
  if (!value) return copy.notSet;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return copy.notSet;
  return date.toLocaleString(locale, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function rawJudgeLog(row: ApiWowStatusRow, copy: AdminWowStatusCopy): string {
  const parts = [
    row.debugReason.rawGeminiPreview ? `${copy.rawJudgeRawPrefix}: ${row.debugReason.rawGeminiPreview}` : "",
    row.debugReason.parseFailureStage ? `${copy.rawJudgeStagePrefix}: ${row.debugReason.parseFailureStage}` : "",
    row.debugReason.finishReason ? `${copy.rawJudgeFinishPrefix}: ${row.debugReason.finishReason}` : "",
    row.debugReason.schemaIssueSummary ? `${copy.rawJudgeSchemaPrefix}: ${row.debugReason.schemaIssueSummary}` : "",
  ].filter(Boolean);
  return parts.length > 0 ? parts.join("\n") : copy.rawJudgeFallback;
}

type ScoreBreakdownState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; breakdown: ApiInspirationScoreBreakdown };

function scoreValue(score: number | null, copy: AdminWowStatusCopy): string {
  return score === null ? copy.notAvailable : String(score);
}

function formatJobStatus(status: string, copy: AdminWowStatusCopy): string {
  return copy.jobStatuses[status] ?? status;
}

export function formatWowDebugReasonLabel(row: ApiWowStatusRow, locale: SupportedLocale): string {
  const copy = ADMIN_WOW_STATUS_COPY[locale];
  return copy.debugReasonLabels[row.debugReason.code]?.(row) ?? row.debugReason.label;
}

export function formatWowDebugReasonDetail(row: ApiWowStatusRow, locale: SupportedLocale): string {
  const copy = ADMIN_WOW_STATUS_COPY[locale];
  return copy.debugReasonDetails[row.debugReason.code]?.(row) ?? row.debugReason.detail;
}

function ScoreBreakdownGrid({
  breakdown,
  copy,
}: {
  breakdown: ApiInspirationScoreBreakdown;
  copy: AdminWowStatusCopy;
}): JSX.Element {
  return (
    <div className="admin-score-breakdown">
      <div>
        <span>{copy.scoreDisplayedResonance}</span>
        <strong>{breakdown.displayedWowScore}</strong>
      </div>
      <div>
        <span>{copy.scoreStoredCoreResonance}</span>
        <strong>{breakdown.persistedCoreWowScore}</strong>
      </div>
      <div>
        <span>{copy.scoreStoredImportance}</span>
        <strong>{breakdown.importanceScore}</strong>
      </div>
      <div>
        <span>{copy.scoreFreshnessAdjustment}</span>
        <strong>
          {breakdown.freshnessAdjustment.displayedMinusCore >= 0 ? "+" : ""}
          {breakdown.freshnessAdjustment.displayedMinusCore}
        </strong>
      </div>
      <div>
        <span>{copy.scoreContentTextContext}</span>
        <strong>{breakdown.factors.content.score}</strong>
      </div>
      <div>
        <span>{copy.scoreProcessingReflection}</span>
        <strong>{breakdown.factors.processing.score}</strong>
      </div>
      <div>
        <span>{copy.scoreRevisit}</span>
        <strong>{breakdown.factors.revisit.score}</strong>
      </div>
      <div>
        <span>{copy.scoreRelationship}</span>
        <strong>{scoreValue(breakdown.factors.relationship.score, copy)}</strong>
      </div>
      <div className="admin-score-breakdown-wide">
        <span>{copy.scoreContextCounts}</span>
        <strong>
          {breakdown.factors.content.meaningfulLinkCount} {copy.scoreLinks} ·{" "}
          {breakdown.factors.content.nonLinkAttachmentCount} {copy.scoreAttachments} ·{" "}
          {breakdown.factors.content.reflectionTextChars} {copy.scoreReflectionChars}
        </strong>
      </div>
      <div className="admin-score-breakdown-wide">
        <span>{copy.scoreRelationshipNote}</span>
        <strong>{breakdown.factors.relationship.note}</strong>
      </div>
    </div>
  );
}

export default function AdminWowStatusPage(): JSX.Element {
  const { user } = useAuth();
  const locale = currentAdminLocale(user?.preferredLocale);
  const copy = ADMIN_WOW_STATUS_COPY[locale];
  const [rows, setRows] = useState<ApiWowStatusRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedScoreId, setExpandedScoreId] = useState<string | null>(null);
  const [scoreBreakdowns, setScoreBreakdowns] = useState<Record<string, ScoreBreakdownState>>({});

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await fetchWowStatus(24));
    } catch (err) {
      setError(localizedErrorMessage(err, locale, copy.failedToLoad));
    } finally {
      setLoading(false);
    }
  }, [copy.failedToLoad, locale]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const toggleScoreBreakdown = useCallback((inspirationId: string) => {
    setExpandedScoreId((current) => (current === inspirationId ? null : inspirationId));
    setScoreBreakdowns((current) => {
      if (current[inspirationId]) return current;
      return { ...current, [inspirationId]: { status: "loading" } };
    });
    if (scoreBreakdowns[inspirationId]) return;
    void (async () => {
      try {
        const breakdown = await fetchInspirationScoreBreakdown(inspirationId);
        setScoreBreakdowns((current) => ({
          ...current,
          [inspirationId]: { status: "ready", breakdown },
        }));
      } catch (caught) {
        setScoreBreakdowns((current) => ({
          ...current,
          [inspirationId]: {
            status: "error",
            message: localizedErrorMessage(caught, locale, copy.failedToLoadScoreBreakdown),
          },
        }));
      }
    })();
  }, [copy.failedToLoadScoreBreakdown, locale, scoreBreakdowns]);

  const summary = useMemo(
    () => ({
      inspirations: rows.length,
      ready: rows.filter((row) => row.debugReason.code === "linked_wow_ready").length,
      waiting: rows.filter((row) => row.debugReason.code === "waiting_for_job").length,
      failed: rows.filter((row) => row.debugReason.code === "job_failed").length,
    }),
    [rows],
  );

  return (
    <main className="admin-page" data-locale={locale}>
      <header className="admin-page-header admin-page-header--row">
        <div>
          <Link to="/admin" className="admin-back-link">{copy.backLink}</Link>
          <span>{copy.eyebrow}</span>
          <h1>{copy.title}</h1>
          <p>{copy.intro}</p>
        </div>
        <button type="button" onClick={() => void refresh()} disabled={loading}>
          {loading ? copy.refreshing : copy.refresh}
        </button>
      </header>

      <section className="admin-summary-row" aria-label={copy.summaryAriaLabel}>
        <span>{copy.summarySignals(summary.inspirations)}</span>
        <span>{copy.summaryReady(summary.ready)}</span>
        <span>{copy.summaryWaiting(summary.waiting)}</span>
        <span>{copy.summaryFailed(summary.failed)}</span>
      </section>

      {error ? <p className="admin-error">{error}</p> : null}

      <section className="admin-table-card" aria-label={copy.tableAriaLabel}>
        <div className="admin-table-scroll">
          <table>
            <thead>
              <tr>
                <th>{copy.headers.saved}</th>
                <th>{copy.headers.signal}</th>
                <th>{copy.headers.cluster}</th>
                <th>{copy.headers.scores}</th>
                <th>{copy.headers.embedding}</th>
                <th>{copy.headers.job}</th>
                <th>{copy.headers.generated}</th>
                <th>{copy.headers.why}</th>
                <th>{copy.headers.rawJudgeLog}</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={9}>{loading ? copy.loadingStatus : copy.noRecentSignals}</td>
                </tr>
              ) : (
                rows.map((row) => {
                  const scoreState = scoreBreakdowns[row.inspiration.id];
                  const scoreExpanded = expandedScoreId === row.inspiration.id;
                  return (
                    <Fragment key={row.inspiration.id}>
                      <tr>
                        <td>{formatDate(row.inspiration.createdAt, locale, copy)}</td>
                        <td>{row.inspiration.textPreview}</td>
                        <td>{row.inspiration.cluster ?? copy.unclassified}</td>
                        <td>
                          <strong>{copy.resonance} {row.inspiration.wowScore}</strong>
                          <span>{copy.importance} {row.inspiration.importanceScore}</span>
                          <button
                            type="button"
                            className="admin-inline-button"
                            onClick={() => toggleScoreBreakdown(row.inspiration.id)}
                          >
                            {scoreExpanded ? copy.hideBreakdown : copy.scoreBreakdown}
                          </button>
                        </td>
                        <td>{row.embedded ? copy.embedded : copy.missing}</td>
                        <td>
                          {row.job ? (
                            <>
                              <strong>{formatJobStatus(row.job.status, copy)}</strong>
                              <span>{formatDate(row.job.updatedAt, locale, copy)}</span>
                            </>
                          ) : (
                            copy.noJob
                          )}
                        </td>
                        <td>{row.generatedWowMomentCount}</td>
                        <td>
                          <strong>{formatWowDebugReasonLabel(row, locale)}</strong>
                          <span>{formatWowDebugReasonDetail(row, locale)}</span>
                        </td>
                        <td>
                          <pre>{rawJudgeLog(row, copy)}</pre>
                        </td>
                      </tr>
                      {scoreExpanded ? (
                        <tr key={`${row.inspiration.id}-score-breakdown`}>
                          <td colSpan={9}>
                            {scoreState?.status === "ready" ? (
                              <ScoreBreakdownGrid breakdown={scoreState.breakdown} copy={copy} />
                            ) : scoreState?.status === "error" ? (
                              <p className="admin-error">{scoreState.message}</p>
                            ) : (
                              copy.loadingScoreBreakdown
                            )}
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
