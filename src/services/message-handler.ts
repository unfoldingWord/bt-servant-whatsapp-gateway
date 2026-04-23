/**
 * Message handling service - orchestrates message processing.
 */

import type { Env } from '../config/types';
import type {
  IncomingMessage,
  MessageType,
  RawMessage,
  Contact,
  WebhookPayload,
} from '../types/meta';
import type { EngineCallback } from '../types/engine';
import {
  sendTextMessage as sendToWhatsApp,
  sendTypingIndicator,
  sendAudioMessage,
  sendAudioFromBuffer,
  sendImageMessage,
  sendVideoMessage,
  downloadMedia,
} from './meta-api/client';
import { extractMedia, MAX_CAPTION_LENGTH } from './media-extractor';
import type { MediaAttachment } from './media-extractor';
import { sendMessage as sendToEngine } from './engine-client';
import type { AudioPayload, SendMessageOptions } from './engine-client';
import { chunkMessage } from './chunking';
import { logger } from '../utils/logger';
import { redactUrl } from '../utils/url';

/**
 * Parse a raw message from Meta webhook into IncomingMessage.
 */
export function parseMessage(raw: RawMessage, contacts: Contact[]): IncomingMessage {
  const msgType = parseMessageType(raw.type);
  const text = extractText(raw, msgType);
  const mediaId = raw.audio?.id;

  return {
    userId: contacts[0]?.wa_id ?? raw.from,
    messageId: raw.id,
    messageType: msgType,
    timestamp: parseInt(raw.timestamp, 10),
    text,
    mediaId,
  };
}

function parseMessageType(type: string): MessageType {
  const validTypes: MessageType[] = [
    'text',
    'audio',
    'image',
    'document',
    'sticker',
    'location',
    'contacts',
    'interactive',
    'button',
  ];
  if (validTypes.includes(type as MessageType)) {
    return type as MessageType;
  }
  return 'unknown';
}

function extractTextFromText(raw: RawMessage): string {
  return raw.text?.body ?? '';
}

function extractTextFromInteractive(raw: RawMessage): string {
  const interactive = raw.interactive;
  return interactive?.button_reply?.title ?? interactive?.list_reply?.title ?? '';
}

function extractTextFromButton(raw: RawMessage): string {
  return raw.button?.text ?? '';
}

function extractText(raw: RawMessage, type: MessageType): string {
  if (type === 'text') return extractTextFromText(raw);
  if (type === 'interactive') return extractTextFromInteractive(raw);
  if (type === 'button') return extractTextFromButton(raw);
  return '';
}

/**
 * Check if message type is supported for processing.
 */
function isSupportedType(type: MessageType): boolean {
  return type === 'text' || type === 'audio';
}

/**
 * Check if message is older than the cutoff threshold.
 */
function isMessageTooOld(timestamp: number, cutoffSeconds: number): boolean {
  const now = Math.floor(Date.now() / 1000);
  return now - timestamp > cutoffSeconds;
}

/**
 * Get the progress callback URL.
 * GATEWAY_PUBLIC_URL is validated in the route handler before this is called.
 */
function getProgressCallbackUrl(env: Env): string {
  return `${env.GATEWAY_PUBLIC_URL.replace(/\/$/, '')}/progress-callback`;
}

/**
 * Handle incoming webhook payload from Meta.
 */
export async function handleWebhook(payload: WebhookPayload, env: Env): Promise<void> {
  for (const entry of payload.entry) {
    for (const change of entry.changes) {
      if (change.field !== 'messages') continue;

      const contacts = change.value.contacts ?? [];
      for (const raw of change.value.messages ?? []) {
        await processMessage(raw, contacts, env);
      }
    }
  }
}

/**
 * Validate an incoming message. Returns the message if valid, undefined if it should be skipped.
 */
