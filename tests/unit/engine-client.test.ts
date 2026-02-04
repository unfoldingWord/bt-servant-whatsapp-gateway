import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sendTextMessage } from '../../src/services/engine-client';
import type { Env } from '../../src/config/types';

// Mock environment
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

describe('engine-client', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
    vi.useFakeTimers();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  describe('sendTextMessage', () => {
    it('should send a text message successfully', async () => {
      const mockResponse = {
        responses: ['Hello!'],
        response_language: 'en',
        voice_audio_base64: null,
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await sendTextMessage('user123', 'Hi there', mockEnv);

      expect(result).toEqual(mockResponse);
      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:8787/api/v1/chat',
        expect.objectContaining({
          method: 'POST',
          headers: {
            Authorization: 'Bearer test-engine-key',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            client_id: 'whatsapp',
            user_id: 'user123',
            message: 'Hi there',
            message_type: 'text',
          }),
        })
      );
    });

    it('should include progress callback when provided', async () => {
      const mockResponse = {
        responses: ['Hello!'],
        response_language: 'en',
        voice_audio_base64: null,
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      await sendTextMessage(
        'user123',
        'Hi there',
        mockEnv,
        'https://gateway.example.com/progress-callback'
      );

      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:8787/api/v1/chat',
        expect.objectContaining({
          body: JSON.stringify({
            client_id: 'whatsapp',
            user_id: 'user123',
            message: 'Hi there',
            message_type: 'text',
            progress_callback_url: 'https://gateway.example.com/progress-callback',
            progress_throttle_seconds: 3.0,
          }),
        })
      );
    });

    it('should return null on API error', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      });

      const result = await sendTextMessage('user123', 'Hi there', mockEnv);

      expect(result).toBeNull();
    });

    it('should return null on network error', async () => {
      fetchMock.mockRejectedValueOnce(new Error('Network error'));

      const result = await sendTextMessage('user123', 'Hi there', mockEnv);

      expect(result).toBeNull();
    });

    it('should retry on 429 with Retry-After header', async () => {
      // First call returns 429, second succeeds
      fetchMock
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          headers: new Headers({ 'Retry-After': '1' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            responses: ['Success after retry'],
            response_language: 'en',
            voice_audio_base64: null,
          }),
        });

      const resultPromise = sendTextMessage('user123', 'Hi there', mockEnv);

      // Advance timers to trigger the retry
      await vi.advanceTimersByTimeAsync(1000);

      const result = await resultPromise;

      expect(result).toEqual({
        responses: ['Success after retry'],
        response_language: 'en',
        voice_audio_base64: null,
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('should retry on 429 with exponential backoff', async () => {
      // All calls return 429
      for (let i = 0; i < 6; i++) {
        fetchMock.mockResolvedValueOnce({
          ok: false,
          status: 429,
          headers: new Headers(),
        });
      }

      const resultPromise = sendTextMessage('user123', 'Hi there', mockEnv);

      // Advance timers through all retries
      // Delays: 2000, 3000, 4500, 6750, 10125 ms
      for (let i = 0; i < 5; i++) {
        await vi.advanceTimersByTimeAsync(15000);
      }

      const result = await resultPromise;

      // Should have made initial request + 5 retries = 6 total
      expect(result).toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(6);
    });
  });
});
