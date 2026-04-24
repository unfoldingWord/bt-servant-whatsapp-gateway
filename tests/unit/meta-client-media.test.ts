import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sendImageMessage, sendVideoMessage } from '../../src/services/meta-api/client';
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

describe('media send helpers', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('sendImageMessage', () => {
    it('posts type:image with link and caption', async () => {
      fetchMock.mockResolvedValueOnce(metaOk());

      const result = await sendImageMessage(
        '1234567890',
        'https://cdn.example.com/a.jpg',
        'Pretty picture',
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
            type: 'image',
            image: { link: 'https://cdn.example.com/a.jpg', caption: 'Pretty picture' },
          }),
        })
      );
    });

    it('omits caption when undefined', async () => {
      fetchMock.mockResolvedValueOnce(metaOk());

      await sendImageMessage('1234567890', 'https://cdn.example.com/a.jpg', undefined, mockEnv);

      const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
      expect(body.image).toEqual({ link: 'https://cdn.example.com/a.jpg' });
      expect(body.image.caption).toBeUndefined();
    });

    it('omits caption when empty string', async () => {
      fetchMock.mockResolvedValueOnce(metaOk());

      await sendImageMessage('1234567890', 'https://cdn.example.com/a.jpg', '', mockEnv);

      const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
      expect(body.image.caption).toBeUndefined();
    });

    it('returns false on non-2xx', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => 'Bad Request',
      });

      const result = await sendImageMessage(
        '1234567890',
        'https://cdn.example.com/a.jpg',
        undefined,
        mockEnv
      );
      expect(result).toBe(false);
    });
  });

  describe('sendVideoMessage', () => {
    it('posts type:video with link and caption', async () => {
      fetchMock.mockResolvedValueOnce(metaOk());

      const result = await sendVideoMessage(
        '1234567890',
        'https://cdn.example.com/a.mp4',
        'Watch this',
        mockEnv
      );

      expect(result).toBe(true);
      const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
      expect(body).toEqual({
        messaging_product: 'whatsapp',
        to: '1234567890',
        type: 'video',
        video: { link: 'https://cdn.example.com/a.mp4', caption: 'Watch this' },
      });
    });

    it('returns false on non-2xx', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Server Error',
      });

      const result = await sendVideoMessage(
        '1234567890',
        'https://cdn.example.com/a.mp4',
        undefined,
        mockEnv
      );
      expect(result).toBe(false);
    });

    it('sends Bearer auth header', async () => {
      fetchMock.mockResolvedValueOnce(metaOk());

      await sendVideoMessage('1234567890', 'https://cdn.example.com/a.mp4', undefined, mockEnv);

      const init = fetchMock.mock.calls[0][1];
      expect(init?.headers?.Authorization).toBe('Bearer test-whatsapp-token');
    });
  });

  describe('embedded-error 200 responses (Piece 1)', () => {
    it('returns false when 200 body has a permanent error code (131052)', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          error: { code: 131052, message: 'Media download error' },
        }),
      });

      const result = await sendImageMessage(
        '1234567890',
        'https://cdn.example.com/a.jpg',
        undefined,
        mockEnv
      );
      expect(result).toBe(false);
    });

    it('returns false when 200 body has a permanent error code (131053)', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          error: { code: 131053, message: 'Media upload error' },
        }),
      });

      const result = await sendVideoMessage(
        '1234567890',
        'https://cdn.example.com/big.mp4',
        undefined,
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

      const result = await sendImageMessage(
        '1234567890',
        'https://cdn.example.com/a.jpg',
        undefined,
        mockEnv
      );
      expect(result).toBe(true);
    });

    it('returns false when messages[0].message_status === "failed"', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ messages: [{ id: 'wamid.x', message_status: 'failed' }] }),
      });

      const result = await sendImageMessage(
        '1234567890',
        'https://cdn.example.com/a.jpg',
        undefined,
        mockEnv
      );
      expect(result).toBe(false);
    });

    it('returns true when JSON body is unparseable but status is 2xx', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => {
          throw new Error('not JSON');
        },
      });

      const result = await sendImageMessage(
        '1234567890',
        'https://cdn.example.com/a.jpg',
        undefined,
        mockEnv
      );
      expect(result).toBe(true);
    });
  });
});
