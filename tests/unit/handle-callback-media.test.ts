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

function lastCallBody(fetchMock: ReturnType<typeof vi.fn>, idx: number): Record<string, unknown> {
  const call = fetchMock.mock.calls[idx];
  return JSON.parse(call[1]?.body as string);
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

  it('sends image message with caption (URL preserved as fallback) when text wraps one jpg URL', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true });

    const text = 'Check this out:\n![Pic](https://cdn.example.com/pic.jpg)\n\nIsn’t it beautiful?';
    await handleEngineCallback(baseCallback(text), mockEnv);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = lastCallBody(fetchMock, 0);
    expect(body.type).toBe('image');
    expect(body.image).toEqual({
      link: 'https://cdn.example.com/pic.jpg',
      caption: 'Check this out:\nhttps://cdn.example.com/pic.jpg\n\nIsn’t it beautiful?',
    });
  });

  it('sends video message with caption (URL preserved as fallback) when text wraps one mp4 URL', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true });

    const text = 'Here is a video:\n[Watch](https://cdn.example.com/clip.mp4)\n\nEnjoy!';
    await handleEngineCallback(baseCallback(text), mockEnv);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = lastCallBody(fetchMock, 0);
    expect(body.type).toBe('video');
    expect(body.video).toEqual({
      link: 'https://cdn.example.com/clip.mp4',
      caption: 'Here is a video:\nhttps://cdn.example.com/clip.mp4\n\nEnjoy!',
    });
  });

  it('sends caption as standalone leading text + all attachments captionless when text wraps two URLs', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true });

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

  it('still delivers all attachments when the leading text send fails (multi-attachment)', async () => {
    // Reliability: /progress-callback returned 200 before this code runs, so a
    // thrown error from the leading text send would drop the entire batch with
    // no engine retry. The leading-text send must be non-fatal — attachments
    // should still ship even if Meta rejected the preamble.
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'Server Error' })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true });

    const text =
      'Two things:\n![A](https://cdn.example.com/a.jpg)\n[B](https://cdn.example.com/b.mp4)\nDone.';
    await handleEngineCallback(baseCallback(text), mockEnv);

    expect(fetchMock).toHaveBeenCalledTimes(3);

    // 1st attempt: leading text (failed at Meta).
    const leading = lastCallBody(fetchMock, 0);
    expect(leading.type).toBe('text');

    // 2nd: image #1, captionless, delivered despite the leading-text failure.
    const image = lastCallBody(fetchMock, 1);
    expect(image.type).toBe('image');
    expect((image.image as Record<string, unknown>).caption).toBeUndefined();

    // 3rd: video #2, captionless, also delivered.
    const video = lastCallBody(fetchMock, 2);
    expect(video.type).toBe('video');
    expect((video.video as Record<string, unknown>).caption).toBeUndefined();
  });

  it('leading text body is exactly the two URLs when multi-attachment input has no surrounding prose', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true });

    const text = '![](https://cdn.example.com/a.jpg) ![](https://cdn.example.com/b.jpg)';
    await handleEngineCallback(baseCallback(text), mockEnv);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const leading = lastCallBody(fetchMock, 0);
    expect(leading.type).toBe('text');
    expect((leading.text as Record<string, unknown>).body).toBe(
      'https://cdn.example.com/a.jpg https://cdn.example.com/b.jpg'
    );
  });

  it('falls back to original text when the first (caption-bearing) media fails', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 400, text: async () => 'Bad Request' })
      .mockResolvedValueOnce({ ok: true });

    const text = 'Look:\n![Img](https://cdn.example.com/broken.jpg)\nMoving on.';
    await handleEngineCallback(baseCallback(text), mockEnv);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const fallback = lastCallBody(fetchMock, 1);
    expect(fallback.type).toBe('text');
    expect((fallback.text as Record<string, unknown>).body).toBe(text);
  });

  it('sends the URL as text when a later media fails, so the asset is not lost', async () => {
    // Multi-attachment flow: leading text (caption), image #1 (ok), video #2
    // (fail), then the failed video's URL retried as plain text via
    // sendRemainingAttachments fallback.
    fetchMock
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'Server Error' })
      .mockResolvedValueOnce({ ok: true });

    const text =
      'Two things:\n![A](https://cdn.example.com/a.jpg)\n[B](https://cdn.example.com/b.mp4)\nDone.';
    await handleEngineCallback(baseCallback(text), mockEnv);

    expect(fetchMock).toHaveBeenCalledTimes(4);

    // 1st: leading text with the full caption (both URLs preserved).
    const leading = lastCallBody(fetchMock, 0);
    expect(leading.type).toBe('text');
    expect((leading.text as Record<string, unknown>).body).toBe(
      'Two things:\nhttps://cdn.example.com/a.jpg\nhttps://cdn.example.com/b.mp4\nDone.'
    );

    // 2nd: image #1, captionless, ok.
    const image = lastCallBody(fetchMock, 1);
    expect(image.type).toBe('image');
    expect((image.image as Record<string, unknown>).caption).toBeUndefined();

    // 3rd: failed video #2.
    const failedVideo = lastCallBody(fetchMock, 2);
    expect(failedVideo.type).toBe('video');

    // 4th: the URL of the failed media, sent as plain text.
    const fallback = lastCallBody(fetchMock, 3);
    expect(fallback.type).toBe('text');
    expect((fallback.text as Record<string, unknown>).body).toBe('https://cdn.example.com/b.mp4');
  });

  it('sends media captionless and full text (URL included) separately when caption exceeds 1024 chars', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: true });

    const filler = 'a'.repeat(1100);
    const text = `${filler}\n\n![Pic](https://cdn.example.com/pic.jpg)\n\ntrailing`;
    await handleEngineCallback(baseCallback(text), mockEnv);

    expect(fetchMock).toHaveBeenCalledTimes(2);

    const mediaCall = lastCallBody(fetchMock, 0);
    expect(mediaCall.type).toBe('image');
    expect((mediaCall.image as Record<string, unknown>).caption).toBeUndefined();

    const textCall = lastCallBody(fetchMock, 1);
    expect(textCall.type).toBe('text');
    const body = (textCall.text as Record<string, unknown>).body as string;
    expect(body).toContain(filler);
    expect(body).toContain('trailing');
    expect(body).toContain('https://cdn.example.com/pic.jpg');
  });

  it('uses existing text path when no media URLs are present', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true });

    const text = 'Plain old text response, no media at all.';
    await handleEngineCallback(baseCallback(text), mockEnv);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = lastCallBody(fetchMock, 0);
    expect(body.type).toBe('text');
    expect((body.text as Record<string, unknown>).body).toBe(text);
  });

  it('handles worker markdown-wrapped video link: drops the label echo but keeps the URL as fallback', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true });

    const text = 'Here is:\n[FIA Fishing Net](https://cdn.example.com/vid.mp4)\nEnjoy!';
    await handleEngineCallback(baseCallback(text), mockEnv);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = lastCallBody(fetchMock, 0);
    expect(body.type).toBe('video');
    const video = body.video as Record<string, unknown>;
    expect(video.link).toBe('https://cdn.example.com/vid.mp4');
    const caption = video.caption as string;
    expect(caption).toBe('Here is:\nhttps://cdn.example.com/vid.mp4\nEnjoy!');
    expect(caption).not.toContain('FIA Fishing Net');
    expect(caption).not.toContain('[');
    expect(caption).not.toContain('](');
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
    // The audio send is by id, so no image/video call should be present.
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
