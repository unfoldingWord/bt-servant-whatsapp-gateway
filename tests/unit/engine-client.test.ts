import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sendMessage } from '../../src/services/engine-client';
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
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('sendMessage', () => {
    it('should send a message successfully', async () => {
      const mockResponse = {
        message_id: 'msg-123',
        queue_position: 0,
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await sendMessage(
        'user123',
        'Hi there',
        mockEnv,
        'https://gateway.example.com/completion-callback'
      );

      expect(result).toEqual(mockResponse);
      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:8787/api/v1/message',
        expect.objectContaining({
          method: 'POST',
          headers: {
            Authorization: 'Bearer test-engine-key',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            client_id: 'whatsapp',
            user_id: 'user123',
            org_id: 'test-org',
            message: 'Hi there',
            message_type: 'text',
            callback_url: 'https://gateway.example.com/completion-callback',
          }),
        })
      );
    });

    it('should include progress callback when url provided', async () => {
      const mockResponse = {
        message_id: 'msg-456',
        queue_position: 1,
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      await sendMessage(
        'user123',
        'Hi there',
        mockEnv,
        'https://gateway.example.com/completion-callback',
        'https://gateway.example.com/progress-callback'
      );

      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:8787/api/v1/message',
        expect.objectContaining({
          body: JSON.stringify({
            client_id: 'whatsapp',
            user_id: 'user123',
            org_id: 'test-org',
            message: 'Hi there',
            message_type: 'text',
            callback_url: 'https://gateway.example.com/completion-callback',
            progress_callback_url: 'https://gateway.example.com/progress-callback',
            progress_throttle_seconds: 3.0,
          }),
        })
      );
    });

    it('should not include progress callback when url not provided', async () => {
      const mockResponse = {
        message_id: 'msg-789',
        queue_position: 0,
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      await sendMessage(
        'user123',
        'Hi there',
        mockEnv,
        'https://gateway.example.com/completion-callback'
      );

      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:8787/api/v1/message',
        expect.objectContaining({
          body: JSON.stringify({
            client_id: 'whatsapp',
            user_id: 'user123',
            org_id: 'test-org',
            message: 'Hi there',
            message_type: 'text',
            callback_url: 'https://gateway.example.com/completion-callback',
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

      const result = await sendMessage(
        'user123',
        'Hi there',
        mockEnv,
        'https://gateway.example.com/completion-callback'
      );

      expect(result).toBeNull();
    });

    it('should return null on network error', async () => {
      fetchMock.mockRejectedValueOnce(new Error('Network error'));

      const result = await sendMessage(
        'user123',
        'Hi there',
        mockEnv,
        'https://gateway.example.com/completion-callback'
      );

      expect(result).toBeNull();
    });
  });
});
