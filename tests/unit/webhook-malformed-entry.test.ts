import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleWebhook } from '../../src/services/message-handler';
import type { Env } from '../../src/config/types';
import type { WebhookPayload, RawMessage, Contact } from '../../src/types/meta';

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

function nowTimestamp(): string {
  return String(Math.floor(Date.now() / 1000));
}

function textMessage(overrides: Partial<RawMessage> = {}): RawMessage {
  return {
    id: 'wamid.good-1',
    from: '5715550001',
    timestamp: nowTimestamp(),
    type: 'text',
    text: { body: 'hello' },
    ...overrides,
  };
}

function payloadWith(messages: RawMessage[], contacts: Contact[] = []): WebhookPayload {
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
              contacts,
              messages,
            },
          },
        ],
      },
    ],
  };
}

function metaOk(): { ok: true; json: () => Promise<unknown> } {
  return { ok: true, json: async () => ({ messages: [{ id: 'wamid.sent' }] }) };
}

function engineOk(): { ok: true; json: () => Promise<unknown> } {
  return { ok: true, json: async () => ({ message_id: 'engine-msg-1' }) };
}

function parsedCalls(spy: ReturnType<typeof vi.spyOn>): Record<string, unknown>[] {
  return spy.mock.calls.map((c) => JSON.parse(c[0] as string) as Record<string, unknown>);
}

describe('handleWebhook with malformed message entries (issue #41)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    errorSpy.mockRestore();
    warnSpy.mockRestore();
    logSpy.mockRestore();
  });

  it('processes the well-formed message and logs one diagnostic when a batch contains a sender-less entry', async () => {
    // Entry with neither contacts[0].wa_id nor from — as seen in production.
    const malformed = {
      id: 'wamid.malformed-1',
      timestamp: nowTimestamp(),
      type: 'text',
    } as RawMessage;

    fetchMock.mockResolvedValueOnce(metaOk()).mockResolvedValueOnce(engineOk());

    await handleWebhook(payloadWith([malformed, textMessage()]), mockEnv);

    // Typing indicator + engine send for the good message only.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const engineBody = JSON.parse(fetchMock.mock.calls[1][1]?.body as string) as Record<
      string,
      unknown
    >;
    expect(engineBody.user_id).toBe('5715550001');
    expect(engineBody.message).toBe('hello');

    const errors = parsedCalls(errorSpy);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toBe('Message entry has no sender id');
    expect(errors[0].messageId).toBe('wamid.malformed-1');
    expect(errors[0].rawKeys).toEqual(['id', 'timestamp', 'type']);
    expect(errors[0].contactsCount).toBe(0);
  });

  it('logs payload shape without message body content for sender-less entries', async () => {
    const malformed = {
      id: 'wamid.malformed-2',
      timestamp: nowTimestamp(),
      type: 'text',
      text: { body: 'sensitive content' },
    } as RawMessage;

    await handleWebhook(
      payloadWith([malformed], [{ profile: { name: 'Someone' } } as unknown as Contact]),
      mockEnv
    );

    const errors = parsedCalls(errorSpy);
    expect(errors).toHaveLength(1);
    expect(errors[0].rawKeys).toEqual(['id', 'timestamp', 'type', 'text']);
    expect(errors[0].contactsCount).toBe(1);
    expect(errors[0].contactsShapes).toEqual([['profile']]);
    expect(JSON.stringify(errors[0])).not.toContain('sensitive content');
  });

  it('continues the batch when processing one message throws mid-flight', async () => {
    // First message's typing-indicator fetch rejects; second message succeeds.
    fetchMock
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(metaOk())
      .mockResolvedValueOnce(engineOk());

    const first = textMessage({ id: 'wamid.throws-1', from: '5715550002' });
    const second = textMessage({ id: 'wamid.good-2' });

    await handleWebhook(payloadWith([first, second]), mockEnv);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const engineBody = JSON.parse(fetchMock.mock.calls[2][1]?.body as string) as Record<
      string,
      unknown
    >;
    expect(engineBody.user_id).toBe('5715550001');

    const errors = parsedCalls(errorSpy);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toBe('Error processing message entry');
    expect(errors[0].error).toBe('network down');
    expect(errors[0].messageId).toBe('wamid.throws-1');
    expect(errors[0].userId).toBe('57155500...');
  });

  it('includes sender context in the unsupported message type warn', async () => {
    const sticker = textMessage({ id: 'wamid.sticker-1', type: 'sticker' });
    delete sticker.text;

    await handleWebhook(payloadWith([sticker]), mockEnv);

    const warns = parsedCalls(warnSpy);
    expect(warns).toHaveLength(1);
    expect(warns[0].message).toBe('Unsupported message type');
    expect(warns[0].type).toBe('sticker');
    expect(warns[0].messageId).toBe('wamid.sticker-1');
    expect(warns[0].userId).toBe('57155500...');
  });
});
