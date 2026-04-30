import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sendDocumentMessage } from '../../src/services/meta-api/client';
import type { Env } from '../../src/config/types';

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

function metaOk(wamid = 'wamid.test'): {
  ok: true;
  json: () => Promise<{ messages: { id: string }[] }>;
} {
  return { ok: true, json: async () => ({ messages: [{ id: wamid }] }) };
}

describe('sendDocumentMessage', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('posts type:document with link and filename, no caption', async () => {
    fetchMock.mockResolvedValueOnce(metaOk());

    const result = await sendDocumentMessage(
      '1234567890',
      'https://cdn.example.com/bsb-JHN.pdf',
      'bsb-JHN-bsb-empirical.pdf',
      mockEnv
    );

    expect(result).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://graph.facebook.com/v23.0/123456789/messages',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: '1234567890',
          type: 'document',
          document: {
            link: 'https://cdn.example.com/bsb-JHN.pdf',
            filename: 'bsb-JHN-bsb-empirical.pdf',
          },
        }),
      })
    );
  });

  it('sends Bearer auth header', async () => {
    fetchMock.mockResolvedValueOnce(metaOk());

    await sendDocumentMessage(
      '1234567890',
      'https://cdn.example.com/file.pdf',
      'file.pdf',
      mockEnv
    );

    const init = fetchMock.mock.calls[0][1];
    expect(init?.headers?.Authorization).toBe('Bearer test-whatsapp-token');
  });

  it('returns false on non-2xx', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => 'Bad Request',
    });

    const result = await sendDocumentMessage(
      '1234567890',
      'https://cdn.example.com/file.pdf',
      'file.pdf',
      mockEnv
    );
    expect(result).toBe(false);
  });

  it('returns false when 200 body has a permanent error code (131052)', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        error: { code: 131052, message: 'Media download error' },
      }),
    });

    const result = await sendDocumentMessage(
      '1234567890',
      'https://cdn.example.com/file.pdf',
      'file.pdf',
      mockEnv
    );
    expect(result).toBe(false);
  });

  it('returns false when 200 body has an unknown error code (fail-closed)', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        error: { code: 999999, message: 'some new permanent failure' },
      }),
    });

    const result = await sendDocumentMessage(
      '1234567890',
      'https://cdn.example.com/file.pdf',
      'file.pdf',
      mockEnv
    );
    expect(result).toBe(false);
  });

  it('returns true when 200 body has a transient error code (131000)', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        error: { code: 131000, message: 'Something went wrong' },
      }),
    });

    const result = await sendDocumentMessage(
      '1234567890',
      'https://cdn.example.com/file.pdf',
      'file.pdf',
      mockEnv
    );
    expect(result).toBe(true);
  });

  it('returns false when messages[0].message_status === "failed"', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ messages: [{ id: 'wamid.x', message_status: 'failed' }] }),
    });

    const result = await sendDocumentMessage(
      '1234567890',
      'https://cdn.example.com/file.pdf',
      'file.pdf',
      mockEnv
    );
    expect(result).toBe(false);
  });
});
