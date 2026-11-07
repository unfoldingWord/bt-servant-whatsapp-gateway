/**
 * Per-turn memory for the WhatsApp typing indicator.
 *
 * The gateway sends the inbound WhatsApp message id as `message_key`, and the
 * worker echoes that same id on every callback. The indicator is addressed by
 * that id, so no separate lookup is required.
 *
 * State is in-memory for this isolate, same as complete-callback dedup.
 * A late status that lands on another isolate can still refresh typing once.
 * After an hour the entry is dropped, finished marker included, so a status
 * that late can refresh once in this isolate too. That is the same hour
 * complete-callback dedup already accepts. Keeping finished ids past it
 * would let the map grow without a bound.
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
const inflight = new Map<string, AbortController>();
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

/**
 * Signal for the Cloud API call. A newer send aborts the previous one, and
 * finishing the turn aborts whichever call is still current.
 */
export function openTypingSend(messageId: string): AbortSignal {
  const previous = inflight.get(messageId);
  const controller = new AbortController();
  inflight.set(messageId, controller);
  previous?.abort();
  return controller.signal;
}

/** Drop the signal after the call settles, so a later finish does not abort it. */
export function closeTypingSend(messageId: string, signal: AbortSignal): void {
  const current = inflight.get(messageId);
  if (current?.signal === signal) inflight.delete(messageId);
}

/** True when complete or error already accepted this turn. */
export function typingTurnFinished(messageId: string): boolean {
  return turns.get(messageId)?.finished === true;
}

/** Turn state without sweeping. Tests use this to see that sweep removed other keys. */
export function typingTurnRecord(messageId: string): 'open' | 'finished' | 'absent' {
  const turn = turns.get(messageId);
  if (!turn) return 'absent';
  return turn.finished ? 'finished' : 'open';
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
  abortTypingSend(messageId);
}

function abortTypingSend(messageId: string): void {
  const pending = inflight.get(messageId);
  if (!pending) return;
  inflight.delete(messageId);
  pending.abort();
}
