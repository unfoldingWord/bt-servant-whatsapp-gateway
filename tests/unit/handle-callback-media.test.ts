import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleEngineCallback } from '../../src/services/message-handler';
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

function baseCallback(text: string): EngineCallback {
  return {
    type: 'complete',
    user_id: '1234567890',
    message_key: 'key-1',
    timestamp: new Date().toISOString(),
    text,
  };
}

/** Response shape for a HEAD precheck that should pass through as 'unknown'. */
const HEAD_UNKNOWN = { ok: true, headers: new Headers() };
/** Build a HEAD response with an explicit Content-Length. */
function headWithLength(bytes: number) {
  return { ok: true, headers: new Headers({ 'Content-Length': String(bytes) }) };
}

/** Filter the mocked fetch call list down to Meta JSON POSTs only (skips HEAD prechecks and multipart uploads). */
function metaPosts(fetchMock: ReturnType<typeof vi.fn>): Array<Record<string, unknown>> {
  return fetchMock.mock.calls
    .filter((c) => (c[1]?.method ?? 'GET') === 'POST' && typeof c[1]?.body === 'string')
    .map((c) => JSON.parse(c[1].body as string));
}

describe('handleEngineCallback with inline media', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('sends image message with stripped caption when text has one jpg URL', async () => {
    fetchMock.mockResolvedValueOnce(HEAD_UNKNOWN).mockResolvedValueOnce({ ok: true });

    const text = 'Check this out:\nhttps://cdn.example.com/pic.jpg\n\nIsn’t it beautiful?';
    await handleEngineCallback(baseCallback(text), mockEnv);

    const posts = metaPosts(fetchMock);
    expect(posts).toHaveLength(1);
    expect(posts[0].type).toBe('image');
    expect(posts[0].image).toEqual({
      link: 'https://cdn.example.com/pic.jpg',
      caption: 'Check this out:\n\nIsn’t it beautiful?',
    });
  });

  it('sends video message with stripped caption when text has one mp4 URL', async () => {
    fetchMock.mockResolvedValueOnce(HEAD_UNKNOWN).mockResolvedValueOnce({ ok: true });

    const text = 'Here is a video:\nhttps://cdn.example.com/clip.mp4\n\nEnjoy!';
    await handleEngineCallback(baseCallback(text), mockEnv);

    const posts = metaPosts(fetchMock);
    expect(posts).toHaveLength(1);
    expect(posts[0].type).toBe('video');
    expect(posts[0].video).toEqual({
      link: 'https://cdn.example.com/clip.mp4',
      caption: 'Here is a video:\n\nEnjoy!',
    });
  });

  it('sends two media messages with caption on first only when text has two URLs', async () => {
    fetchMock
      .mockResolvedValueOnce(HEAD_UNKNOWN)
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce(HEAD_UNKNOWN)
      .mockResolvedValueOnce({ ok: true });

    const text = 'Two things:\nhttps://cdn.example.com/a.jpg\nhttps://cdn.example.com/b.mp4\nDone.';
    await handleEngineCallback(baseCallback(text), mockEnv);

    const posts = metaPosts(fetchMock);
    expect(posts).toHaveLength(2);
    expect(posts[0].type).toBe('image');
    expect((posts[0].image as Record<string, unknown>).caption).toBe('Two things:\n\nDone.');
    expect(posts[1].type).toBe('video');
    expect((posts[1].video as Record<string, unknown>).caption).toBeUndefined();
  });

  it('falls back to original text when the first (caption-bearing) media fails', async () => {
    fetchMock
      .mockResolvedValueOnce(HEAD_UNKNOWN)
      .mockResolvedValueOnce({ ok: false, status: 400, text: async () => 'Bad Request' })
      .mockResolvedValueOnce({ ok: true });

    const text = 'Look:\nhttps://cdn.example.com/broken.jpg\nMoving on.';
    await handleEngineCallback(baseCallback(text), mockEnv);

    const posts = metaPosts(fetchMock);
    expect(posts).toHaveLength(2);
    const fallback = posts[1];
    expect(fallback.type).toBe('text');
    expect((fallback.text as Record<string, unknown>).body).toBe(text);
  });

  it('sends the URL as text when a later media fails, so the asset is not lost', async () => {
    // First succeeds with caption. Second fails — user already has the caption,
    // but the failed URL was stripped from the caption so we send just the URL
    // as plain text to preserve the clickable link.
    fetchMock
      .mockResolvedValueOnce(HEAD_UNKNOWN)
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce(HEAD_UNKNOWN)
      .mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'Server Error' })
      .mockResolvedValueOnce({ ok: true });

    const text = 'Two things:\nhttps://cdn.example.com/a.jpg\nhttps://cdn.example.com/b.mp4\nDone.';
    await handleEngineCallback(baseCallback(text), mockEnv);

    const posts = metaPosts(fetchMock);
    expect(posts).toHaveLength(3);
    expect(posts[0].type).toBe('image');
    expect((posts[0].image as Record<string, unknown>).caption).toBe('Two things:\n\nDone.');
    expect(posts[1].type).toBe('video');
    expect(posts[2].type).toBe('text');
    expect((posts[2].text as Record<string, unknown>).body).toBe('https://cdn.example.com/b.mp4');
  });

  it('sends media captionless and full text separately when stripped text exceeds 1024 chars', async () => {
    fetchMock
      .mockResolvedValueOnce(HEAD_UNKNOWN)
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true });

    const filler = 'a'.repeat(1100);
    const text = `${filler}\n\nhttps://cdn.example.com/pic.jpg\n\ntrailing`;
    await handleEngineCallback(baseCallback(text), mockEnv);

    const posts = metaPosts(fetchMock);
    expect(posts).toHaveLength(2);
    expect(posts[0].type).toBe('image');
    expect((posts[0].image as Record<string, unknown>).caption).toBeUndefined();
    expect(posts[1].type).toBe('text');
    const body = (posts[1].text as Record<string, unknown>).body as string;
    expect(body).toContain(filler);
    expect(body).toContain('trailing');
    expect(body).not.toContain('https://cdn.example.com/pic.jpg');
  });

  it('uses existing text path when no media URLs are present', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true });

    const text = 'Plain old text response, no media at all.';
    await handleEngineCallback(baseCallback(text), mockEnv);

    const posts = metaPosts(fetchMock);
    expect(posts).toHaveLength(1);
    expect(posts[0].type).toBe('text');
    expect((posts[0].text as Record<string, unknown>).body).toBe(text);
  });

  it('does not attempt media extraction when audio delivery succeeds', async () => {
    // 1: Meta audio upload ok, 2: send audio by id ok — no media/text call expected
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'media-aud-1' }) })
      .mockResolvedValueOnce({ ok: true });

    const callback: EngineCallback = {
      type: 'complete',
      user_id: '1234567890',
      message_key: 'key-1',
      timestamp: new Date().toISOString(),
      text: 'Here is https://cdn.example.com/pic.jpg for you',
      voice_audio_base64: 'dGVzdA==',
    };

    await handleEngineCallback(callback, mockEnv);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const post of metaPosts(fetchMock)) {
      expect(post.type).not.toBe('image');
      expect(post.type).not.toBe('video');
    }
  });

  it('skips inline media send and falls back to original text when first attachment is too large', async () => {
    // Caption-mode first attachment is over Meta's 16 MB video cap → precheck
    // returns 'too_large' → inline send is skipped → fall back to sending the
    // original un-stripped text so the user sees the URL as a clickable link.
    fetchMock
      .mockResolvedValueOnce(headWithLength(40 * 1024 * 1024))
      .mockResolvedValueOnce({ ok: true });

    const text = 'Big video:\nhttps://cdn.example.com/huge.mp4\nWatch carefully.';
    await handleEngineCallback(baseCallback(text), mockEnv);

    const posts = metaPosts(fetchMock);
    expect(posts).toHaveLength(1);
    expect(posts[0].type).toBe('text');
    expect((posts[0].text as Record<string, unknown>).body).toBe(text);
  });

  it('sends URL as text for a non-first attachment that is too large, while sending the OK ones inline', async () => {
    // First (image, small) → media send with caption.
    // Second (video, oversized) → precheck blocks inline; URL goes out as text.
    fetchMock
      .mockResolvedValueOnce(headWithLength(1 * 1024 * 1024))
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce(headWithLength(40 * 1024 * 1024))
      .mockResolvedValueOnce({ ok: true });

    const text =
      'Two assets:\nhttps://cdn.example.com/small.jpg\nhttps://cdn.example.com/huge.mp4\nEnjoy.';
    await handleEngineCallback(baseCallback(text), mockEnv);

    const posts = metaPosts(fetchMock);
    expect(posts).toHaveLength(2);
    expect(posts[0].type).toBe('image');
    expect((posts[0].image as Record<string, unknown>).caption).toBe('Two assets:\n\nEnjoy.');
    expect(posts[1].type).toBe('text');
    expect((posts[1].text as Record<string, unknown>).body).toBe(
      'https://cdn.example.com/huge.mp4'
    );
  });

  it('proceeds with inline media send when HEAD returns no Content-Length (unknown)', async () => {
    // Lenient: when we can't determine size, we let the send try.
    fetchMock.mockResolvedValueOnce(HEAD_UNKNOWN).mockResolvedValueOnce({ ok: true });

    const text = 'Mystery sized image:\nhttps://cdn.example.com/pic.jpg\nlooks fine.';
    await handleEngineCallback(baseCallback(text), mockEnv);

    const posts = metaPosts(fetchMock);
    expect(posts).toHaveLength(1);
    expect(posts[0].type).toBe('image');
  });

  it('proceeds with inline media send when HEAD throws (timeout or network error)', async () => {
    // Simulate the AbortController timeout or an underlying network failure.
    // Must not stall or regress behavior; falls through to the lenient path.
    fetchMock
      .mockRejectedValueOnce(new Error('The operation was aborted'))
      .mockResolvedValueOnce({ ok: true });

    const text = 'Slow server image:\nhttps://cdn.example.com/pic.jpg\nfinally.';
    await handleEngineCallback(baseCallback(text), mockEnv);

    const posts = metaPosts(fetchMock);
    expect(posts).toHaveLength(1);
    expect(posts[0].type).toBe('image');
  });

  it('sends a User-Agent identifying the precheck on HEAD requests', async () => {
    fetchMock.mockResolvedValueOnce(HEAD_UNKNOWN).mockResolvedValueOnce({ ok: true });

    const text = 'Image:\nhttps://cdn.example.com/pic.jpg';
    await handleEngineCallback(baseCallback(text), mockEnv);

    const headCall = fetchMock.mock.calls.find((c) => c[1]?.method === 'HEAD');
    expect(headCall).toBeDefined();
    const ua = (headCall?.[1]?.headers as Record<string, string> | undefined)?.['User-Agent'];
    expect(ua).toMatch(/bt-servant-whatsapp-gateway/);
  });
});
