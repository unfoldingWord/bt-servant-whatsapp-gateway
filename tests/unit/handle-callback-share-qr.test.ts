/**
 * Share QR on complete callbacks (bt-servant-worker#474): sent as its own
 * image AFTER the answer, retried once, then skipped and logged.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleEngineCallback, validateEngineCallback } from '../../src/services/message-handler';
import { isShareQrMedia } from '../../src/services/share-qr';
import type { Env } from '../../src/config/types';
import type { EngineCallback, ShareQrMedia } from '../../src/types/engine';

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

const QR: ShareQrMedia = {
  url: 'https://api.btservant.ai/public/share-qr/spoken.png?s=0123456789abcdef0123456789abcdef',
  caption:
    'Share BT Servant with others: scan this code, or forward this image.\n' +
    'https://wa.me/15558196461?text=%23spoken',
  code: 'spoken',
};

const metaOk = () => ({ ok: true, json: async () => ({ messages: [{ id: 'wamid.ok' }] }) });
const metaFail = () => ({
  ok: false,
  status: 500,
  json: async () => ({ error: { code: 131000 } }),
});

function complete(overrides: Partial<EngineCallback>): EngineCallback {
  return {
    type: 'complete',
    user_id: '1234567890',
    message_key: 'key-1',
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

function bodies(fetchMock: ReturnType<typeof vi.fn>): Array<Record<string, unknown>> {
  return fetchMock.mock.calls.map((call) => JSON.parse(call[1]?.body as string));
}

describe('complete callback with share_qr', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('sends the answer text first, then the QR image with its caption', async () => {
    fetchMock.mockResolvedValue(metaOk());
    await handleEngineCallback(complete({ text: 'ok', share_qr: QR }), mockEnv);
    const sent = bodies(fetchMock);
    expect(sent).toHaveLength(2);
    expect(sent[0]?.type).toBe('text');
    expect(sent[1]).toMatchObject({ type: 'image', image: { link: QR.url, caption: QR.caption } });
  });

  it('retries a failed image send once', async () => {
    fetchMock
      .mockResolvedValueOnce(metaOk())
      .mockResolvedValueOnce(metaFail())
      .mockResolvedValueOnce(metaOk());
    await handleEngineCallback(complete({ text: 'ok', share_qr: QR }), mockEnv);
    const sent = bodies(fetchMock);
    expect(sent.map((b) => b.type)).toEqual(['text', 'image', 'image']);
  });

  it('retries after a network throw', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down')).mockResolvedValueOnce(metaOk());
    await handleEngineCallback(complete({ share_qr: QR }), mockEnv);
    expect(bodies(fetchMock).map((b) => b.type)).toEqual(['image', 'image']);
  });

  it('skips after the retry fails: no URL-as-text fallback, no apology, logged as error', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchMock.mockResolvedValueOnce(metaOk()).mockResolvedValue(metaFail());
    await handleEngineCallback(complete({ text: 'ok', share_qr: QR }), mockEnv);
    const sent = bodies(fetchMock);
    expect(sent.map((b) => b.type)).toEqual(['text', 'image', 'image']);
    const logged = errors.mock.calls.map((c) => c.map(String).join(' ')).join('\n');
    expect(logged).toContain('Share QR send failed after retry, skipping');
  });

  it('delivers a QR-only complete (answer already streamed) without an apology on failure', async () => {
    fetchMock.mockResolvedValue(metaFail());
    await handleEngineCallback(complete({ share_qr: QR }), mockEnv);
    const sent = bodies(fetchMock);
    expect(sent.map((b) => b.type)).toEqual(['image', 'image']);
  });

  it('ignores a malformed share_qr and still delivers the answer', async () => {
    fetchMock.mockResolvedValue(metaOk());
    const bad = { ...QR, url: 'http://insecure.example/qr.png' };
    await handleEngineCallback(complete({ text: 'ok', share_qr: bad }), mockEnv);
    expect(bodies(fetchMock).map((b) => b.type)).toEqual(['text']);
  });

  it('a complete without share_qr is unchanged (text only)', async () => {
    fetchMock.mockResolvedValue(metaOk());
    await handleEngineCallback(complete({ text: 'ok' }), mockEnv);
    expect(bodies(fetchMock).map((b) => b.type)).toEqual(['text']);
  });
});

describe('validateEngineCallback with share_qr', () => {
  it('accepts a complete whose only content is a share QR', () => {
    expect(validateEngineCallback(complete({ share_qr: QR }))).toBeNull();
  });
  it('rejects a complete whose only content is a malformed share QR', () => {
    const bad = complete({}) as unknown as Record<string, unknown>;
    bad.share_qr = { url: 'https://x/qr.png' };
    expect(validateEngineCallback(bad)).toMatch(/share_qr/);
  });
});

describe('isShareQrMedia', () => {
  it('requires an https url, a caption, and a string-or-null code', () => {
    expect(isShareQrMedia(QR)).toBe(true);
    expect(isShareQrMedia({ ...QR, code: null })).toBe(true);
    expect(isShareQrMedia({ ...QR, url: 'http://x' })).toBe(false);
    expect(isShareQrMedia({ ...QR, caption: 1 })).toBe(false);
    expect(isShareQrMedia({ url: QR.url, caption: QR.caption })).toBe(false);
    expect(isShareQrMedia(null)).toBe(false);
  });
});
