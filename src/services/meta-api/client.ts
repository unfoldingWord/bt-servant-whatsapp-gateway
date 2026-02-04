/**
 * Meta/WhatsApp API client for sending messages.
 */

import type { Env } from '../../config/types';
import { logger } from '../../utils/logger';

/** Graph API version to use */
const META_API_VERSION = 'v23.0';

/** Base URL for Meta Graph API */
function getBaseUrl(): string {
  return `https://graph.facebook.com/${META_API_VERSION}`;
}

/** Get authorization headers for Meta API */
function getAuthHeaders(env: Env): Record<string, string> {
  return {
    Authorization: `Bearer ${env.META_WHATSAPP_TOKEN}`,
    'Content-Type': 'application/json',
  };
}

/**
 * Send a plain text WhatsApp message to a user.
 */
export async function sendTextMessage(to: string, text: string, env: Env): Promise<boolean> {
  const url = `${getBaseUrl()}/${env.META_PHONE_NUMBER_ID}/messages`;

  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: { body: text },
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: getAuthHeaders(env),
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.error('Failed to send Meta message', { status: response.status, error: errorText });
    return false;
  }

  logger.info('Sent text message to user', { to: to.slice(0, 8) + '...' });
  return true;
}

/**
 * Send typing indicator (read receipt) for a message.
 */
export async function sendTypingIndicator(messageId: string, env: Env): Promise<boolean> {
  const url = `${getBaseUrl()}/${env.META_PHONE_NUMBER_ID}/messages`;

  const payload = {
    messaging_product: 'whatsapp',
    status: 'read',
    message_id: messageId,
    typing_indicator: { type: 'text' },
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: getAuthHeaders(env),
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.error('Failed to send typing indicator', { status: response.status, error: errorText });
    return false;
  }

  logger.debug('Sent typing indicator', { messageId });
  return true;
}

/**
 * Send an audio message to a WhatsApp user.
 *
 * Note: This requires uploading the audio first and getting a media ID.
 * For now, this is a placeholder - audio responses are not supported
 * since Cloudflare Workers cannot write to temporary files.
 */
export async function sendAudioMessage(
  _to: string,
  _audioBase64: string,
  _env: Env
): Promise<boolean> {
  // Audio messages require:
  // 1. Decode base64 to bytes
  // 2. Upload to Meta (multipart form)
  // 3. Send message with media ID
  //
  // This is complex in Workers without file system access.
  // For now, we fall back to text responses.
  logger.warn('Audio message sending not implemented in Worker');
  return false;
}

/**
 * Download media content from Meta by media ID.
 */
export async function downloadMedia(mediaId: string, env: Env): Promise<ArrayBuffer | null> {
  // First get the download URL
  const metadataUrl = `${getBaseUrl()}/${mediaId}`;
  const headers = { Authorization: `Bearer ${env.META_WHATSAPP_TOKEN}` };

  const metadataResponse = await fetch(metadataUrl, { headers });
  if (!metadataResponse.ok) {
    const errorText = await metadataResponse.text();
    logger.error('Failed to get media metadata', {
      status: metadataResponse.status,
      error: errorText,
    });
    return null;
  }

  const metadata = (await metadataResponse.json()) as { url?: string };
  const mediaUrl = metadata.url;
  if (!mediaUrl) {
    logger.error('No URL in media metadata response');
    return null;
  }

  // Download the actual media
  const mediaResponse = await fetch(mediaUrl, { headers });
  if (!mediaResponse.ok) {
    const errorText = await mediaResponse.text();
    logger.error('Failed to download media', { status: mediaResponse.status, error: errorText });
    return null;
  }

  return mediaResponse.arrayBuffer();
}
