/**
 * Meta/WhatsApp API client for sending messages.
 */

import type { Env } from '../../config/types';
import { logger } from '../../utils/logger';
import { isPermanentFailure, isTransientFailure } from './error-codes';

/** Shape of a Meta /messages response body we care about. */
interface MetaSendResponse {
  error?: { code?: number; message?: string };
  messages?: Array<{ id?: string; message_status?: string }>;
}

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
 * Send a WhatsApp image message by public HTTPS link.
 * Meta fetches the link directly; no upload required.
 */
export async function sendImageMessage(
  to: string,
  link: string,
  caption: string | undefined,
  env: Env
): Promise<boolean> {
  return sendMediaByLink(to, 'image', link, { caption }, env);
}

/**
 * Send a WhatsApp video message by public HTTPS link.
 * Meta fetches the link directly; no upload required.
 */
export async function sendVideoMessage(
  to: string,
  link: string,
  caption: string | undefined,
  env: Env
): Promise<boolean> {
  return sendMediaByLink(to, 'video', link, { caption }, env);
}

/**
 * Send a WhatsApp document message by public HTTPS link.
 * Meta fetches the link directly; no upload required. The filename shows
 * in the document tile in WhatsApp.
 */
export async function sendDocumentMessage(
  to: string,
  link: string,
  filename: string,
  env: Env
): Promise<boolean> {
  return sendMediaByLink(to, 'document', link, { filename }, env);
}

type MediaKind = 'image' | 'video' | 'document';

interface MediaOptions {
  caption?: string | undefined;
  filename?: string | undefined;
}

function buildMediaPayload(
  to: string,
  kind: MediaKind,
  link: string,
  options: MediaOptions
): Record<string, unknown> {
  const mediaBody: Record<string, unknown> = { link };
  if (options.caption && options.caption.length > 0) {
    mediaBody.caption = options.caption;
  }
  if (kind === 'document' && options.filename && options.filename.length > 0) {
    mediaBody.filename = options.filename;
  }
  return {
    messaging_product: 'whatsapp',
    to,
    type: kind,
    [kind]: mediaBody,
  };
}

/**
 * Classify a parsed Meta /messages response body. Returns `false` if the body
 * indicates failure (we should fall back), `true` otherwise.
 *
 * Fail-closed on unknown codes: any `error.code` present in a 2xx body that
 * isn't explicitly classified as transient triggers the fallback path. Meta
 * can add new permanent-failure codes without notice; biasing toward success
 * reintroduces the silent-drop path this module is built to close.
 */
function classifyMetaBody(body: MetaSendResponse | undefined, kind: MediaKind): boolean {
  const errorCode = body?.error?.code;
  if (typeof errorCode === 'number') {
    if (isTransientFailure(errorCode)) {
      logger.warn('Meta media send returned transient error in 2xx body', {
        kind,
        errorCode,
        body,
      });
      return true;
    }
    const classification = isPermanentFailure(errorCode) ? 'permanent' : 'unclassified';
    logger.error('Meta media send returned error in 2xx body, treating as failure', {
      kind,
      errorCode,
      classification,
      body,
    });
    return false;
  }
  if (body?.messages?.[0]?.message_status === 'failed') {
    logger.error('Meta media send reported message_status:failed', { kind, body });
    return false;
  }
  return true;
}

async function sendMediaByLink(
  to: string,
  kind: MediaKind,
  link: string,
  options: MediaOptions,
  env: Env
): Promise<boolean> {
  const url = `${getBaseUrl()}/${env.META_PHONE_NUMBER_ID}/messages`;
  const payload = buildMediaPayload(to, kind, link, options);

  const response = await fetch(url, {
    method: 'POST',
    headers: getAuthHeaders(env),
    body: JSON.stringify(payload),
  });

  // Always read the body — Meta sometimes returns 200 with an embedded error.
  let body: MetaSendResponse | undefined;
  try {
    body = (await response.json()) as MetaSendResponse;
  } catch {
    body = undefined;
  }

  if (!response.ok) {
    logger.error('Failed to send Meta media message', {
      status: response.status,
      kind,
      body,
    });
    return false;
  }

  if (!classifyMetaBody(body, kind)) return false;

  logger.info(`Sent ${kind} message to user`, { to: to.slice(0, 8) + '...' });
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
 * Upload an audio ArrayBuffer to Meta's media API.
 * Returns the media ID on success, null on failure.
 */
export async function uploadAudioFromBuffer(
  audioBytes: ArrayBuffer,
  env: Env
): Promise<string | null> {
  const url = `${getBaseUrl()}/${env.META_PHONE_NUMBER_ID}/media`;
  const blob = new Blob([audioBytes], { type: 'audio/ogg' });

  const form = new FormData();
  form.append('file', blob, 'audio.opus');
  form.append('messaging_product', 'whatsapp');
  form.append('type', 'audio/ogg');

  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.META_WHATSAPP_TOKEN}` },
    body: form,
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.error('Failed to upload audio media', { status: response.status, error: errorText });
    return null;
  }

  const result = (await response.json()) as { id?: string };
  return result.id ?? null;
}

/** Upload base64-encoded audio to Meta. Delegates to uploadAudioFromBuffer. */
export async function uploadAudioMedia(audioBase64: string, env: Env): Promise<string | null> {
  const bytes = Uint8Array.from(atob(audioBase64), (c) => c.charCodeAt(0));
  return uploadAudioFromBuffer(bytes.buffer as ArrayBuffer, env);
}

/**
 * Send a WhatsApp audio message using an already-uploaded media ID.
 */
export async function sendAudioById(to: string, mediaId: string, env: Env): Promise<boolean> {
  const url = `${getBaseUrl()}/${env.META_PHONE_NUMBER_ID}/messages`;

  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: 'audio',
    audio: { id: mediaId },
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: getAuthHeaders(env),
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.error('Failed to send audio message', { status: response.status, error: errorText });
    return false;
  }

  logger.info('Sent audio message to user', { to: to.slice(0, 8) + '...' });
  return true;
}

/**
 * Send an audio message to a WhatsApp user.
 * Uploads base64 audio to Meta, then sends using the media ID.
 */
export async function sendAudioMessage(
  to: string,
  audioBase64: string,
  env: Env
): Promise<boolean> {
  const mediaId = await uploadAudioMedia(audioBase64, env);
  if (!mediaId) return false;
  return sendAudioById(to, mediaId, env);
}

/**
 * Send an audio message from an ArrayBuffer to a WhatsApp user.
 * Uploads the buffer to Meta, then sends using the media ID.
 */
export async function sendAudioFromBuffer(
  to: string,
  audioBytes: ArrayBuffer,
  env: Env
): Promise<boolean> {
  const mediaId = await uploadAudioFromBuffer(audioBytes, env);
  if (!mediaId) return false;
  return sendAudioById(to, mediaId, env);
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
