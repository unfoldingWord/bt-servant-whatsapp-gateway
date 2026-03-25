import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  uploadAudioMedia,
  uploadAudioFromBuffer,
  sendAudioById,
  sendAudioMessage,
  sendAudioFromBuffer,
} from '../../src/services/meta-api/client';
import { handleEngineCallback, validateEngineCallback } from '../../src/services/message-handler';
import type { Env } from '../../src/config/types';
import type { EngineCallback } from '../../src/types/engine';

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

describe('audio support', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('uploadAudioMedia', () => {
    it('should upload audio and return media ID', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'media-123' }),
      });

      const result = await uploadAudioMedia('dGVzdA==', mockEnv);

      expect(result).toBe('media-123');
      expect(fetchMock).toHaveBeenCalledWith(
        'https://graph.facebook.com/v23.0/123456789/media',
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('should return null on upload failure', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => 'Bad Request',
      });

      const result = await uploadAudioMedia('dGVzdA==', mockEnv);
      expect(result).toBeNull();
    });

    it('should return null when response has no id', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      });

      const result = await uploadAudioMedia('dGVzdA==', mockEnv);
      expect(result).toBeNull();
    });
  });

  describe('uploadAudioFromBuffer', () => {
    it('should upload buffer and return media ID', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'media-buf-1' }),
      });

      const buffer = new Uint8Array([1, 2, 3]).buffer;
      const result = await uploadAudioFromBuffer(buffer, mockEnv);

      expect(result).toBe('media-buf-1');
      expect(fetchMock).toHaveBeenCalledWith(
        'https://graph.facebook.com/v23.0/123456789/media',
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('should return null on upload failure', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Server Error',
      });

      const buffer = new Uint8Array([1, 2, 3]).buffer;
      const result = await uploadAudioFromBuffer(buffer, mockEnv);
      expect(result).toBeNull();
    });

    it('should return null when response has no id', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      });

      const buffer = new Uint8Array([1, 2, 3]).buffer;
      const result = await uploadAudioFromBuffer(buffer, mockEnv);
      expect(result).toBeNull();
    });
  });

  describe('sendAudioById', () => {
    it('should send audio message with media ID', async () => {
      fetchMock.mockResolvedValueOnce({ ok: true });

      const result = await sendAudioById('1234567890', 'media-123', mockEnv);

      expect(result).toBe(true);
      expect(fetchMock).toHaveBeenCalledWith(
        'https://graph.facebook.com/v23.0/123456789/messages',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: '1234567890',
            type: 'audio',
            audio: { id: 'media-123' },
          }),
        })
      );
    });

    it('should return false on send failure', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Server Error',
      });

      const result = await sendAudioById('1234567890', 'media-123', mockEnv);
      expect(result).toBe(false);
    });
  });

  describe('sendAudioMessage', () => {
    it('should upload then send audio', async () => {
      fetchMock
        .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'media-456' }) })
        .mockResolvedValueOnce({ ok: true });

      const result = await sendAudioMessage('1234567890', 'dGVzdA==', mockEnv);

      expect(result).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('should return false when upload fails', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => 'Bad Request',
      });

      const result = await sendAudioMessage('1234567890', 'dGVzdA==', mockEnv);

      expect(result).toBe(false);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('should return false when send fails after upload', async () => {
      fetchMock
        .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'media-789' }) })
        .mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'Error' });

      const result = await sendAudioMessage('1234567890', 'dGVzdA==', mockEnv);
      expect(result).toBe(false);
    });
  });

  describe('sendAudioFromBuffer', () => {
    it('should upload buffer then send audio', async () => {
      fetchMock
        .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'media-buf-2' }) })
        .mockResolvedValueOnce({ ok: true });

      const buffer = new Uint8Array([1, 2, 3]).buffer;
      const result = await sendAudioFromBuffer('1234567890', buffer, mockEnv);

      expect(result).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('should return false when upload fails', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => 'Bad Request',
      });

      const buffer = new Uint8Array([1, 2, 3]).buffer;
      const result = await sendAudioFromBuffer('1234567890', buffer, mockEnv);

      expect(result).toBe(false);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('validateEngineCallback with audio', () => {
    it('should accept complete callback with only voice_audio_base64', () => {
      const result = validateEngineCallback({
        type: 'complete',
        user_id: 'user123',
        message_key: 'key123',
        voice_audio_base64: 'dGVzdA==',
      });
      expect(result).toBeNull();
    });

    it('should accept complete callback with only voice_audio_url', () => {
      const result = validateEngineCallback({
        type: 'complete',
        user_id: 'user123',
        message_key: 'key123',
        voice_audio_url: 'https://r2.example.com/audio/abc.mp3',
      });
      expect(result).toBeNull();
    });

    it('should accept complete callback with both voice_audio_url and voice_audio_base64', () => {
      const result = validateEngineCallback({
        type: 'complete',
        user_id: 'user123',
        message_key: 'key123',
        voice_audio_url: 'https://r2.example.com/audio/abc.mp3',
        voice_audio_base64: 'dGVzdA==',
      });
      expect(result).toBeNull();
    });

    it('should accept complete callback with both text and voice_audio_base64', () => {
      const result = validateEngineCallback({
        type: 'complete',
        user_id: 'user123',
        message_key: 'key123',
        text: 'Hello',
        voice_audio_base64: 'dGVzdA==',
      });
      expect(result).toBeNull();
    });

    it('should reject complete callback with neither text nor audio', () => {
      const result = validateEngineCallback({
        type: 'complete',
        user_id: 'user123',
        message_key: 'key123',
      });
      expect(result).toContain('Missing');
    });

    it('should still require text for progress callbacks', () => {
      const result = validateEngineCallback({
        type: 'progress',
        user_id: 'user123',
        message_key: 'key123',
        voice_audio_base64: 'dGVzdA==',
      });
      expect(result).toContain('Missing');
    });
  });

  describe('handleEngineCallback with audio', () => {
    it('should send only audio when base64 audio succeeds (skip text)', async () => {
      fetchMock
        .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'media-100' }) })
        .mockResolvedValueOnce({ ok: true });

      const callback: EngineCallback = {
        type: 'complete',
        user_id: '1234567890',
        message_key: 'key123',
        timestamp: new Date().toISOString(),
        text: 'Here is the response',
        voice_audio_base64: 'dGVzdA==',
      };

      await handleEngineCallback(callback, mockEnv);

      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('should still send text when base64 audio send fails', async () => {
      fetchMock
        .mockResolvedValueOnce({ ok: false, status: 400, text: async () => 'Error' })
        .mockResolvedValueOnce({ ok: true });

      const callback: EngineCallback = {
        type: 'complete',
        user_id: '1234567890',
        message_key: 'key123',
        timestamp: new Date().toISOString(),
        text: 'Here is the response',
        voice_audio_base64: 'dGVzdA==',
      };

      await handleEngineCallback(callback, mockEnv);

      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('should send only audio when no text in complete callback', async () => {
      fetchMock
        .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'media-200' }) })
        .mockResolvedValueOnce({ ok: true });

      const callback: EngineCallback = {
        type: 'complete',
        user_id: '1234567890',
        message_key: 'key123',
        timestamp: new Date().toISOString(),
        voice_audio_base64: 'dGVzdA==',
      };

      await handleEngineCallback(callback, mockEnv);

      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('should send error fallback when audio fails and no text available', async () => {
      fetchMock
        .mockResolvedValueOnce({ ok: false, status: 400, text: async () => 'Error' })
        .mockResolvedValueOnce({ ok: true });

      const callback: EngineCallback = {
        type: 'complete',
        user_id: '1234567890',
        message_key: 'key123',
        timestamp: new Date().toISOString(),
        voice_audio_base64: 'dGVzdA==',
      };

      await handleEngineCallback(callback, mockEnv);

      expect(fetchMock).toHaveBeenCalledTimes(2);
      const lastCall = fetchMock.mock.calls[1];
      const body = JSON.parse(lastCall[1]?.body as string);
      expect(body.text.body).toContain('Sorry');
    });

    it('should fetch audio from URL with Bearer auth and send it', async () => {
      const audioBytes = new Uint8Array([0xff, 0xfb, 0x90]).buffer;
      // 1: fetch audio URL, 2: upload to Meta, 3: send audio message
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          headers: new Headers({ 'Content-Length': '3' }),
          arrayBuffer: async () => audioBytes,
        })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'media-url-1' }) })
        .mockResolvedValueOnce({ ok: true });

      const callback: EngineCallback = {
        type: 'complete',
        user_id: '1234567890',
        message_key: 'key123',
        timestamp: new Date().toISOString(),
        voice_audio_url: 'https://r2.example.com/audio/abc.mp3',
      };

      await handleEngineCallback(callback, mockEnv);

      expect(fetchMock).toHaveBeenCalledTimes(3);
      // Verify first call fetched URL with Bearer auth
      const urlFetchCall = fetchMock.mock.calls[0];
      expect(urlFetchCall[0]).toBe('https://r2.example.com/audio/abc.mp3');
      expect(urlFetchCall[1].headers.Authorization).toBe('Bearer test-engine-key');
    });

    it('should fall back to base64 when URL fetch fails', async () => {
      // 1: URL fetch fails, 2: base64 upload succeeds, 3: send audio
      fetchMock
        .mockResolvedValueOnce({ ok: false, status: 404 })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'media-b64-1' }) })
        .mockResolvedValueOnce({ ok: true });

      const callback: EngineCallback = {
        type: 'complete',
        user_id: '1234567890',
        message_key: 'key123',
        timestamp: new Date().toISOString(),
        voice_audio_url: 'https://r2.example.com/audio/abc.mp3',
        voice_audio_base64: 'dGVzdA==',
      };

      await handleEngineCallback(callback, mockEnv);

      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('should fall back to text when URL fetch fails and no base64', async () => {
      // 1: URL fetch fails, 2: send text
      fetchMock
        .mockResolvedValueOnce({ ok: false, status: 500 })
        .mockResolvedValueOnce({ ok: true });

      const callback: EngineCallback = {
        type: 'complete',
        user_id: '1234567890',
        message_key: 'key123',
        timestamp: new Date().toISOString(),
        text: 'Fallback text response',
        voice_audio_url: 'https://r2.example.com/audio/abc.mp3',
      };

      await handleEngineCallback(callback, mockEnv);

      expect(fetchMock).toHaveBeenCalledTimes(2);
      const textCall = fetchMock.mock.calls[1];
      const body = JSON.parse(textCall[1]?.body as string);
      expect(body.text.body).toBe('Fallback text response');
    });

    it('should send Sorry when URL fetch fails, no base64, and no text', async () => {
      // 1: URL fetch fails, 2: send Sorry message
      fetchMock
        .mockResolvedValueOnce({ ok: false, status: 500 })
        .mockResolvedValueOnce({ ok: true });

      const callback: EngineCallback = {
        type: 'complete',
        user_id: '1234567890',
        message_key: 'key123',
        timestamp: new Date().toISOString(),
        voice_audio_url: 'https://r2.example.com/audio/abc.mp3',
      };

      await handleEngineCallback(callback, mockEnv);

      expect(fetchMock).toHaveBeenCalledTimes(2);
      const lastCall = fetchMock.mock.calls[1];
      const body = JSON.parse(lastCall[1]?.body as string);
      expect(body.text.body).toContain('Sorry');
    });

    it('should fall back to base64 when URL fetch succeeds but Meta upload fails', async () => {
      const audioBytes = new Uint8Array([0xff, 0xfb, 0x90]).buffer;
      // 1: URL fetch OK, 2: Meta upload fails, 3: base64 upload OK, 4: send audio
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          headers: new Headers({ 'Content-Length': '3' }),
          arrayBuffer: async () => audioBytes,
        })
        .mockResolvedValueOnce({ ok: false, status: 400, text: async () => 'Bad Request' })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'media-b64-2' }) })
        .mockResolvedValueOnce({ ok: true });

      const callback: EngineCallback = {
        type: 'complete',
        user_id: '1234567890',
        message_key: 'key123',
        timestamp: new Date().toISOString(),
        voice_audio_url: 'https://r2.example.com/audio/abc.mp3',
        voice_audio_base64: 'dGVzdA==',
      };

      await handleEngineCallback(callback, mockEnv);

      expect(fetchMock).toHaveBeenCalledTimes(4);
    });

    it('should fall back to base64 when URL fetch throws network error', async () => {
      // 1: URL fetch throws, 2: base64 upload succeeds, 3: send audio
      fetchMock
        .mockRejectedValueOnce(new Error('DNS resolution failed'))
        .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'media-b64-3' }) })
        .mockResolvedValueOnce({ ok: true });

      const callback: EngineCallback = {
        type: 'complete',
        user_id: '1234567890',
        message_key: 'key123',
        timestamp: new Date().toISOString(),
        voice_audio_url: 'https://r2.example.com/audio/abc.mp3',
        voice_audio_base64: 'dGVzdA==',
      };

      await handleEngineCallback(callback, mockEnv);

      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('should reject non-HTTPS audio URL and fall back to base64', async () => {
      // No URL fetch attempted, 1: base64 upload succeeds, 2: send audio
      fetchMock
        .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'media-b64-4' }) })
        .mockResolvedValueOnce({ ok: true });

      const callback: EngineCallback = {
        type: 'complete',
        user_id: '1234567890',
        message_key: 'key123',
        timestamp: new Date().toISOString(),
        voice_audio_url: 'http://insecure.example.com/audio/abc.mp3',
        voice_audio_base64: 'dGVzdA==',
      };

      await handleEngineCallback(callback, mockEnv);

      // URL fetch was never called — only base64 upload + send
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('should reject audio URL when Content-Length exceeds limit', async () => {
      // 1: URL fetch returns oversized Content-Length, 2: base64 upload, 3: send
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          headers: new Headers({ 'Content-Length': String(30 * 1024 * 1024) }),
          arrayBuffer: async () => new ArrayBuffer(0),
        })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'media-b64-5' }) })
        .mockResolvedValueOnce({ ok: true });

      const callback: EngineCallback = {
        type: 'complete',
        user_id: '1234567890',
        message_key: 'key123',
        timestamp: new Date().toISOString(),
        voice_audio_url: 'https://r2.example.com/audio/huge.mp3',
        voice_audio_base64: 'dGVzdA==',
      };

      await handleEngineCallback(callback, mockEnv);

      // URL fetch returned oversized header (1 call), then base64 upload + send (2 calls)
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('should reject audio URL when body exceeds limit without Content-Length header', async () => {
      const oversizedBuffer = new ArrayBuffer(26 * 1024 * 1024);
      // 1: URL fetch OK (no Content-Length, chunked), 2: base64 upload, 3: send
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          headers: new Headers(),
          arrayBuffer: async () => oversizedBuffer,
        })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'media-b64-6' }) })
        .mockResolvedValueOnce({ ok: true });

      const callback: EngineCallback = {
        type: 'complete',
        user_id: '1234567890',
        message_key: 'key123',
        timestamp: new Date().toISOString(),
        voice_audio_url: 'https://r2.example.com/audio/huge-chunked.mp3',
        voice_audio_base64: 'dGVzdA==',
      };

      await handleEngineCallback(callback, mockEnv);

      // URL fetch + oversized body rejected (1 call), then base64 upload + send (2 calls)
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });
  });
});
