import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  claimTypingSend,
  closeTypingSend,
  finishTypingTurn,
  inboundMessageId,
  openTypingSend,
  recordTypingSent,
  releaseTypingClaim,
  typingTurnRecord,
} from '../../src/services/typing-turns';

const HOUR_MS = 3_600_000;

describe('typing turn memory', () => {
  let now = Date.parse('2026-06-01T00:00:00.000Z');

  beforeEach(() => {
    vi.useFakeTimers();
    now += HOUR_MS * 2;
    vi.setSystemTime(now);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reads the inbound id and rejects a blank key', () => {
    expect(inboundMessageId('  wamid.turn  ')).toBe('wamid.turn');
    expect(inboundMessageId('   ')).toBeNull();
  });

  it('claims once and throttles a second claim inside 10 seconds', () => {
    expect(claimTypingSend('wamid.claim')).toEqual({ previousSentAt: 0 });
    expect(claimTypingSend('wamid.claim')).toBe('throttled');

    vi.setSystemTime(now + 10_000);
    const again = claimTypingSend('wamid.claim');
    expect(again).toEqual({ previousSentAt: now });
  });

  it('releases a failed claim so the next status can try at once', () => {
    const claim = claimTypingSend('wamid.release');
    expect(claim).toEqual({ previousSentAt: 0 });
    expect(claimTypingSend('wamid.release')).toBe('throttled');

    releaseTypingClaim('wamid.release', 0);
    expect(claimTypingSend('wamid.release')).toEqual({ previousSentAt: 0 });
  });

  it('does not reopen a finished turn when the failed claim is released', () => {
    claimTypingSend('wamid.release-finished');
    finishTypingTurn('wamid.release-finished');
    releaseTypingClaim('wamid.release-finished', 0);

    expect(claimTypingSend('wamid.release-finished')).toBe('finished');
  });

  it('blocks a claim after finish even when the turn was never claimed', () => {
    finishTypingTurn('wamid.finish-fresh');
    expect(claimTypingSend('wamid.finish-fresh')).toBe('finished');
  });

  it('counts a recorded inbound indicator toward the throttle', () => {
    recordTypingSent('wamid.recorded');
    expect(claimTypingSend('wamid.recorded')).toBe('throttled');
  });

  it('aborts an in-flight send when the turn finishes', () => {
    const signal = openTypingSend('wamid.abort');
    expect(signal.aborted).toBe(false);
    finishTypingTurn('wamid.abort');
    expect(signal.aborted).toBe(true);
  });

  it('leaves a settled send alone when the turn finishes afterwards', () => {
    const signal = openTypingSend('wamid.closed');
    closeTypingSend('wamid.closed', signal);
    finishTypingTurn('wamid.closed');
    expect(signal.aborted).toBe(false);
  });

  it('sweeps expired turns other than the one this call touches', () => {
    finishTypingTurn('wamid.sweep-a');
    finishTypingTurn('wamid.sweep-b');
    expect(typingTurnRecord('wamid.sweep-b')).toBe('finished');

    vi.setSystemTime(now + HOUR_MS);
    claimTypingSend('wamid.sweep-probe');

    expect(typingTurnRecord('wamid.sweep-a')).toBe('absent');
    expect(typingTurnRecord('wamid.sweep-b')).toBe('absent');
  });

  it('forgets a finished turn an hour later, same bound as complete dedup', () => {
    finishTypingTurn('wamid.expired');
    expect(claimTypingSend('wamid.expired')).toBe('finished');

    vi.setSystemTime(now + HOUR_MS);
    expect(claimTypingSend('wamid.expired')).toEqual({ previousSentAt: 0 });
  });
});
