/**
 * Meta delivery-status webhook processing.
 *
 * Pure observability: logs each `entry[].changes[].value.statuses[]` entry at
 * info-level. Acting on failures (KV-backed async fallback) is tracked in #33.
 */

import type { StatusEntry, WebhookPayload } from '../../types/meta';
import { logger } from '../../utils/logger';

export function processStatusEntries(payload: WebhookPayload): void {
  for (const entry of payload.entry) {
    for (const change of entry.changes) {
      const statuses = change.value.statuses;
      if (!statuses) continue;
      for (const status of statuses) {
        logStatus(status);
      }
    }
  }
}

function logStatus(status: StatusEntry): void {
  logger.info('Meta delivery status', {
    status: status.status,
    message_id: status.id,
    recipient_id: status.recipient_id,
    timestamp: status.timestamp,
    errors: status.errors,
  });
}
