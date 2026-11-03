import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import app from '../../src/index';
import { handleEngineCallback, handleWebhook } from '../../src/services/message-handler';
import type { Env } from '../../src/config/types';
import type { EngineCallback } from '../../src/types/engine';
import type { WebhookPayload } from '../../src/types/meta';

const mockEnv: Env = {
  META_VERIFY_TOKEN: 'test-verify-token',
  META_WHATSAPP_TOKEN: 'test-whatsapp-token',
  META_PHONE_NUMBER_ID: '123456789',
  META_APP_SECRET: 'test-app-secret',
  ENGINE_API_KEY: 'test-engine-key',
  ENGINE_BASE_URL: 'http://localhost:8787',
  ENGINE_ORG: 'test-org',
  ENVIRONMENT: 'test',
  CHUNK_SIZE: '1500',
  MESSAGE_AGE_CUTOFF_SECONDS: '3600',
  PROGRESS_THROTTLE_SECONDS: '3.0',
  FACEBOOK_USER_AGENT: 'facebookexternalua',
  GATEWAY_PUBLIC_URL: 'https://gateway.example.com',
};

function callback(
  overrides: Partial<EngineCallback> & Pick<EngineCallback, 'type'>
): EngineCallback {
  return {
    user_id: '15551230000',
    message_key: 'wamid.turn',
    timestamp: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function postedBodies(fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown>[] {
  const bodies: Record<string, unknown>[] = [];
  for (const call of fetchMock.mock.calls) {
    const raw = call[1]?.body;
    if (typeof raw !== 'string') continue;
    bodies.push(JSON.parse(raw) as Record<string, unknown>);
  }
  return bodies;
}

function typingBodies(fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown>[] {
  return postedBodies(fetchMock).filter((body) => body.typing_indicator !== undefined);
}

function textBodies(fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown>[] {
  return postedBodies(fetchMock).filter((body) => body.type === 'text');
}

function metaOk(): { ok: true; json: () => Promise<unknown>; text: () => Promise<string> } {
  return { ok: true, json: async () => ({ success: true }), text: async () => '' };
}

function inboundPayload(messageId: string): WebhookPayload {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'entry-1',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: {
                display_phone_number: '+15555550000',
                phone_number_id: '123456789',
              },
              contacts: [{ profile: { name: 'Translator' }, wa_id: '15551230000' }],
              messages: [
                {
                  id: messageId,
                  from: '15551230000',
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  type: 'text',
                  text: { body: 'What does this verse mean?' },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

describe('typing indicator on engine status callbacks', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(metaOk());
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  it('sends a typing indicator for that turn and no chat message', async () => {
    await handleEngineCallback(
      callback({
        type: 'status',
        message_key: 'wamid.turn-alpha',
        message: 'Looking up the article',
      }),
      mockEnv
    );

    expect(typingBodies(fetchMock)).toEqual([
      {
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: 'wamid.turn-alpha',
        typing_indicator: { type: 'text' },
      },
    ]);
    expect(textBodies(fetchMock)).toEqual([]);
  });

  it('keeps two turns apart when their status callbacks interleave', async () => {
    await handleEngineCallback(
      callback({ type: 'status', message_key: 'wamid.chat-one', message: 'Working' }),
      mockEnv
    );
    await handleEngineCallback(
      callback({ type: 'status', message_key: 'wamid.chat-two', message: 'Working' }),
      mockEnv
    );

    expect(typingBodies(fetchMock).map((body) => body.message_id)).toEqual([
      'wamid.chat-one',
      'wamid.chat-two',
    ]);
  });

  it('sends at most one typing indicator per turn every 10 seconds', async () => {
    const status = callback({
      type: 'status',
      message_key: 'wamid.throttle',
      message: 'Still working',
    });

    await handleEngineCallback(status, mockEnv);
    await handleEngineCallback(status, mockEnv);
    vi.setSystemTime(new Date('2026-01-01T00:00:09.999Z'));
    await handleEngineCallback(status, mockEnv);
    expect(typingBodies(fetchMock)).toHaveLength(1);

    vi.setSystemTime(new Date('2026-01-01T00:00:10.000Z'));
    await handleEngineCallback(status, mockEnv);
    expect(typingBodies(fetchMock)).toHaveLength(2);
    expect(textBodies(fetchMock)).toEqual([]);
  });

  it('counts the indicator sent on arrival toward the 10 second limit', async () => {
    const messageId = 'wamid.inbound-throttle';
    await handleWebhook(inboundPayload(messageId), mockEnv);
    expect(typingBodies(fetchMock)).toHaveLength(1);

    await handleEngineCallback(
      callback({ type: 'status', message_key: messageId, message: 'Fetching a source' }),
      mockEnv
    );
    expect(typingBodies(fetchMock)).toHaveLength(1);

    vi.setSystemTime(new Date('2026-01-01T00:00:10.000Z'));
    await handleEngineCallback(
      callback({ type: 'status', message_key: messageId, message: 'Still fetching' }),
      mockEnv
    );
    expect(typingBodies(fetchMock)).toHaveLength(2);
  });

  it('does not renew typing after the turn completes', async () => {
    const messageKey = 'wamid.after-complete';
    await handleEngineCallback(
      callback({ type: 'status', message_key: messageKey, message: 'Working' }),
      mockEnv
    );
    await handleEngineCallback(
      callback({ type: 'complete', message_key: messageKey, text: 'Here is the draft.' }),
      mockEnv
    );
    vi.setSystemTime(new Date('2026-01-01T00:00:30.000Z'));
    await handleEngineCallback(
      callback({ type: 'status', message_key: messageKey, message: 'Late status' }),
      mockEnv
    );

    expect(typingBodies(fetchMock)).toHaveLength(1);
    expect(textBodies(fetchMock)).toEqual([
      {
        messaging_product: 'whatsapp',
        to: '15551230000',
        type: 'text',
        text: { body: 'Here is the draft.' },
      },
    ]);
  });

  it('does not renew typing after the turn errors', async () => {
    const messageKey = 'wamid.after-error';
    await handleEngineCallback(
      callback({ type: 'status', message_key: messageKey, message: 'Working' }),
      mockEnv
    );
    await handleEngineCallback(
      callback({ type: 'error', message_key: messageKey, error: 'model failed' }),
      mockEnv
    );
    vi.setSystemTime(new Date('2026-01-01T00:00:30.000Z'));
    await handleEngineCallback(
      callback({ type: 'status', message_key: messageKey, message: 'Late status' }),
      mockEnv
    );

    expect(typingBodies(fetchMock)).toHaveLength(1);
    expect(textBodies(fetchMock)).toEqual([
      {
        messaging_product: 'whatsapp',
        to: '15551230000',
        type: 'text',
        text: { body: 'Sorry, I encountered an error processing your message. Please try again.' },
      },
    ]);
  });

  it('logs and skips a status callback with no inbound message id', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await handleEngineCallback(
      callback({ type: 'status', message_key: '   ', message: 'nowhere' }),
      mockEnv
    );

    expect(fetchMock).not.toHaveBeenCalled();
    const logged = logSpy.mock.calls.map((call) => String(call[0])).join('\n');
    expect(logged).toContain('no inbound message id');
    expect(errorSpy).not.toHaveBeenCalled();
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('logs a failed typing call and still delivers the final message', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchMock.mockReset();
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'meta down' })
      .mockResolvedValueOnce(metaOk());

    await expect(
      handleEngineCallback(
        callback({ type: 'status', message_key: 'wamid.typing-fails', message: 'Working' }),
        mockEnv
      )
    ).resolves.toBeUndefined();

    const logged = errorSpy.mock.calls.map((call) => String(call[0])).join('\n');
    expect(logged).toContain('Failed to send typing indicator');

    await handleEngineCallback(
      callback({ type: 'complete', message_key: 'wamid.typing-fails', text: 'The answer.' }),
      mockEnv
    );

    expect(textBodies(fetchMock)).toEqual([
      {
        messaging_product: 'whatsapp',
        to: '15551230000',
        type: 'text',
        text: { body: 'The answer.' },
      },
    ]);
    errorSpy.mockRestore();
  });

  it('logs a thrown typing call without rejecting the callback', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchMock.mockReset();
    fetchMock.mockRejectedValueOnce(new Error('network down'));

    await expect(
      handleEngineCallback(
        callback({ type: 'status', message_key: 'wamid.typing-throws', message: 'Working' }),
        mockEnv
      )
    ).resolves.toBeUndefined();

    const logged = errorSpy.mock.calls.map((call) => String(call[0])).join('\n');
    expect(logged).toContain('Failed to send typing indicator');
    errorSpy.mockRestore();
  });

  it('still relays progress text and does not mark the turn finished', async () => {
    const messageKey = 'wamid.progress-unchanged';
    await handleEngineCallback(
      callback({ type: 'progress', message_key: messageKey, text: 'Drafting Genesis 1.' }),
      mockEnv
    );
    vi.setSystemTime(new Date('2026-01-01T00:00:10.000Z'));
    await handleEngineCallback(
      callback({ type: 'status', message_key: messageKey, message: 'Checking the draft' }),
      mockEnv
    );

    expect(textBodies(fetchMock)).toEqual([
      {
        messaging_product: 'whatsapp',
        to: '15551230000',
        type: 'text',
        text: { body: 'Drafting Genesis 1.' },
      },
    ]);
    expect(typingBodies(fetchMock)).toEqual([
      {
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageKey,
        typing_indicator: { type: 'text' },
      },
    ]);
  });

  it('still sends only the final answer on complete', async () => {
    await handleEngineCallback(
      callback({ type: 'complete', message_key: 'wamid.complete-unchanged', text: 'Final only.' }),
      mockEnv
    );

    expect(typingBodies(fetchMock)).toEqual([]);
    expect(textBodies(fetchMock)).toEqual([
      {
        messaging_product: 'whatsapp',
        to: '15551230000',
        type: 'text',
        text: { body: 'Final only.' },
      },
    ]);
  });
});

describe('POST /progress-callback typing failures', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(metaOk());
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('answers 200 when the typing call fails and a later status does not restart after complete', async () => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => 'meta down' });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const headers = {
      'Content-Type': 'application/json',
      'X-Engine-Token': env.ENGINE_API_KEY,
    };
    const statusBody = JSON.stringify({
      type: 'status',
      user_id: '15551230000',
      message_key: 'wamid.route-typing',
      message: 'Working',
      timestamp: '2026-01-01T00:00:00.000Z',
    });

    const ctx = createExecutionContext();
    const response = await app.fetch(
      new Request('http://localhost/progress-callback', {
        method: 'POST',
        headers,
        body: statusBody,
      }),
      env,
      ctx
    );
    expect(response.status).toBe(200);
    await waitOnExecutionContext(ctx);
    expect(errorSpy.mock.calls.map((call) => String(call[0])).join('\n')).toContain(
      'Failed to send typing indicator'
    );

    fetchMock.mockReset();
    fetchMock.mockResolvedValue(metaOk());
    const completeCtx = createExecutionContext();
    const complete = await app.fetch(
      new Request('http://localhost/progress-callback', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          type: 'complete',
          user_id: '15551230000',
          message_key: 'wamid.route-typing',
          text: 'Done.',
          timestamp: '2026-01-01T00:00:20.000Z',
        }),
      }),
      env,
      completeCtx
    );
    expect(complete.status).toBe(200);

    const lateCtx = createExecutionContext();
    const late = await app.fetch(
      new Request('http://localhost/progress-callback', {
        method: 'POST',
        headers,
        body: statusBody,
      }),
      env,
      lateCtx
    );
    expect(late.status).toBe(200);
    await waitOnExecutionContext(completeCtx);
    await waitOnExecutionContext(lateCtx);

    expect(typingBodies(fetchMock)).toEqual([]);
    expect(textBodies(fetchMock)).toEqual([
      {
        messaging_product: 'whatsapp',
        to: '15551230000',
        type: 'text',
        text: { body: 'Done.' },
      },
    ]);
    errorSpy.mockRestore();
  });
});
