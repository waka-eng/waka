import type { BackgroundJobType } from '../db/schema-background-jobs.js';

const jobLabels = {
  enrich_attachment: 'Read an attachment',
  derive_signals: 'Find patterns in a saved inspiration',
  review_signal_support: 'Review pattern evidence',
  assess_signal_support: 'Assess pattern evidence',
  refresh_top_of_mind: 'Refresh Top of Mind',
  refresh_group_top_of_mind: 'Refresh group Top of Mind',
  refresh_principles: 'Generate principles',
  reembed_signal: 'Update a pattern embedding',
  tend_signal_garden: 'Maintain patterns',
  generate_reflection_question: 'Generate a reflection question',
  generate_review_question: 'Generate a review question',
  generate_conversation_reply: 'Generate a chat reply',
  derive_review_answer: 'Process a review answer',
  index_embedding: 'Index an embedding',
} satisfies Record<BackgroundJobType, string>;

const reasons = {
  permanent: 'The worker classified this error as permanent. Inspect the cause before retrying.',
  ambiguous: 'Automatic replay stopped because the outcome is uncertain. Check the last attempt before retrying.',
  exhausted: 'The automatic retry allowance was exhausted. Inspect the last attempt.',
  review: 'This earlier failure needs operator review before replay.',
};

export interface JobFailureNotice {
  source: 'waka.job-failure.v1';
  reference: string;
  jobType: BackgroundJobType;
  disposition: keyof typeof reasons;
  timestamp: number;
}

/** All Discord text is built here from closed fields. Never accept an error
 * message, an account identifier, a job payload, or a caller-supplied URL. */
export function readJobFailureNotice(raw: unknown): JobFailureNotice | null {
  if (!raw || typeof raw !== 'object') return null;
  const n = raw as Record<string, unknown>;
  if (Object.keys(n).length !== 5 || n.source !== 'waka.job-failure.v1' ||
      typeof n.reference !== 'string' || !/^[a-f0-9]{64}$/.test(n.reference) ||
      typeof n.jobType !== 'string' || !Object.hasOwn(jobLabels, n.jobType) ||
      typeof n.disposition !== 'string' || !Object.hasOwn(reasons, n.disposition) ||
      typeof n.timestamp !== 'number' || !Number.isSafeInteger(n.timestamp) ||
      n.timestamp <= 0 || n.timestamp > Date.now() + 300_000) return null;
  return n as unknown as JobFailureNotice;
}

export function jobFailureDiscordPayload(notice: JobFailureNotice) {
  return {
    allowed_mentions: { parse: [] },
    content: [
      'WAKA production · Background job needs attention',
      jobLabels[notice.jobType], reasons[notice.disposition],
      new Date(notice.timestamp).toISOString(),
      'Worker log reference: ' + notice.reference,
    ].join('\n'),
  };
}
