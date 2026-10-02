/** A deliberate wait returns its attempt; it is not a failed model call. */
export class BackgroundJobHeldError extends Error {
  constructor(readonly heldUntil: Date, message: string, readonly reason: 'support' | 'cadence' = 'support') {
    super(message); this.name = 'BackgroundJobHeldError';
  }
}
