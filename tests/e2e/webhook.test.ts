import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { arrayBufferToHex } from '../../src/utils/crypto';

describe('webhook routes', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    fetchMock = vi.fn();
    // Only mock external fetch calls, not internal worker requests
    // The test framework handles internal routing via SELF
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.resetAllMocks();
  });

  describe('GET /', () => {
    it('should return service status', async () => {
      const response = await SELF.fetch('http://localhost/');
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body).toEqual({ service: 'whatsapp-gateway', status: 'running' });
    });
  });

  describe('GET /health', () => {
    it('should return healthy status', async () => {
      const response = await SELF.fetch('http://localhost/health');
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body).toEqual({ status: 'healthy' });
    });
  });

  describe('GET /meta-whatsapp (verification)', () => {
    it('should verify webhook with correct token', async () => {
      const verifyToken = env.META_VERIFY_TOKEN;
      const challenge = 'test-challenge-123';

      const response = await SELF.fetch(
        `http://localhost/meta-whatsapp?hub.mode=subscribe&hub.verify_token=${verifyToken}&hub.challenge=${challenge}`
      );

      expect(response.status).toBe(200);
      const body = await response.text();
      expect(body).toBe(challenge);
    });

    it('should reject with wrong token', async () => {
      const response = await SELF.fetch(
        'http://localhost/meta-whatsapp?hub.mode=subscribe&hub.verify_token=wrong-token&hub.challenge=test'
      );

      expect(response.status).toBe(403);
    });

    it('should reject with wrong mode', async () => {
      const verifyToken = env.META_VERIFY_TOKEN;
      const response = await SELF.fetch(
        `http://localhost/meta-whatsapp?hub.mode=unsubscribe&hub.verify_token=${verifyToken}&hub.challenge=test`
      );

      expect(response.status).toBe(403);
    });
  });

  describe('POST /meta-whatsapp (webhook)', () => {
    async function computeSignature(body: string, secret: string): Promise<string> {
      const encoder = new TextEncoder();
      const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      );
      const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
      return 'sha256=' + arrayBufferToHex(sig);
    }

    it('should reject request without signature', async () => {
      const response = await SELF.fetch('http://localhost/meta-whatsapp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'facebookexternalua',
        },
        body: '{}',
      });

      expect(response.status).toBe(401);
    });

    it('should reject request with invalid signature', async () => {
      const response = await SELF.fetch('http://localhost/meta-whatsapp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'facebookexternalua',
          'X-Hub-Signature-256': 'sha256=invalid',
        },
        body: '{}',
      });

      expect(response.status).toBe(401);
    });

    it('should reject request with wrong user agent', async () => {
      const body = '{}';
      const signature = await computeSignature(body, env.META_APP_SECRET);

      const response = await SELF.fetch('http://localhost/meta-whatsapp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'wrong-user-agent',
          'X-Hub-Signature-256': signature,
        },
        body,
      });

      expect(response.status).toBe(401);
    });

    it('should accept valid webhook and return 200', async () => {
      const body = JSON.stringify({
        object: 'whatsapp_business_account',
        entry: [],
      });
      const signature = await computeSignature(body, env.META_APP_SECRET);

      const response = await SELF.fetch('http://localhost/meta-whatsapp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'facebookexternalua',
          'X-Hub-Signature-256': signature,
        },
        body,
      });

      expect(response.status).toBe(200);
      expect(await response.text()).toBe('OK');
    });

    it('should reject malformed JSON', async () => {
      const body = 'not valid json';
      const signature = await computeSignature(body, env.META_APP_SECRET);

      const response = await SELF.fetch('http://localhost/meta-whatsapp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'facebookexternalua',
          'X-Hub-Signature-256': signature,
        },
        body,
      });

      expect(response.status).toBe(400);
    });
  });

  describe('POST /completion-callback', () => {
    it('should reject without engine token', async () => {
      const response = await SELF.fetch('http://localhost/completion-callback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message_id: 'msg-123',
          user_id: 'test',
          status: 'completed',
          responses: ['Hello!'],
        }),
      });

      expect(response.status).toBe(401);
    });

    it('should reject with wrong engine token', async () => {
      const response = await SELF.fetch('http://localhost/completion-callback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Engine-Token': 'wrong-token',
        },
        body: JSON.stringify({
          message_id: 'msg-123',
          user_id: 'test',
          status: 'completed',
          responses: ['Hello!'],
        }),
      });

      expect(response.status).toBe(401);
    });

    it('should accept valid completed callback', async () => {
      const response = await SELF.fetch('http://localhost/completion-callback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Engine-Token': env.ENGINE_API_KEY,
        },
        body: JSON.stringify({
          message_id: 'msg-123',
          user_id: 'test',
          status: 'completed',
          responses: ['Hello!'],
          response_language: 'en',
        }),
      });

      expect(response.status).toBe(200);
      expect(await response.text()).toBe('OK');
    });

    it('should accept valid error callback', async () => {
      const response = await SELF.fetch('http://localhost/completion-callback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Engine-Token': env.ENGINE_API_KEY,
        },
        body: JSON.stringify({
          message_id: 'msg-456',
          user_id: 'test',
          status: 'error',
          error: 'Something went wrong',
        }),
      });

      expect(response.status).toBe(200);
      expect(await response.text()).toBe('OK');
    });

    it('should reject malformed JSON', async () => {
      const response = await SELF.fetch('http://localhost/completion-callback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Engine-Token': env.ENGINE_API_KEY,
        },
        body: 'not valid json',
      });

      expect(response.status).toBe(400);
    });

    it('should reject callback missing user_id', async () => {
      const response = await SELF.fetch('http://localhost/completion-callback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Engine-Token': env.ENGINE_API_KEY,
        },
        body: JSON.stringify({
          message_id: 'msg-123',
          status: 'completed',
          responses: ['Hello!'],
        }),
      });

      expect(response.status).toBe(400);
    });

    it('should reject callback missing message_id', async () => {
      const response = await SELF.fetch('http://localhost/completion-callback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Engine-Token': env.ENGINE_API_KEY,
        },
        body: JSON.stringify({
          user_id: 'test',
          status: 'completed',
          responses: ['Hello!'],
        }),
      });

      expect(response.status).toBe(400);
    });

    it('should reject callback with invalid status', async () => {
      const response = await SELF.fetch('http://localhost/completion-callback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Engine-Token': env.ENGINE_API_KEY,
        },
        body: JSON.stringify({
          message_id: 'msg-123',
          user_id: 'test',
          status: 'unknown',
        }),
      });

      expect(response.status).toBe(400);
    });

    it('should reject completed callback with non-array responses', async () => {
      const response = await SELF.fetch('http://localhost/completion-callback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Engine-Token': env.ENGINE_API_KEY,
        },
        body: JSON.stringify({
          message_id: 'msg-123',
          user_id: 'test',
          status: 'completed',
          responses: 'not an array',
        }),
      });

      expect(response.status).toBe(400);
    });

    it('should reject completed callback with missing responses', async () => {
      const response = await SELF.fetch('http://localhost/completion-callback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Engine-Token': env.ENGINE_API_KEY,
        },
        body: JSON.stringify({
          message_id: 'msg-123',
          user_id: 'test',
          status: 'completed',
        }),
      });

      expect(response.status).toBe(400);
    });

    it('should deduplicate callback with same message_id', async () => {
      const payload = JSON.stringify({
        message_id: 'msg-dedup-test',
        user_id: 'test',
        status: 'completed',
        responses: ['Hello!'],
      });
      const headers = {
        'Content-Type': 'application/json',
        'X-Engine-Token': env.ENGINE_API_KEY,
      };

      // First call should be accepted and processed (no dedup header)
      const first = await SELF.fetch('http://localhost/completion-callback', {
        method: 'POST',
        headers,
        body: payload,
      });
      expect(first.status).toBe(200);
      expect(first.headers.get('X-Deduplicated')).toBeNull();

      // Second call should be idempotent: 200 with dedup header, no re-processing
      const second = await SELF.fetch('http://localhost/completion-callback', {
        method: 'POST',
        headers,
        body: payload,
      });
      expect(second.status).toBe(200);
      expect(second.headers.get('X-Deduplicated')).toBe('true');
    });
  });

  describe('POST /progress-callback', () => {
    it('should reject without engine token', async () => {
      const response = await SELF.fetch('http://localhost/progress-callback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: 'test',
          message_key: 'key',
          text: 'Progress',
          timestamp: Date.now(),
        }),
      });

      expect(response.status).toBe(401);
    });

    it('should reject with wrong engine token', async () => {
      const response = await SELF.fetch('http://localhost/progress-callback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Engine-Token': 'wrong-token',
        },
        body: JSON.stringify({
          user_id: 'test',
          message_key: 'key',
          text: 'Progress',
          timestamp: Date.now(),
        }),
      });

      expect(response.status).toBe(401);
    });

    it('should accept valid progress callback', async () => {
      const response = await SELF.fetch('http://localhost/progress-callback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Engine-Token': env.ENGINE_API_KEY,
        },
        body: JSON.stringify({
          user_id: 'test',
          message_key: 'key',
          text: 'Progress',
          timestamp: Date.now(),
        }),
      });

      expect(response.status).toBe(200);
      expect(await response.text()).toBe('OK');
    });

    it('should reject malformed JSON', async () => {
      const response = await SELF.fetch('http://localhost/progress-callback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Engine-Token': env.ENGINE_API_KEY,
        },
        body: 'not valid json',
      });

      expect(response.status).toBe(400);
    });

    it('should reject callback missing user_id', async () => {
      const response = await SELF.fetch('http://localhost/progress-callback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Engine-Token': env.ENGINE_API_KEY,
        },
        body: JSON.stringify({
          message_key: 'key',
          text: 'Progress',
          timestamp: Date.now(),
        }),
      });

      expect(response.status).toBe(400);
    });

    it('should reject callback missing message_key', async () => {
      const response = await SELF.fetch('http://localhost/progress-callback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Engine-Token': env.ENGINE_API_KEY,
        },
        body: JSON.stringify({
          user_id: 'test',
          text: 'Progress',
          timestamp: Date.now(),
        }),
      });

      expect(response.status).toBe(400);
    });

    it('should reject callback missing text', async () => {
      const response = await SELF.fetch('http://localhost/progress-callback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Engine-Token': env.ENGINE_API_KEY,
        },
        body: JSON.stringify({
          user_id: 'test',
          message_key: 'key',
          timestamp: Date.now(),
        }),
      });

      expect(response.status).toBe(400);
    });
  });
});
