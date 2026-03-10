import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  uploadAudioMedia,
  sendAudioById,
  sendAudioMessage,
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
    it('should send audio then text for complete callback with both', async () => {
      // Audio upload + audio send + text send
      fetchMock
        .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'media-100' }) })
        .mockResolvedValueOnce({ ok: true })
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

      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('should still send text when audio send fails', async () => {
      // Audio upload fails, then text send succeeds
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

      // Audio upload failed (1 call), then text sent (1 call)
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
  });
});
