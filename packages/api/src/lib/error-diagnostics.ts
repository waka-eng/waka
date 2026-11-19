import { DrizzleQueryError } from 'drizzle-orm/errors';

const sqlStates = new Set([
  '08000', '08001', '08003', '08004', '08006', '08P01',
  '22001', '22003', '22P02', '23502', '23503', '23505', '23514', '23P01',
  '40001', '40P01', '42501', '42703', '42P01', '53300', '55P03', '57014', '57P01', '57P03', 'P0001',
]);
const constraints = new Map([
  ['accounts_email_unique_idx', 'account_email'],
  ['accounts_google_sub_unique_idx', 'google_identity'],
  ['profiles_public_handle_unique_idx', 'public_handle'],
] as const);
const systemCodes = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'ENOTFOUND', 'EAI_AGAIN', 'CONNECT_TIMEOUT', 'CONNECTION_CLOSED']);

type Failure = { category: 'database' | 'transport' | 'unexpected'; code?: string; constraint?: string };

/** Only fixed diagnostic values may cross a logger or persistence boundary.
 * Drizzle puts a SQL statement and its values in the wrapper message. Both
 * that message and the PostgreSQL detail/cause can contain user data. */
export function safeErrorDiagnostic(error: unknown): Failure {
  let current = error;
  let database = false;
  let transport: string | undefined;
  for (let depth = 0; depth < 6 && current && typeof current === 'object'; depth++) {
    try {
      database ||= current instanceof DrizzleQueryError;
      const next = current as { code?: unknown; constraint_name?: unknown; constraint?: unknown; cause?: unknown };
      const code = next.code;
      if (typeof code === 'string' && sqlStates.has(code)) {
        const identifier = next.constraint_name ?? next.constraint;
        const constraint = typeof identifier === 'string'
          ? (constraints as ReadonlyMap<string, string>).get(identifier) : undefined;
        return { category: 'database', code, ...(constraint ? { constraint } : {}) };
      }
      if (typeof code === 'string' && systemCodes.has(code)) transport = code;
      current = next.cause;
    } catch {
      break;
    }
  }
  if (database) return { category: 'database', ...(transport ? { code: transport } : {}) };
  if (transport) return { category: 'transport', code: transport };
  return { category: 'unexpected' };
}

export function databaseSqlState(error: unknown): string | undefined {
  const failure = safeErrorDiagnostic(error);
  return failure.category === 'database' && failure.code && sqlStates.has(failure.code) ? failure.code : undefined;
}
