import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleWebhook, handleEngineCallback } from '../../src/services/message-handler';
import {
  sendTextMessage,
  sendImageMessage,
  sendDocumentMessage,
  sendAudioById,
} from '../../src/services/meta-api/client';
import type { Env } from '../../src/config/types';
import type { EngineCallback } from '../../src/types/engine';
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

const BSUID = 'CO.11102000000000000673';

function nowTimestamp(): string {
  return String(Math.floor(Date.now() / 1000));
}

/**
 * The exact production payload shape captured by the #42 diagnostic:
 * message carries from_user_id (no from), contact carries user_id (no wa_id).
 */
function bsuidMessage(overrides: Partial<RawMessage> = {}): RawMessage {
  return {
    id: 'wamid.bsuid-1',
    from_user_id: BSUID,
    timestamp: nowTimestamp(),
    type: 'text',
    text: { body: 'hello from a username user' },
    ...overrides,
  };
}

function bsuidContact(): Contact {
  return { profile: { name: 'Username User' }, user_id: BSUID };
}

function phoneMessage(overrides: Partial<RawMessage> = {}): RawMessage {
  return {
    id: 'wamid.phone-1',
    from: '5715550001',
    timestamp: nowTimestamp(),
    type: 'text',
    text: { body: 'hello from a phone user' },
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

function fetchBody(
  fetchMock: ReturnType<typeof vi.fn>,
  callIndex: number
): Record<string, unknown> {
  return JSON.parse(fetchMock.mock.calls[callIndex][1]?.body as string) as Record<string, unknown>;
}

describe('BSUID sender support (issue #43)', () => {
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

  describe('inbound parsing', () => {
    it('forwards a BSUID-only message to the engine with the BSUID as user_id', async () => {
      fetchMock.mockResolvedValueOnce(metaOk()).mockResolvedValueOnce(engineOk());

      await handleWebhook(payloadWith([bsuidMessage()], [bsuidContact()]), mockEnv);

      // Typing indicator + engine send; no malformed-entry diagnostic.
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(errorSpy).not.toHaveBeenCalled();
      const engineBody = fetchBody(fetchMock, 1);
      expect(engineBody.user_id).toBe(BSUID);
      expect(engineBody.message).toBe('hello from a username user');

      const infos = logSpy.mock.calls.map(
        (c) => JSON.parse(c[0] as string) as Record<string, unknown>
      );
      const received = infos.find((e) => e.message === 'Received message');
      expect(received?.senderSource).toBe('contact.user_id');
    });

    it('forwards a BSUID message even when the contacts array is empty', async () => {
      fetchMock.mockResolvedValueOnce(metaOk()).mockResolvedValueOnce(engineOk());

      await handleWebhook(payloadWith([bsuidMessage()], []), mockEnv);

      expect(fetchMock).toHaveBeenCalledTimes(2);
      const engineBody = fetchBody(fetchMock, 1);
      expect(engineBody.user_id).toBe(BSUID);

      const infos = logSpy.mock.calls.map(
        (c) => JSON.parse(c[0] as string) as Record<string, unknown>
      );
      const received = infos.find((e) => e.message === 'Received message');
      expect(received?.senderSource).toBe('message.from_user_id');
    });

    it('prefers the phone number when both wa_id and user_id are present', async () => {
      // Meta now includes user_id in ALL webhooks; phone-keyed users must
      // keep their phone identity (engine history is keyed by phone).
      fetchMock.mockResolvedValueOnce(metaOk()).mockResolvedValueOnce(engineOk());
      const contact: Contact = { wa_id: '5715550001', user_id: BSUID, profile: { name: 'Both' } };

      await handleWebhook(payloadWith([phoneMessage({ from_user_id: BSUID })], [contact]), mockEnv);

      const engineBody = fetchBody(fetchMock, 1);
      expect(engineBody.user_id).toBe('5715550001');
    });

    it('processes a mixed batch of phone and BSUID senders', async () => {
      fetchMock
        .mockResolvedValueOnce(metaOk())
        .mockResolvedValueOnce(engineOk())
        .mockResolvedValueOnce(metaOk())
        .mockResolvedValueOnce(engineOk());

      await handleWebhook(payloadWith([phoneMessage(), bsuidMessage()], [bsuidContact()]), mockEnv);

      expect(fetchMock).toHaveBeenCalledTimes(4);
      // Phone message parses from raw.from (contact belongs to the BSUID user).
      expect(fetchBody(fetchMock, 1).user_id).toBe('5715550001');
      expect(fetchBody(fetchMock, 3).user_id).toBe(BSUID);
    });

    it('still logs the malformed-entry diagnostic when no sender id exists at all', async () => {
      const malformed = {
        id: 'wamid.malformed-1',
        timestamp: nowTimestamp(),
        type: 'text',
      } as RawMessage;

      await handleWebhook(payloadWith([malformed], []), mockEnv);

      expect(fetchMock).not.toHaveBeenCalled();
      const errors = errorSpy.mock.calls.map(
        (c) => JSON.parse(c[0] as string) as Record<string, unknown>
      );
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toBe('Message entry has no sender id');
    });
  });

  describe('outbound recipient routing', () => {
    it('addresses text sends to a BSUID via recipient, not to', async () => {
      fetchMock.mockResolvedValueOnce(metaOk());

      await sendTextMessage(BSUID, 'reply text', mockEnv);

      const body = fetchBody(fetchMock, 0);
      expect(body.recipient).toBe(BSUID);
      expect(body.to).toBeUndefined();
      expect(body.type).toBe('text');
    });

    it('addresses text sends to a phone number via to, not recipient', async () => {
      fetchMock.mockResolvedValueOnce(metaOk());

      await sendTextMessage('5715550001', 'reply text', mockEnv);

      const body = fetchBody(fetchMock, 0);
      expect(body.to).toBe('5715550001');
      expect(body.recipient).toBeUndefined();
    });

    it('sends a byte-identical wire payload for phone users (pre-#43 format)', async () => {
      // Regression guarantee: for phone-number recipients the request body
      // Meta receives is exactly what the gateway sent before this change.
      fetchMock.mockResolvedValueOnce(metaOk());

      await sendTextMessage('5715550001', 'reply text', mockEnv);

      const rawBody = fetchMock.mock.calls[0][1]?.body as string;
      expect(rawBody).toBe(
        JSON.stringify({
          messaging_product: 'whatsapp',
          to: '5715550001',
          type: 'text',
          text: { body: 'reply text' },
        })
      );
    });

    it('addresses image sends to a BSUID via recipient', async () => {
      fetchMock.mockResolvedValueOnce(metaOk());

      await sendImageMessage(BSUID, 'https://example.com/img.png', undefined, mockEnv);

      const body = fetchBody(fetchMock, 0);
      expect(body.recipient).toBe(BSUID);
      expect(body.to).toBeUndefined();
      expect(body.type).toBe('image');
    });

    it('addresses document sends to a BSUID via recipient', async () => {
      fetchMock.mockResolvedValueOnce(metaOk());

      await sendDocumentMessage(BSUID, 'https://example.com/doc.pdf', 'doc.pdf', mockEnv);

      const body = fetchBody(fetchMock, 0);
      expect(body.recipient).toBe(BSUID);
      expect(body.to).toBeUndefined();
      expect(body.type).toBe('document');
    });

    it('addresses audio sends to a BSUID via recipient', async () => {
      fetchMock.mockResolvedValueOnce(metaOk());

      await sendAudioById(BSUID, 'media-id-1', mockEnv);

      const body = fetchBody(fetchMock, 0);
      expect(body.recipient).toBe(BSUID);
      expect(body.to).toBeUndefined();
      expect(body.type).toBe('audio');
    });

    it('logs success with the addressing mode used', async () => {
      fetchMock.mockResolvedValueOnce(metaOk());

      await sendTextMessage(BSUID, 'reply text', mockEnv);

      const infos = logSpy.mock.calls.map(
        (c) => JSON.parse(c[0] as string) as Record<string, unknown>
      );
      const sent = infos.find((e) => e.message === 'Sent text message to user');
      expect(sent?.addressing).toBe('recipient');
      expect(sent?.recipient).toBe('CO.11102...');
    });

    it('logs the addressing mode when Meta rejects a send, for one-hotfix diagnosis', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => '{"error":{"message":"(#100) Param recipient is not supported"}}',
      });

      const sent = await sendTextMessage(BSUID, 'reply text', mockEnv);

      expect(sent).toBe(false);
      const errors = errorSpy.mock.calls.map(
        (c) => JSON.parse(c[0] as string) as Record<string, unknown>
      );
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toBe('Failed to send Meta message');
      expect(errors[0].addressing).toBe('recipient');
      expect(errors[0].recipient).toBe('CO.11102...');
      expect(errors[0].error).toContain('Param recipient is not supported');
    });

    it('delivers a complete engine callback to a BSUID user via recipient', async () => {
      fetchMock.mockResolvedValueOnce(metaOk());
      const callback: EngineCallback = {
        type: 'complete',
        user_id: BSUID,
        message_key: 'key-1',
        text: 'engine reply',
      };

      await handleEngineCallback(callback, mockEnv);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const body = fetchBody(fetchMock, 0);
      expect(body.recipient).toBe(BSUID);
      expect(body.to).toBeUndefined();
      expect((body.text as { body: string }).body).toBe('engine reply');
    });
  });
});
