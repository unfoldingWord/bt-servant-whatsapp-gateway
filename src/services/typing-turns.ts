/**
 * Per-turn memory for the WhatsApp typing indicator.
 *
 * The gateway sends the inbound WhatsApp message id as `message_key`, and the
 * worker echoes that same id on every callback. The indicator is addressed by
 * that id, so no separate lookup is required.
 *
 * State is in-memory for this isolate, same as complete-callback dedup.
 * A late status that lands on another isolate can still refresh typing once.
 */

/** Meta dismisses the indicator after 25s. Refresh well inside that, at most every 10s. */
const RENEW_INTERVAL_MS = 10_000;

/** Forget a turn after an hour so the map cannot grow without bound. */
const TURN_TTL_MS = 3_600_000;

const SWEEP_INTERVAL_MS = 60_000;

interface TypingTurn {
  lastSentAt: number;
  finished: boolean;
  expiresAt: number;
}

const turns = new Map<string, TypingTurn>();
let lastSweepAt = 0;

export type TypingSkipReason = 'finished' | 'throttled';

export interface TypingClaim {
  previousSentAt: number;
}

/** Inbound message id carried on the callback, or null when it is blank. */
export function inboundMessageId(messageKey: string): string | null {
  const id = messageKey.trim();
  return id.length > 0 ? id : null;
}

function sweep(current: number): void {
  if (current - lastSweepAt < SWEEP_INTERVAL_MS) return;
  lastSweepAt = current;
  for (const [key, turn] of turns) {
    if (turn.expiresAt <= current) turns.delete(key);
  }
}

function liveTurn(messageId: string, current: number): TypingTurn | undefined {
  sweep(current);
  const turn = turns.get(messageId);
  if (!turn || turn.expiresAt <= current) {
    if (turn) turns.delete(messageId);
    return undefined;
  }
  return turn;
}

/**
 * Reserve the next indicator send. The caller must `releaseTypingClaim` when
 * the Cloud API call fails so a later status can try again.
 */
export function claimTypingSend(messageId: string): TypingClaim | TypingSkipReason {
  const current = Date.now();
  const turn = liveTurn(messageId, current);
  if (turn?.finished) return 'finished';
  if (turn && turn.lastSentAt > 0 && current - turn.lastSentAt < RENEW_INTERVAL_MS) {
    return 'throttled';
  }
  const previousSentAt = turn?.lastSentAt ?? 0;
  const next: TypingTurn = turn ?? { lastSentAt: 0, finished: false, expiresAt: 0 };
  next.lastSentAt = current;
  next.expiresAt = current + TURN_TTL_MS;
  turns.set(messageId, next);
  return { previousSentAt };
}

export function releaseTypingClaim(messageId: string, previousSentAt: number): void {
  const turn = turns.get(messageId);
  if (!turn || turn.finished) return;
  turn.lastSentAt = previousSentAt;
}

/** Remember a successful indicator, including the one sent when the message arrives. */
export function recordTypingSent(messageId: string): void {
  const current = Date.now();
  const existing = liveTurn(messageId, current);
  if (existing?.finished) return;
  const turn: TypingTurn = existing ?? { lastSentAt: 0, finished: false, expiresAt: 0 };
  turn.lastSentAt = current;
  turn.expiresAt = current + TURN_TTL_MS;
  turns.set(messageId, turn);
}

/** Stop renewing once the turn's answer or error is accepted. */
export function finishTypingTurn(messageId: string): void {
  const current = Date.now();
  const existing = liveTurn(messageId, current);
  const turn: TypingTurn = existing ?? { lastSentAt: 0, finished: false, expiresAt: 0 };
  turn.finished = true;
  turn.expiresAt = current + TURN_TTL_MS;
  turns.set(messageId, turn);
}
