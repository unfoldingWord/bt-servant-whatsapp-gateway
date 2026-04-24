import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { processStatusEntries } from '../../src/services/meta-api/status-webhook';
import type { WebhookPayload, StatusEntry } from '../../src/types/meta';

function payloadWithStatuses(statuses: StatusEntry[]): WebhookPayload {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'entry-1',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: {
                display_phone_number: '+15555550000',
                phone_number_id: '123456789',
              },
              statuses,
            },
          },
        ],
      },
    ],
  };
}

describe('processStatusEntries', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('logs a delivered status entry at info-level with the expected shape', () => {
    processStatusEntries(
      payloadWithStatuses([
        {
          id: 'wamid.delivered-1',
          status: 'delivered',
          timestamp: '1671526301',
          recipient_id: '14438005555',
        },
      ])
    );

    expect(logSpy).toHaveBeenCalledTimes(1);
    const entry = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(entry.level).toBe('info');
    expect(entry.message).toBe('Meta delivery status');
    expect(entry.status).toBe('delivered');
    expect(entry.message_id).toBe('wamid.delivered-1');
    expect(entry.recipient_id).toBe('14438005555');
    expect(entry.timestamp).toBe('1671526301');
    expect(entry.errors).toBeUndefined();
  });

  it('logs a failed status entry with the errors array preserved', () => {
    processStatusEntries(
      payloadWithStatuses([
        {
          id: 'wamid.failed-1',
          status: 'failed',
          timestamp: '1671526302',
          recipient_id: '14438005555',
          errors: [
            {
              code: 131053,
              title: 'Media upload error',
              message: 'Media upload error',
              href: 'https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes/',
            },
          ],
        },
      ])
    );

    expect(logSpy).toHaveBeenCalledTimes(1);
    const entry = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(entry.status).toBe('failed');
    expect(entry.errors).toHaveLength(1);
    expect(entry.errors[0].code).toBe(131053);
  });

  it('logs every entry when multiple statuses arrive in one webhook', () => {
    processStatusEntries(
      payloadWithStatuses([
        { id: 'wamid.a', status: 'sent', timestamp: '1', recipient_id: '14438005555' },
        { id: 'wamid.b', status: 'delivered', timestamp: '2', recipient_id: '14438005555' },
        { id: 'wamid.c', status: 'read', timestamp: '3', recipient_id: '14438005555' },
      ])
    );

    expect(logSpy).toHaveBeenCalledTimes(3);
    const ids = logSpy.mock.calls.map((c) => JSON.parse(c[0] as string).message_id);
    expect(ids).toEqual(['wamid.a', 'wamid.b', 'wamid.c']);
  });

  it('does nothing when payload has no statuses', () => {
    const payload: WebhookPayload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'entry-1',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: { display_phone_number: '+15555550000', phone_number_id: '123456789' },
              },
            },
          ],
        },
      ],
    };
    processStatusEntries(payload);
    expect(logSpy).not.toHaveBeenCalled();
  });
});
