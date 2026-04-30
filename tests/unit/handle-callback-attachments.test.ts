import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

function metaOk(wamid = 'wamid.test'): {
  ok: true;
  json: () => Promise<{ messages: { id: string }[] }>;
} {
  return { ok: true, json: async () => ({ messages: [{ id: wamid }] }) };
}

function pdfAttachment(
  url = 'https://staging-api.btservant.ai/public/ptxprint/pdfs/shared/jobs/abc.pdf',
  filename = 'bsb-JHN-bsb-empirical.pdf'
): EngineCallback['attachments'] {
  return [
    {
      type: 'pdf',
      url,
      filename,
      size_bytes: 359196,
      mime_type: 'application/pdf',
    },
  ];
}

function lastCallBody(fetchMock: ReturnType<typeof vi.fn>, idx: number): Record<string, unknown> {
  const call = fetchMock.mock.calls[idx];
  return JSON.parse(call[1]?.body as string);
}

describe('handleEngineCallback with PDF attachments', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('sends text first, then document, when complete callback has text + 1 PDF', async () => {
    fetchMock.mockResolvedValueOnce(metaOk()).mockResolvedValueOnce(metaOk());

    const callback: EngineCallback = {
      type: 'complete',
      user_id: '1234567890',
      message_key: 'key-1',
      timestamp: new Date().toISOString(),
      text: 'Here is your print-ready PDF of John (BSB).',
      attachments: pdfAttachment(),
    };

    await handleEngineCallback(callback, mockEnv);

    expect(fetchMock).toHaveBeenCalledTimes(2);

    const text = lastCallBody(fetchMock, 0);
    expect(text.type).toBe('text');
    expect((text.text as Record<string, unknown>).body).toBe(
      'Here is your print-ready PDF of John (BSB).'
    );

    const doc = lastCallBody(fetchMock, 1);
    expect(doc.type).toBe('document');
    expect(doc.document).toEqual({
      link: 'https://staging-api.btservant.ai/public/ptxprint/pdfs/shared/jobs/abc.pdf',
      filename: 'bsb-JHN-bsb-empirical.pdf',
    });
  });

  it('sends audio AND document when complete callback has voice_audio_base64 + PDF', async () => {
    // Audio path: upload (returns media id) → send by id → then document send.
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'media-aud-1' }) })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce(metaOk());

    const callback: EngineCallback = {
      type: 'complete',
      user_id: '1234567890',
      message_key: 'key-1',
      timestamp: new Date().toISOString(),
      voice_audio_base64: 'dGVzdA==',
      attachments: pdfAttachment(),
    };

    await handleEngineCallback(callback, mockEnv);

    expect(fetchMock).toHaveBeenCalledTimes(3);

    const docCall = lastCallBody(fetchMock, 2);
    expect(docCall.type).toBe('document');
    expect((docCall.document as Record<string, unknown>).filename).toBe(
      'bsb-JHN-bsb-empirical.pdf'
    );
  });

  it('sends only document when complete callback has attachments only (no text, no audio)', async () => {
    fetchMock.mockResolvedValueOnce(metaOk());

    const callback: EngineCallback = {
      type: 'complete',
      user_id: '1234567890',
      message_key: 'key-1',
      timestamp: new Date().toISOString(),
      attachments: pdfAttachment(),
    };

    await handleEngineCallback(callback, mockEnv);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const doc = lastCallBody(fetchMock, 0);
    expect(doc.type).toBe('document');
  });

  it('iterates over multiple PDFs, sending each as a separate document', async () => {
    fetchMock
      .mockResolvedValueOnce(metaOk()) // text
      .mockResolvedValueOnce(metaOk()) // doc 1
      .mockResolvedValueOnce(metaOk()); // doc 2

    const callback: EngineCallback = {
      type: 'complete',
      user_id: '1234567890',
      message_key: 'key-1',
      timestamp: new Date().toISOString(),
      text: 'Two PDFs for you.',
      attachments: [
        {
          type: 'pdf',
          url: 'https://cdn.example.com/a.pdf',
          filename: 'a.pdf',
          size_bytes: 1000,
          mime_type: 'application/pdf',
        },
        {
          type: 'pdf',
          url: 'https://cdn.example.com/b.pdf',
          filename: 'b.pdf',
          size_bytes: 2000,
          mime_type: 'application/pdf',
        },
      ],
    };

    await handleEngineCallback(callback, mockEnv);

    expect(fetchMock).toHaveBeenCalledTimes(3);

    const doc1 = lastCallBody(fetchMock, 1);
    expect(doc1.type).toBe('document');
    expect((doc1.document as Record<string, unknown>).filename).toBe('a.pdf');

    const doc2 = lastCallBody(fetchMock, 2);
    expect(doc2.type).toBe('document');
    expect((doc2.document as Record<string, unknown>).filename).toBe('b.pdf');
  });

  it('falls back to URL-as-text when document send fails', async () => {
    fetchMock
      .mockResolvedValueOnce(metaOk()) // text ok
      .mockResolvedValueOnce({ ok: false, status: 400, text: async () => 'Bad Request' }) // doc fail
      .mockResolvedValueOnce(metaOk()); // url-as-text fallback

    const callback: EngineCallback = {
      type: 'complete',
      user_id: '1234567890',
      message_key: 'key-1',
      timestamp: new Date().toISOString(),
      text: 'Here you go.',
      attachments: pdfAttachment('https://cdn.example.com/broken.pdf', 'broken.pdf'),
    };

    await handleEngineCallback(callback, mockEnv);

    expect(fetchMock).toHaveBeenCalledTimes(3);

    const failedDoc = lastCallBody(fetchMock, 1);
    expect(failedDoc.type).toBe('document');

    const fallback = lastCallBody(fetchMock, 2);
    expect(fallback.type).toBe('text');
    expect((fallback.text as Record<string, unknown>).body).toBe(
      'https://cdn.example.com/broken.pdf'
    );
  });

  it('sends apology when attachments-only callback contains no PDF entries', async () => {
    // Validation accepts any non-empty attachments[] but delivery only handles
    // type === 'pdf'. Without the deliverability check, the user would silently
    // get nothing here — the apology must fire.
    fetchMock.mockResolvedValueOnce(metaOk()); // apology text only

    const callback = {
      type: 'complete',
      user_id: '1234567890',
      message_key: 'key-1',
      timestamp: new Date().toISOString(),
      attachments: [
        {
          type: 'spreadsheet',
          url: 'https://cdn.example.com/sheet.xlsx',
          filename: 'sheet.xlsx',
          size_bytes: 1000,
          mime_type: 'application/pdf',
        },
      ],
    } as unknown as EngineCallback;

    await handleEngineCallback(callback, mockEnv);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const apology = lastCallBody(fetchMock, 0);
    expect(apology.type).toBe('text');
    expect((apology.text as Record<string, unknown>).body).toMatch(/could not deliver/i);
  });

  it('sends apology when every PDF send fails AND every URL fallback also fails', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 400, text: async () => 'Bad Request' }) // doc fail
      .mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'Server Error' }) // url fallback fail
      .mockResolvedValueOnce(metaOk()); // apology

    const callback: EngineCallback = {
      type: 'complete',
      user_id: '1234567890',
      message_key: 'key-1',
      timestamp: new Date().toISOString(),
      attachments: pdfAttachment(),
    };

    await handleEngineCallback(callback, mockEnv);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const apology = lastCallBody(fetchMock, 2);
    expect(apology.type).toBe('text');
    expect((apology.text as Record<string, unknown>).body).toMatch(/could not deliver/i);
  });

  it('skips unknown attachment types and continues with remaining PDFs', async () => {
    fetchMock
      .mockResolvedValueOnce(metaOk()) // text
      .mockResolvedValueOnce(metaOk()); // doc for the valid pdf

    // Inject a future-type attachment to verify the gateway skips it safely
    // rather than crashing on an unmodeled `type`.
    const callback = {
      type: 'complete',
      user_id: '1234567890',
      message_key: 'key-1',
      timestamp: new Date().toISOString(),
      text: 'Mixed bag.',
      attachments: [
        {
          type: 'spreadsheet',
          url: 'https://cdn.example.com/sheet.xlsx',
          filename: 'sheet.xlsx',
          size_bytes: 1000,
          mime_type: 'application/pdf',
        },
        {
          type: 'pdf',
          url: 'https://cdn.example.com/ok.pdf',
          filename: 'ok.pdf',
          size_bytes: 1000,
          mime_type: 'application/pdf',
        },
      ],
    } as unknown as EngineCallback;

    await handleEngineCallback(callback, mockEnv);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const doc = lastCallBody(fetchMock, 1);
    expect(doc.type).toBe('document');
    expect((doc.document as Record<string, unknown>).filename).toBe('ok.pdf');
  });
});

describe('validateEngineCallback with attachments', () => {
  it('accepts a complete callback with attachments only (no text, no audio)', () => {
    const result = validateEngineCallback({
      type: 'complete',
      user_id: '1234567890',
      message_key: 'key-1',
      timestamp: new Date().toISOString(),
      attachments: [
        {
          type: 'pdf',
          url: 'https://cdn.example.com/a.pdf',
          filename: 'a.pdf',
          size_bytes: 1000,
          mime_type: 'application/pdf',
        },
      ],
    });
    expect(result).toBeNull();
  });

  it('rejects a complete callback with empty attachments array and no text/audio', () => {
    const result = validateEngineCallback({
      type: 'complete',
      user_id: '1234567890',
      message_key: 'key-1',
      timestamp: new Date().toISOString(),
      attachments: [],
    });
    expect(result).toMatch(/Missing text/);
  });

  it('still rejects a complete callback with no text, audio, or attachments', () => {
    const result = validateEngineCallback({
      type: 'complete',
      user_id: '1234567890',
      message_key: 'key-1',
      timestamp: new Date().toISOString(),
    });
    expect(result).toMatch(/Missing text/);
  });
});
