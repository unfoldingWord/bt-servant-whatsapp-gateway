/**
 * One-time share QR image from the worker (bt-servant-worker#474).
 *
 * The worker puts `share_qr: { url, caption, code }` on a `complete` callback
 * when a QR is due (once per user per mode). It is sent here as its own
 * WhatsApp image, AFTER the answer, so it lands in the chat's media and the
 * user can forward it later.
 *
 * Delivery (decided 2026-11-05): on failure, retry once; if that fails too,
 * skip it and log. "Failure" is strict here: any embedded Meta error, an
 * unparseable reply, or no message id counts (`sendImageMessageStrict`).
 * There is no URL-as-text fallback: the caption already carries the
 * link, and a bare signed image URL is no use to a user. The worker never
 * re-sends it, so a failure here is final and logged as an error.
 */

import type { Env } from '../config/types';
import type { ShareQrMedia } from '../types/engine';
import { sendImageMessageStrict } from './meta-api/client';
import { MAX_CAPTION_LENGTH } from './media-extractor';
import { logger } from '../utils/logger';
import { redactUrl } from '../utils/url';

/** Attempts per QR: the first send plus one retry. */
export const SHARE_QR_MAX_ATTEMPTS = 2;

/** Structural check of a callback's `share_qr` field. */
export function isShareQrMedia(value: unknown): value is ShareQrMedia {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.url === 'string' &&
    v.url.startsWith('https://') &&
    typeof v.caption === 'string' &&
    (v.code === null || typeof v.code === 'string')
  );
}

async function attemptSend(userId: string, qr: ShareQrMedia, env: Env): Promise<boolean> {
  try {
    return await sendImageMessageStrict(
      userId,
      qr.url,
      qr.caption.slice(0, MAX_CAPTION_LENGTH),
      env
    );
  } catch (err) {
    logger.warn('Share QR send threw', {
      code: qr.code,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/**
 * Send the share QR as an image, retrying once. Returns whether it was sent.
 * Never throws: the answer has already gone out, and the QR is best-effort.
 */
export async function sendShareQr(userId: string, qr: ShareQrMedia, env: Env): Promise<boolean> {
  for (let attempt = 1; attempt <= SHARE_QR_MAX_ATTEMPTS; attempt++) {
    if (await attemptSend(userId, qr, env)) {
      logger.info('Sent share QR', { code: qr.code, attempt });
      return true;
    }
    if (attempt < SHARE_QR_MAX_ATTEMPTS) {
      logger.warn('Share QR send failed, retrying once', { code: qr.code, attempt });
    }
  }
  logger.error('Share QR send failed after retry, skipping', {
    code: qr.code,
    attempts: SHARE_QR_MAX_ATTEMPTS,
    url: redactUrl(qr.url),
  });
  return false;
}
