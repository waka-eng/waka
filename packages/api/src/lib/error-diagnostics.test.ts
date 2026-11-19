/** Real Drizzle wrapper, synthetic values. No database or network. */
import { DrizzleQueryError } from 'drizzle-orm/errors';
import { expect, it } from 'vitest';
import { databaseSqlState, safeErrorDiagnostic } from './error-diagnostics.js';

it('unwraps a vetted PostgreSQL conflict without copying the wrapper or driver message', () => {
  const detail = Object.assign(new Error('synthetic driver detail'), {
    code: '23505', constraint_name: 'profiles_public_handle_unique_idx',
  });
  const wrapped = new Error('synthetic outer detail', {
    cause: new DrizzleQueryError('SELECT $1', ['synthetic-bound-value'], detail),
  });
  expect(databaseSqlState(wrapped)).toBe('23505');
  expect(safeErrorDiagnostic(wrapped)).toEqual({
    category: 'database', code: '23505', constraint: 'public_handle',
  });
});

it('does not return caller-provided constraint, code or message text', () => {
  const wrapped = new DrizzleQueryError('SELECT $1', ['synthetic-bound-value'],
    Object.assign(new Error('synthetic driver detail'), { code: '23505', constraint_name: 'private-label' }));
  expect(safeErrorDiagnostic(wrapped)).toEqual({ category: 'database', code: '23505' });
  const unfamiliar = new DrizzleQueryError('SELECT $1', ['synthetic-bound-value'],
    Object.assign(new Error('synthetic driver detail'), { code: 'ABCDE' }));
  expect(safeErrorDiagnostic(unfamiliar)).toEqual({ category: 'database' });
  expect(safeErrorDiagnostic('synthetic secret')).toEqual({ category: 'unexpected' });
  const cycle = new Error('cycle');
  cycle.cause = cycle;
  expect(safeErrorDiagnostic(cycle)).toEqual({ category: 'unexpected' });
});