async function validateMessage(message: IncomingMessage, env: Env): Promise<boolean> {
  const cutoffSeconds = parseInt(env.MESSAGE_AGE_CUTOFF_SECONDS, 10);

  if (!isSupportedType(message.messageType)) {
    logger.warn('Unsupported message type', { type: message.messageType });
    return false;
  }

  if (isMessageTooOld(message.timestamp, cutoffSeconds)) {
    const age = Math.floor(Date.now() / 1000) - message.timestamp;
    logger.warn('Message too old, dropping', { age, cutoff: cutoffSeconds });
    return false;
  }

  return true;
}

/** Maximum audio file size in bytes (25 MB) */
const MAX_AUDIO_SIZE = 25 * 1024 * 1024;

/**
 * Download audio from Meta, base64-encode it, and return as AudioPayload.
 * Sends an error message to the user and returns undefined on failure.
 */
/** Chunk size for binary-to-string conversion (avoids call stack limits) */
const B64_CHUNK = 8192;

async function downloadAndEncodeAudio(
  message: IncomingMessage,
  env: Env
): Promise<AudioPayload | undefined> {
  if (!message.mediaId) {
    logger.error('No mediaId on audio message');
    return undefined;
  }

  const buffer = await downloadMedia(message.mediaId, env);
  if (!buffer) {
    logger.error('Failed to download audio', { mediaId: message.mediaId });
    await sendToWhatsApp(message.userId, 'Sorry, I could not download your voice message.', env);
    return undefined;
  }

  if (buffer.byteLength > MAX_AUDIO_SIZE) {
    logger.warn('Audio too large', { size: buffer.byteLength });
    await sendToWhatsApp(message.userId, 'Your voice message is too large (max 25 MB).', env);
    return undefined;
  }

  const bytes = new Uint8Array(buffer);
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += B64_CHUNK) {
    chunks.push(String.fromCharCode(...bytes.subarray(i, i + B64_CHUNK)));
  }
  const audioBase64 = btoa(chunks.join(''));

  return { audioBase64, audioFormat: 'ogg' };
}

/**
 * Process a single incoming message.
 */
async function processMessage(raw: RawMessage, contacts: Contact[], env: Env): Promise<void> {
  const message = parseMessage(raw, contacts);

  logger.info('Received message', {
    type: message.messageType,
    messageId: message.messageId,
    userId: message.userId.slice(0, 8) + '...',
  });

  if (!(await validateMessage(message, env))) return;

  await sendTypingIndicator(message.messageId, env);

  let audio: AudioPayload | undefined;
  if (message.messageType === 'audio' && message.mediaId) {
    audio = await downloadAndEncodeAudio(message, env);
    if (!audio) return;
  }

  const options: SendMessageOptions = { progressCallbackUrl: getProgressCallbackUrl(env) };
  if (audio) options.audio = audio;

  const messageText = audio ? undefined : message.text;
  const result = await sendToEngine(message.userId, messageText, env, message.messageId, options);

  if (!result) {
    logger.error('Failed to send message to engine');
    await sendToWhatsApp(
      message.userId,
      'Sorry, I encountered an error processing your message. Please try again.',
      env
    );
    return;
  }

  logger.info('Message accepted', {
    messageId: result.message_id,
  });
}

/**
 * Send response(s) back to the user.
 */
export async function sendResponses(userId: string, responses: string[], env: Env): Promise<void> {
  const chunkSize = parseInt(env.CHUNK_SIZE, 10);

  for (const text of responses) {
    const chunks = chunkMessage(text, chunkSize);
    for (const chunk of chunks) {
      const sent = await sendToWhatsApp(userId, chunk, env);
      if (!sent) {
        throw new Error(`Failed to send WhatsApp message to ${userId.slice(0, 8)}...`);
      }
    }
  }
}

function isNonEmptyString(value: unknown): boolean {
  return typeof value === 'string' && value.length > 0;
}

const VALID_CALLBACK_TYPES = ['status', 'progress', 'complete', 'error'];

/**
 * Validate type-specific required fields on a callback payload.
 * Returns an error string if invalid, null if valid.
 */
