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

function metaOk(wamid = 'wamid.test'): {
  ok: true;
  json: () => Promise<{ messages: { id: string }[] }>;
} {
  return { ok: true, json: async () => ({ messages: [{ id: wamid }] }) };
}

function baseCallback(text: string): EngineCallback {
  return {
    type: 'complete',
    user_id: '1234567890',
    message_key: 'key-1',
    timestamp: new Date().toISOString(),
    text,
  };
}

function lastCallBody(fetchMock: ReturnType<typeof vi.fn>, idx: number): Record<string, unknown> {
  const call = fetchMock.mock.calls[idx];
  return JSON.parse(call[1]?.body as string);
}

describe('handleEngineCallback with inline media (always-prose-first)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('sends prose first then captionless image when text wraps one jpg URL', async () => {
    fetchMock.mockResolvedValueOnce(metaOk()).mockResolvedValueOnce(metaOk());

    const text = 'Check this out:\n![Pic](https://cdn.example.com/pic.jpg)\n\nIsn’t it beautiful?';
    await handleEngineCallback(baseCallback(text), mockEnv);

    expect(fetchMock).toHaveBeenCalledTimes(2);

    const leading = lastCallBody(fetchMock, 0);
    expect(leading.type).toBe('text');
    expect((leading.text as Record<string, unknown>).body).toBe(
      'Check this out:\nhttps://cdn.example.com/pic.jpg\n\nIsn’t it beautiful?'
    );

    const image = lastCallBody(fetchMock, 1);
    expect(image.type).toBe('image');
    expect(image.image).toEqual({ link: 'https://cdn.example.com/pic.jpg' });
  });

  it('sends prose first then captionless video when text wraps one mp4 URL', async () => {
    fetchMock.mockResolvedValueOnce(metaOk()).mockResolvedValueOnce(metaOk());

    const text = 'Here is a video:\n[Watch](https://cdn.example.com/clip.mp4)\n\nEnjoy!';
    await handleEngineCallback(baseCallback(text), mockEnv);

    expect(fetchMock).toHaveBeenCalledTimes(2);

    const leading = lastCallBody(fetchMock, 0);
    expect(leading.type).toBe('text');
    expect((leading.text as Record<string, unknown>).body).toBe(
      'Here is a video:\nhttps://cdn.example.com/clip.mp4\n\nEnjoy!'
    );

    const video = lastCallBody(fetchMock, 1);
    expect(video.type).toBe('video');
    expect(video.video).toEqual({ link: 'https://cdn.example.com/clip.mp4' });
  });

  it('sends prose first + every attachment captionless when text wraps two URLs', async () => {
    fetchMock
      .mockResolvedValueOnce(metaOk())
      .mockResolvedValueOnce(metaOk())
      .mockResolvedValueOnce(metaOk());

    const text =
      'Two things:\n![A](https://cdn.example.com/a.jpg)\n[B](https://cdn.example.com/b.mp4)\nDone.';
    await handleEngineCallback(baseCallback(text), mockEnv);

    expect(fetchMock).toHaveBeenCalledTimes(3);

    const leading = lastCallBody(fetchMock, 0);
    expect(leading.type).toBe('text');
    expect((leading.text as Record<string, unknown>).body).toBe(
      'Two things:\nhttps://cdn.example.com/a.jpg\nhttps://cdn.example.com/b.mp4\nDone.'
    );

    const second = lastCallBody(fetchMock, 1);
    expect(second.type).toBe('image');
    expect((second.image as Record<string, unknown>).caption).toBeUndefined();

    const third = lastCallBody(fetchMock, 2);
    expect(third.type).toBe('video');
    expect((third.video as Record<string, unknown>).caption).toBeUndefined();
  });

  it('still delivers all attachments when the leading text send fails', async () => {
    // Reliability: /progress-callback returned 200 before this code runs, so a
    // thrown error from the leading text send would drop the entire batch with
    // no engine retry. The leading-text send must be non-fatal.
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'Server Error' })
      .mockResolvedValueOnce(metaOk())
      .mockResolvedValueOnce(metaOk());

    const text =
      'Two things:\n![A](https://cdn.example.com/a.jpg)\n[B](https://cdn.example.com/b.mp4)\nDone.';
    await handleEngineCallback(baseCallback(text), mockEnv);

    expect(fetchMock).toHaveBeenCalledTimes(3);

    const leading = lastCallBody(fetchMock, 0);
    expect(leading.type).toBe('text');

    const image = lastCallBody(fetchMock, 1);
    expect(image.type).toBe('image');
    expect((image.image as Record<string, unknown>).caption).toBeUndefined();

    const video = lastCallBody(fetchMock, 2);
    expect(video.type).toBe('video');
    expect((video.video as Record<string, unknown>).caption).toBeUndefined();
  });

  it('leading text body is exactly the URLs when input has no surrounding prose', async () => {
    fetchMock
      .mockResolvedValueOnce(metaOk())
      .mockResolvedValueOnce(metaOk())
      .mockResolvedValueOnce(metaOk());

    const text = '![](https://cdn.example.com/a.jpg) ![](https://cdn.example.com/b.jpg)';
    await handleEngineCallback(baseCallback(text), mockEnv);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const leading = lastCallBody(fetchMock, 0);
    expect(leading.type).toBe('text');
    expect((leading.text as Record<string, unknown>).body).toBe(
      'https://cdn.example.com/a.jpg https://cdn.example.com/b.jpg'
    );
  });

  it('sends prose then URL fallback when single inline media fails synchronously', async () => {
    // Always-prose-first means the user already has the URL in the leading
    // text. The per-attachment fallback in sendRemainingAttachments still
    // re-sends the URL alone so the failed slot is visibly accounted for.
    fetchMock
      .mockResolvedValueOnce(metaOk())
      .mockResolvedValueOnce({ ok: false, status: 400, text: async () => 'Bad Request' })
      .mockResolvedValueOnce(metaOk());

    const text = 'Look:\n![Img](https://cdn.example.com/broken.jpg)\nMoving on.';
    await handleEngineCallback(baseCallback(text), mockEnv);

    expect(fetchMock).toHaveBeenCalledTimes(3);

    const leading = lastCallBody(fetchMock, 0);
    expect(leading.type).toBe('text');
    expect((leading.text as Record<string, unknown>).body).toBe(
      'Look:\nhttps://cdn.example.com/broken.jpg\nMoving on.'
    );

    const failedImage = lastCallBody(fetchMock, 1);
    expect(failedImage.type).toBe('image');

    const fallback = lastCallBody(fetchMock, 2);
    expect(fallback.type).toBe('text');
    expect((fallback.text as Record<string, unknown>).body).toBe(
      'https://cdn.example.com/broken.jpg'
    );
  });

  it('falls back to URL-as-text when a later media fails so the asset is not lost', async () => {
    // Multi-attachment: leading text (ok), image #1 (ok), video #2 (fail),
    // failed video URL retried as plain text.
    fetchMock
      .mockResolvedValueOnce(metaOk())
      .mockResolvedValueOnce(metaOk())
      .mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'Server Error' })
      .mockResolvedValueOnce(metaOk());

    const text =
      'Two things:\n![A](https://cdn.example.com/a.jpg)\n[B](https://cdn.example.com/b.mp4)\nDone.';
    await handleEngineCallback(baseCallback(text), mockEnv);

    expect(fetchMock).toHaveBeenCalledTimes(4);

    const leading = lastCallBody(fetchMock, 0);
    expect(leading.type).toBe('text');

    const image = lastCallBody(fetchMock, 1);
    expect(image.type).toBe('image');

    const failedVideo = lastCallBody(fetchMock, 2);
    expect(failedVideo.type).toBe('video');

    const fallback = lastCallBody(fetchMock, 3);
    expect(fallback.type).toBe('text');
    expect((fallback.text as Record<string, unknown>).body).toBe('https://cdn.example.com/b.mp4');
  });

  it('treats a Meta-2xx-with-permanent-error as a media failure and falls back to URL', async () => {
    // The catastrophe Issue #32 was opened for: Meta returns 200 with an
    // embedded {error:{code:131052}}. Old code logged success and the user
    // got nothing. New code: prose already sent, plus per-attachment fallback
    // re-sends the URL.
    fetchMock
      .mockResolvedValueOnce(metaOk())
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ error: { code: 131052, message: 'Media download error' } }),
      })
      .mockResolvedValueOnce(metaOk());

    const text = 'Watch:\n[V](https://cdn.example.com/huge.mp4)\nbye';
    await handleEngineCallback(baseCallback(text), mockEnv);

    expect(fetchMock).toHaveBeenCalledTimes(3);

    const leading = lastCallBody(fetchMock, 0);
    expect(leading.type).toBe('text');
    expect((leading.text as Record<string, unknown>).body).toContain(
      'https://cdn.example.com/huge.mp4'
    );

    const failedVideo = lastCallBody(fetchMock, 1);
    expect(failedVideo.type).toBe('video');

    const urlFallback = lastCallBody(fetchMock, 2);
    expect(urlFallback.type).toBe('text');
    expect((urlFallback.text as Record<string, unknown>).body).toBe(
      'https://cdn.example.com/huge.mp4'
    );
  });

  it('sends prose first then captionless media when caption exceeds 1024 chars', async () => {
    fetchMock.mockResolvedValueOnce(metaOk()).mockResolvedValueOnce(metaOk());

    const filler = 'a'.repeat(1100);
    const text = `${filler}\n\n![Pic](https://cdn.example.com/pic.jpg)\n\ntrailing`;
    await handleEngineCallback(baseCallback(text), mockEnv);

    expect(fetchMock).toHaveBeenCalledTimes(2);

    const textCall = lastCallBody(fetchMock, 0);
    expect(textCall.type).toBe('text');
    const body = (textCall.text as Record<string, unknown>).body as string;
    expect(body).toContain(filler);
    expect(body).toContain('trailing');
    expect(body).toContain('https://cdn.example.com/pic.jpg');

    const mediaCall = lastCallBody(fetchMock, 1);
    expect(mediaCall.type).toBe('image');
    expect((mediaCall.image as Record<string, unknown>).caption).toBeUndefined();
  });

  it('uses existing text path when no media URLs are present', async () => {
    fetchMock.mockResolvedValueOnce(metaOk());

    const text = 'Plain old text response, no media at all.';
    await handleEngineCallback(baseCallback(text), mockEnv);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = lastCallBody(fetchMock, 0);
    expect(body.type).toBe('text');
    expect((body.text as Record<string, unknown>).body).toBe(text);
  });

  it('handles worker markdown-wrapped video link: drops label echo, keeps URL in prose', async () => {
    fetchMock.mockResolvedValueOnce(metaOk()).mockResolvedValueOnce(metaOk());

    const text = 'Here is:\n[FIA Fishing Net](https://cdn.example.com/vid.mp4)\nEnjoy!';
    await handleEngineCallback(baseCallback(text), mockEnv);

    expect(fetchMock).toHaveBeenCalledTimes(2);

    const leading = lastCallBody(fetchMock, 0);
    expect(leading.type).toBe('text');
    const leadingBody = (leading.text as Record<string, unknown>).body as string;
    expect(leadingBody).toBe('Here is:\nhttps://cdn.example.com/vid.mp4\nEnjoy!');
    expect(leadingBody).not.toContain('FIA Fishing Net');
    expect(leadingBody).not.toContain('[');
    expect(leadingBody).not.toContain('](');

    const video = lastCallBody(fetchMock, 1);
    expect(video.type).toBe('video');
    expect((video.video as Record<string, unknown>).link).toBe('https://cdn.example.com/vid.mp4');
    expect((video.video as Record<string, unknown>).caption).toBeUndefined();
  });

  it('does not attempt media extraction when audio delivery succeeds', async () => {
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
    for (const call of fetchMock.mock.calls) {
      const init = call[1];
      if (init?.body && typeof init.body === 'string') {
        const parsed = JSON.parse(init.body);
        expect(parsed.type).not.toBe('image');
        expect(parsed.type).not.toBe('video');
      }
    }
  });
});