function validateCallbackFields(type: string, p: Record<string, unknown>): string | null {
  if (type === 'progress' && !isNonEmptyString(p.text)) {
    return 'Missing or invalid text for progress callback';
  }
  if (
    type === 'complete' &&
    !isNonEmptyString(p.text) &&
    !isNonEmptyString(p.voice_audio_base64) &&
    !isNonEmptyString(p.voice_audio_url)
  ) {
    return 'Missing text, voice_audio_base64, or voice_audio_url for complete callback';
  }
  if (type === 'error' && !isNonEmptyString(p.error)) {
    return 'Missing or invalid error for error callback';
  }
  return null;
}

/**
 * Validate an engine callback payload has the required shape.
 * Returns an error string if invalid, null if valid.
 */
export function validateEngineCallback(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) {
    return 'Payload must be an object';
  }

  const p = payload as Record<string, unknown>;

  if (!isNonEmptyString(p.type) || !VALID_CALLBACK_TYPES.includes(p.type as string)) {
    return 'Missing or invalid type';
  }
  if (!isNonEmptyString(p.user_id)) return 'Missing or invalid user_id';
  if (!isNonEmptyString(p.message_key)) return 'Missing or invalid message_key';

  return validateCallbackFields(p.type as string, p);
}

async function fetchAudioFromUrl(url: string, env: Env): Promise<ArrayBuffer | null> {
  const safeUrl = redactUrl(url);
  if (!url.startsWith('https://')) {
    logger.error('Refusing to fetch non-HTTPS audio URL', { url: safeUrl });
    return null;
  }
  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${env.ENGINE_API_KEY}` },
    });
    if (!response.ok) {
      logger.error('Failed to fetch audio from URL', { status: response.status, url: safeUrl });
      return null;
    }
    const contentLength = response.headers.get('Content-Length');
    const parsedLength = contentLength ? parseInt(contentLength, 10) : NaN;
    if (!Number.isNaN(parsedLength) && parsedLength > MAX_AUDIO_SIZE) {
      logger.error('Audio from URL exceeds size limit', { contentLength, url: safeUrl });
      return null;
    }
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_AUDIO_SIZE) {
      logger.error('Audio from URL exceeds size limit after download', {
        size: buffer.byteLength,
        url: safeUrl,
      });
      return null;
    }
    return buffer;
  } catch (err) {
    logger.error('Network error fetching audio URL', { url: safeUrl, error: String(err) });
    return null;
  }
}

async function tryAudioDelivery(callback: EngineCallback, env: Env): Promise<boolean> {
  if (callback.voice_audio_url) {
    const audioBytes = await fetchAudioFromUrl(callback.voice_audio_url, env);
    if (audioBytes) {
      const sent = await sendAudioFromBuffer(callback.user_id, audioBytes, env);
      if (sent) return true;
      logger.warn('Meta upload failed for URL audio, trying base64 fallback');
    } else {
      logger.warn('Failed to fetch audio from URL, trying base64 fallback');
    }
  }
  if (callback.voice_audio_base64) {
    const sent = await sendAudioMessage(callback.user_id, callback.voice_audio_base64, env);
    if (sent) return true;
    logger.warn('Failed to send base64 audio response');
  }
  return false;
}

async function sendOneAttachment(
  userId: string,
  attachment: MediaAttachment,
  caption: string | undefined,
  env: Env
): Promise<boolean> {
  if (attachment.kind === 'image') {
    return sendImageMessage(userId, attachment.url, caption, env);
  }
  return sendVideoMessage(userId, attachment.url, caption, env);
}

async function sendRemainingAttachments(
  userId: string,
  attachments: MediaAttachment[],
  env: Env
): Promise<void> {
  for (const attachment of attachments) {
    const sent = await sendOneAttachment(userId, attachment, undefined, env);
    if (sent) {
      logger.info('Sent media attachment', {
        kind: attachment.kind,
        url: redactUrl(attachment.url),
      });
      continue;
    }
    logger.warn('Media send failed, falling back to URL as text', {
      kind: attachment.kind,
      url: redactUrl(attachment.url),
    });
    // Belt-and-suspenders: the URL is also preserved in the caption/text
    // path now, but in long-text mode the caption is sent as a separate
    // message — re-sending the URL keeps the link adjacent to the failed
    // media slot.
    await sendToWhatsApp(userId, attachment.url, env);
  }
}

async function sendInCaptionMode(
  callback: EngineCallback,
  attachments: MediaAttachment[],
  captionText: string,
  env: Env
): Promise<void> {
  const first = attachments[0];
  if (!first) return;
  if (attachments.length === 1) {
    const sent = await sendOneAttachment(callback.user_id, first, captionText, env);
    if (!sent) {
      logger.warn('First media send failed, falling back to text', {
        kind: first.kind,
        url: redactUrl(first.url),
      });
      await sendResponses(callback.user_id, [callback.text ?? ''], env);
      return;
    }
    logger.info('Sent media attachment', { kind: first.kind, url: redactUrl(first.url) });
    return;
  }
  // N > 1: putting the prose-caption on attachment #1 only (the previous
  // behavior) leaves attachments #2..N context-less. Send the caption as a
  // standalone text message first, then ship every attachment captionless.
  // The leading-text send is intentionally non-fatal: /progress-callback has
  // already returned 200, so a thrown error here drops the entire batch with
  // no engine retry. Better to deliver the attachments without the preamble
  // than to silently lose the whole response.
  if (captionText.length > 0) {
    try {
      await sendResponses(callback.user_id, [captionText], env);
    } catch (err) {
      logger.warn('Leading caption text send failed; delivering attachments without preamble', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  await sendRemainingAttachments(callback.user_id, attachments, env);
}

async function sendInLongTextMode(
  userId: string,
  attachments: MediaAttachment[],
  captionText: string,
  env: Env
): Promise<void> {
  await sendRemainingAttachments(userId, attachments, env);
  if (captionText.length > 0) {
    await sendResponses(userId, [captionText], env);
  }
}

async function handleTextWithMedia(callback: EngineCallback, env: Env): Promise<void> {
  if (!callback.text) return;
  const { attachments, captionText } = extractMedia(callback.text);
  if (attachments.length === 0) {
    await sendResponses(callback.user_id, [callback.text], env);
    return;
  }
  const fitsInCaption = captionText.length > 0 && captionText.length <= MAX_CAPTION_LENGTH;
  if (fitsInCaption) {
    await sendInCaptionMode(callback, attachments, captionText, env);
  } else {
    await sendInLongTextMode(callback.user_id, attachments, captionText, env);
  }
}

async function handleCompleteCallback(callback: EngineCallback, env: Env): Promise<void> {
  const audioSent = await tryAudioDelivery(callback, env);
  if (audioSent) return;

  if (callback.text) {
    await handleTextWithMedia(callback, env);
  } else {
    logger.error('Audio delivery failed with no text fallback');
    await sendToWhatsApp(
      callback.user_id,
      'Sorry, I could not deliver the audio response. Please try again.',
      env
    );
  }
}

/**
 * Handle an engine callback, dispatching by type.
 */
export async function handleEngineCallback(callback: EngineCallback, env: Env): Promise<void> {
  logger.info('Engine callback received', {
    type: callback.type,
    userId: callback.user_id.slice(0, 8) + '...',
    messageKey: callback.message_key,
  });

  if (callback.type === 'progress') {
    if (callback.text) {
      await sendToWhatsApp(callback.user_id, callback.text, env);
    }
  } else if (callback.type === 'complete') {
    await handleCompleteCallback(callback, env);
  } else if (callback.type === 'error') {
    const errorMsg = callback.error ?? 'Unknown error';
    logger.error('Engine reported error', { error: errorMsg });
    const sent = await sendToWhatsApp(
      callback.user_id,
      'Sorry, I encountered an error processing your message. Please try again.',
      env
    );
    if (!sent) {
      throw new Error(`Failed to send error message to ${callback.user_id.slice(0, 8)}...`);
    }
  } else {
    logger.info('Status callback', { message: callback.message });
  }
}
